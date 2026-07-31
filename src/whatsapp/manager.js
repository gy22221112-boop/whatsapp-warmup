const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeInMemoryStore } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');
const { WhatsAppAccountModel } = require('../database/models');
const WarmupService = require('./warmup');

class WhatsAppManager {
  constructor() {
    this.sessions = new Map();
    this.isRunning = false;
    this.warmupService = new WarmupService();
    this.store = makeInMemoryStore({});
  }

  async initializeSession(phoneNumber, telegramId) {
    try {
      const sessionPath = path.join(__dirname, '../../sessions', phoneNumber);
      
      if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Chrome (Linux)', '', ''],
        syncFullHistory: false,
        markOnlineOnConnect: true,
        version: [2, 3000, 1015901307],
        getMessage: async (key) => {
          return this.store.loadMessage(key.remoteJid, key.id);
        }
      });

      // Сохраняем сессию
      this.sessions.set(phoneNumber, { sock, saveCreds, telegramId });

      // Обработка QR кода
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          await this.sendQRToTelegram(telegramId, qr, phoneNumber);
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          if (shouldReconnect) {
            logger.info(`Reconnecting ${phoneNumber}...`);
            setTimeout(() => this.initializeSession(phoneNumber, telegramId), 5000);
          } else {
            await WhatsAppAccountModel.updateStatus(phoneNumber, 'disconnected');
            logger.warn(`Account ${phoneNumber} logged out`);
            
            // Уведомляем пользователя
            const bot = require('../bot');
            await bot.sendMessage(telegramId, 
              `❌ Аккаунт ${phoneNumber} отключен. Требуется переподключение.`
            );
          }
        }

        if (connection === 'open') {
          await WhatsAppAccountModel.updateStatus(phoneNumber, 'connected');
          logger.info(`✅ Account ${phoneNumber} connected`);
          
          // Уведомляем пользователя
          const bot = require('../bot');
          await bot.sendMessage(telegramId, 
            `✅ Аккаунт ${phoneNumber} успешно подключен!\n\n` +
            `⏳ Начинается прогрев...`
          );
          
          // Запускаем прогрев
          await this.warmupService.startWarmup(phoneNumber);
        }
      });

      // Сохраняем креды
      sock.ev.on('creds.update', saveCreds);

      // Обработка входящих сообщений
      sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && msg.message) {
          const text = msg.message.conversation || 
                      msg.message.extendedTextMessage?.text || 
                      msg.message.imageMessage?.caption || '';
          
          if (text) {
            await WhatsAppAccountModel.updateStats(phoneNumber, 0, 1);
            await this.warmupService.handleIncomingMessage(phoneNumber, text, msg.key);
          }
        }
      });

      // Автоматическое обновление статуса
      sock.ev.on('presence.update', async (update) => {
        // Логируем изменения статуса
        logger.debug(`Presence update for ${phoneNumber}:`, update);
      });

      return sock;

    } catch (error) {
      logger.error(`Error initializing session for ${phoneNumber}:`, error);
      throw error;
    }
  }

  async sendQRToTelegram(telegramId, qr, phoneNumber) {
    try {
      const bot = require('../bot');
      
      // Генерируем QR код как изображение
      const qrBuffer = await QRCode.toBuffer(qr, {
        type: 'png',
        width: 500,
        margin: 4,
        color: {
          dark: '#075E54',
          light: '#ffffff'
        }
      });
      
      // Отправляем фото в Telegram
      await bot.sendPhoto(telegramId, qrBuffer, {
        caption: `📱 *Новый QR код для номера:* \`${phoneNumber}\`\n\n` +
                 `1️⃣ Откройте WhatsApp на телефоне\n` +
                 `2️⃣ Нажмите "Связанные устройства" → "Привязать устройство"\n` +
                 `3️⃣ Отсканируйте QR код с экрана\n\n` +
                 `⏳ QR код действителен 2 минуты\n` +
                 `🔄 Если QR не сканируется, нажмите "Обновить QR"`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 Обновить QR', callback_data: `refresh_qr_${phoneNumber}` },
              { text: '❌ Отменить', callback_data: `cancel_qr_${phoneNumber}` }
            ]
          ]
        }
      });
      
      logger.info(`QR code sent to Telegram for ${phoneNumber}`);
    } catch (error) {
      logger.error(`Failed to send QR to Telegram: ${error.message}`);
      
      // Если не удалось отправить фото, отправляем текст
      const bot = require('../bot');
      await bot.sendMessage(telegramId,
        `⚠️ *Не удалось отправить QR код как фото.*\n\n` +
        `📱 Пожалуйста, используйте 8-значный код для подключения:\n\n` +
        `🔑 Нажмите кнопку "Получить код" ниже.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔑 Получить 8-значный код', callback_data: `get_code_${phoneNumber}` }],
              [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
            ]
          }
        }
      );
    }
  }

  async getPairingCode(phoneNumber) {
    try {
      const session = this.sessions.get(phoneNumber);
      if (!session) {
        throw new Error('Session not found');
      }

      // Запрашиваем парный код
      const code = await session.sock.requestPairingCode(phoneNumber);
      return code;
    } catch (error) {
      logger.error(`Failed to get pairing code for ${phoneNumber}:`, error);
      throw error;
    }
  }

  async refreshQRCode(phoneNumber, telegramId) {
    try {
      await this.disconnect(phoneNumber);
      
      const sessionPath = path.join(__dirname, '../../sessions', phoneNumber);
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
      }
      
      await this.initializeSession(phoneNumber, telegramId);
      return true;
    } catch (error) {
      logger.error(`Failed to refresh QR for ${phoneNumber}:`, error);
      return false;
    }
  }

  async disconnect(phoneNumber) {
    const session = this.sessions.get(phoneNumber);
    if (session) {
      await session.sock.end();
      this.sessions.delete(phoneNumber);
      await WhatsAppAccountModel.updateStatus(phoneNumber, 'disconnected');
      this.warmupService.stopWarmup(phoneNumber);
      logger.info(`Disconnected ${phoneNumber}`);
      return true;
    }
    return false;
  }

  async startAllSessions() {
    const accounts = await WhatsAppAccountModel.getActiveAccounts();
    
    for (const account of accounts) {
      try {
        await this.initializeSession(account.phone_number, account.user_telegram_id);
        logger.info(`Started session for ${account.phone_number}`);
        await this.sleep(3000);
      } catch (error) {
        logger.error(`Failed to start session for ${account.phone_number}:`, error);
      }
    }
  }

  async getQRCode(phoneNumber) {
    const session = this.sessions.get(phoneNumber);
    if (session) {
      await this.disconnect(phoneNumber);
      const account = await WhatsAppAccountModel.findByPhone(phoneNumber);
      if (account) {
        await this.initializeSession(phoneNumber, account.user_telegram_id);
        return true;
      }
    }
    return false;
  }

  getSession(phoneNumber) {
    return this.sessions.get(phoneNumber);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new WhatsAppManager();