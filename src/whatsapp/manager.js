const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeInMemoryStore } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');
const { WhatsAppAccountModel } = require('../database/models');
const WarmupService = require('./warmup');
const sessionManager = require('./session');

class WhatsAppManager {
  constructor() {
    this.sessions = new Map();
    this.isRunning = false;
    this.warmupService = new WarmupService();
    this.store = makeInMemoryStore({});
    this.reconnectAttempts = new Map();
    this.MAX_RECONNECT_ATTEMPTS = 10;
    this.pendingConnections = new Map();
    this.connectionStatus = new Map();
  }

  async initializeSession(phoneNumber, telegramId) {
    // Проверяем, не идет ли уже процесс подключения для этого номера
    if (this.pendingConnections.has(phoneNumber)) {
      logger.info(`Connection already in progress for ${phoneNumber}, waiting...`);
      return this.pendingConnections.get(phoneNumber);
    }

    const promise = this._doInitializeSession(phoneNumber, telegramId);
    this.pendingConnections.set(phoneNumber, promise);
    
    try {
      const result = await promise;
      return result;
    } finally {
      this.pendingConnections.delete(phoneNumber);
    }
  }

  async _doInitializeSession(phoneNumber, telegramId) {
    try {
      // Проверяем существующую сессию
      if (this.sessions.has(phoneNumber)) {
        const session = this.sessions.get(phoneNumber);
        if (session.connected) {
          logger.info(`Session already connected for ${phoneNumber}, reusing...`);
          return session.sock;
        }
      }

      const sessionPath = path.join(__dirname, '../../sessions', phoneNumber);
      
      // Создаем папку для сессии
      if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
      }

      // Загружаем состояние сессии
      const { state, saveCreds } = await sessionManager.loadSession(phoneNumber);

      // Создаем сокет с улучшенными настройками
      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Chrome (Linux)', '', ''],
        syncFullHistory: false,
        markOnlineOnConnect: true,
        version: [2, 3000, 1015901307],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        shouldSyncHistoryMessage: () => false,
        patchMessageBeforeSending: (message) => message,
        generateHighQualityLinkPreview: false,
        defaultQueryTimeoutMs: 60000,
        // Добавляем обработку ошибок соединения
        getMessage: async (key) => {
          return this.store.loadMessage(key.remoteJid, key.id);
        }
      });

      // Сохраняем сессию
      this.sessions.set(phoneNumber, { 
        sock, 
        saveCreds, 
        telegramId,
        connected: false,
        qrSent: false,
        startTime: Date.now()
      });

      // Обработка событий
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Обработка QR кода
        if (qr) {
          try {
            await this.sendQRToTelegram(telegramId, qr, phoneNumber);
          } catch (error) {
            logger.error(`Failed to send QR for ${phoneNumber}:`, error);
          }
        }

        // Обработка подключения
        if (connection === 'open') {
          // Сбрасываем счетчик попыток
          this.reconnectAttempts.delete(phoneNumber);
          this.connectionStatus.set(phoneNumber, 'connected');
          
          const session = this.sessions.get(phoneNumber);
          if (session) {
            session.connected = true;
            session.qrSent = false;
          }
          
          await WhatsAppAccountModel.updateStatus(phoneNumber, 'connected');
          logger.info(`✅ Account ${phoneNumber} connected successfully`);
          
          // Уведомляем пользователя
          try {
            const bot = require('../bot');
            await bot.sendMessage(telegramId, 
              `✅ *Аккаунт ${phoneNumber} успешно подключен!*\n\n` +
              `📱 WhatsApp аккаунт готов к работе.\n` +
              `⏳ Начинается процесс прогрева...`
            );
          } catch (error) {
            logger.error(`Failed to send success message to ${telegramId}:`, error);
          }
          
          // Запускаем прогрев
          setTimeout(async () => {
            try {
              await this.warmupService.startWarmup(phoneNumber);
            } catch (error) {
              logger.error(`Failed to start warmup for ${phoneNumber}:`, error);
            }
          }, 5000);
        }

        // Обработка отключения
        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const session = this.sessions.get(phoneNumber);
          
          if (session) {
            session.connected = false;
          }
          
          this.connectionStatus.set(phoneNumber, 'disconnected');

          // Проверяем, нужно ли переподключаться
          if (statusCode !== DisconnectReason.loggedOut) {
            const attempts = this.reconnectAttempts.get(phoneNumber) || 0;
            
            if (attempts < this.MAX_RECONNECT_ATTEMPTS) {
              this.reconnectAttempts.set(phoneNumber, attempts + 1);
              const delay = Math.min(5000 * Math.pow(1.5, attempts), 60000);
              
              logger.info(`Reconnecting ${phoneNumber} in ${delay}ms (attempt ${attempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})...`);
              
              setTimeout(async () => {
                try {
                  await this._doInitializeSession(phoneNumber, telegramId);
                } catch (error) {
                  logger.error(`Reconnect attempt failed for ${phoneNumber}:`, error);
                }
              }, delay);
            } else {
              logger.error(`Max reconnect attempts reached for ${phoneNumber}`);
              await WhatsAppAccountModel.updateStatus(phoneNumber, 'disconnected');
              
              try {
                const bot = require('../bot');
                await bot.sendMessage(telegramId, 
                  `❌ *Аккаунт ${phoneNumber} не может подключиться*\n\n` +
                  `Попыток: ${this.MAX_RECONNECT_ATTEMPTS}\n` +
                  `Пожалуйста, переподключите аккаунт вручную.`
                );
              } catch (error) {
                logger.error(`Failed to send disconnect message:`, error);
              }
            }
          } else {
            logger.warn(`Account ${phoneNumber} logged out`);
            await WhatsAppAccountModel.updateStatus(phoneNumber, 'disconnected');
            
            try {
              const bot = require('../bot');
              await bot.sendMessage(telegramId, 
                `❌ *Аккаунт ${phoneNumber} вышел из системы*\n\n` +
                `Требуется повторное подключение.\n` +
                `Пожалуйста, удалите и добавьте аккаунт заново.`
              );
            } catch (error) {
              logger.error(`Failed to send logout message:`, error);
            }
            
            // Удаляем сессию
            this.sessions.delete(phoneNumber);
            await sessionManager.deleteSession(phoneNumber);
          }
        }
      });

      // Сохраняем креды
      sock.ev.on('creds.update', async () => {
        try {
          await saveCreds();
          logger.debug(`Credentials updated for ${phoneNumber}`);
        } catch (error) {
          logger.error(`Failed to save credentials for ${phoneNumber}:`, error);
        }
      });

      // Обработка входящих сообщений
      sock.ev.on('messages.upsert', async (m) => {
        try {
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
        } catch (error) {
          logger.error(`Error processing incoming message for ${phoneNumber}:`, error);
        }
      });

      // Обработка ошибок
      sock.ev.on('error', (error) => {
        logger.error(`Socket error for ${phoneNumber}:`, error);
      });

      // Обработка событий присутствия
      sock.ev.on('presence.update', (update) => {
        // Логируем изменения статуса
        logger.debug(`Presence update for ${phoneNumber}:`, update);
      });

      return sock;

    } catch (error) {
      logger.error(`Error initializing session for ${phoneNumber}:`, error);
      
      // Пробуем переподключиться при ошибке
      if (error.message && (
        error.message.includes('Connection Failure') ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('ETIMEDOUT')
      )) {
        const attempts = this.reconnectAttempts.get(phoneNumber) || 0;
        if (attempts < this.MAX_RECONNECT_ATTEMPTS) {
          this.reconnectAttempts.set(phoneNumber, attempts + 1);
          const delay = Math.min(10000 * Math.pow(1.5, attempts), 120000);
          
          logger.info(`Will retry ${phoneNumber} in ${delay}ms (attempt ${attempts + 1})`);
          
          return new Promise((resolve) => {
            setTimeout(async () => {
              try {
                const result = await this._doInitializeSession(phoneNumber, telegramId);
                resolve(result);
              } catch (retryError) {
                logger.error(`Retry failed for ${phoneNumber}:`, retryError);
                throw retryError;
              }
            }, delay);
          });
        }
      }
      
      throw error;
    }
  }

  async sendQRToTelegram(telegramId, qr, phoneNumber) {
    try {
      const bot = require('../bot');
      
      // Проверяем, не отправляли ли уже QR для этого номера
      const session = this.sessions.get(phoneNumber);
      if (session && session.qrSent) {
        return;
      }
      
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
      
      await bot.sendPhoto(telegramId, qrBuffer, {
        caption: `📱 *QR код для номера:* \`${phoneNumber}\`\n\n` +
                 `1️⃣ Откройте WhatsApp на телефоне\n` +
                 `2️⃣ Нажмите "Связанные устройства" → "Привязать устройство"\n` +
                 `3️⃣ Наведите камеру на QR код\n\n` +
                 `⏳ QR обновляется автоматически\n` +
                 `🔄 Если QR не сканируется, нажмите "Обновить QR"`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 Обновить QR', callback_data: `refresh_qr_${phoneNumber}` },
              { text: '❌ Отменить', callback_data: `cancel_qr_${phoneNumber}` }
            ],
            [{ text: '🔑 Получить 8-значный код', callback_data: `get_code_${phoneNumber}` }]
          ]
        }
      });
      
      // Отмечаем, что QR отправлен
      if (session) {
        session.qrSent = true;
      }
      
      logger.info(`QR code sent to Telegram for ${phoneNumber}`);
      
    } catch (error) {
      logger.error(`Failed to send QR to Telegram: ${error.message}`);
      
      // Отправляем альтернативу - 8-значный код
      try {
        const bot = require('../bot');
        const code = await this.getPairingCode(phoneNumber);
        
        await bot.sendMessage(telegramId,
          `🔑 *8-значный код для номера:* \`${phoneNumber}\`\n\n` +
          `📱 *Инструкция:*\n` +
          `1️⃣ Откройте WhatsApp на телефоне\n` +
          `2️⃣ Нажмите "Связанные устройства" → "Привязать устройство"\n` +
          `3️⃣ Выберите "Связать по номеру телефона"\n` +
          `4️⃣ Введите код: \`${code}\`\n\n` +
          `⏳ Код действителен 5 минут\n` +
          `🔒 Никому не сообщайте этот код!`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔄 Получить новый код', callback_data: `get_code_${phoneNumber}` }],
                [{ text: '🔙 Назад', callback_data: 'list_accounts' }]
              ]
            }
          }
        );
      } catch (codeError) {
        logger.error(`Failed to send pairing code: ${codeError.message}`);
      }
    }
  }

  async getPairingCode(phoneNumber) {
    try {
      const session = this.sessions.get(phoneNumber);
      if (!session || !session.sock) {
        throw new Error('Session not found');
      }

      const code = await session.sock.requestPairingCode(phoneNumber);
      return code;
    } catch (error) {
      logger.error(`Failed to get pairing code for ${phoneNumber}:`, error);
      throw error;
    }
  }

  async refreshQRCode(phoneNumber, telegramId) {
    try {
      // Отключаем текущую сессию
      await this.disconnect(phoneNumber);
      
      // Удаляем папку сессии
      const sessionPath = path.join(__dirname, '../../sessions', phoneNumber);
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
      }
      
      // Сбрасываем состояние
      this.reconnectAttempts.delete(phoneNumber);
      this.connectionStatus.delete(phoneNumber);
      
      // Создаем новую сессию
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
      try {
        if (session.sock) {
          await session.sock.end();
        }
      } catch (error) {
        logger.error(`Error ending session for ${phoneNumber}:`, error);
      }
      
      this.sessions.delete(phoneNumber);
      this.reconnectAttempts.delete(phoneNumber);
      this.connectionStatus.delete(phoneNumber);
      
      await WhatsAppAccountModel.updateStatus(phoneNumber, 'disconnected');
      this.warmupService.stopWarmup(phoneNumber);
      
      logger.info(`Disconnected ${phoneNumber}`);
      return true;
    }
    return false;
  }

  async startAllSessions() {
    try {
      const accounts = await WhatsAppAccountModel.getActiveAccounts();
      
      if (accounts.length === 0) {
        logger.info('No active accounts to start');
        return;
      }

      logger.info(`Starting ${accounts.length} sessions...`);
      
      let started = 0;
      for (const account of accounts) {
        try {
          await this.initializeSession(account.phone_number, account.user_telegram_id);
          started++;
          await this.sleep(5000); // Пауза между подключениями
        } catch (error) {
          logger.error(`Failed to start session for ${account.phone_number}:`, error);
        }
      }
      
      logger.info(`✅ Started ${started}/${accounts.length} sessions`);
      
    } catch (error) {
      logger.error('Failed to start sessions:', error);
    }
  }

  async reconnectAll() {
    logger.info('Reconnecting all sessions...');
    const accounts = await WhatsAppAccountModel.getActiveAccounts();
    
    for (const account of accounts) {
      if (account.status === 'connected') {
        try {
          await this.disconnect(account.phone_number);
          await this.sleep(2000);
          await this.initializeSession(account.phone_number, account.user_telegram_id);
        } catch (error) {
          logger.error(`Failed to reconnect ${account.phone_number}:`, error);
        }
      }
    }
  }

  getSession(phoneNumber) {
    return this.sessions.get(phoneNumber);
  }

  getSessionStatus(phoneNumber) {
    const session = this.sessions.get(phoneNumber);
    if (!session) return 'not_initialized';
    return session.connected ? 'connected' : 'connecting';
  }

  getActiveSessions() {
    const result = [];
    for (const [phoneNumber, session] of this.sessions) {
      if (session.connected) {
        result.push(phoneNumber);
      }
    }
    return result;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new WhatsAppManager();
