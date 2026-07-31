const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeInMemoryStore, Browsers } = require('@whiskeysockets/baileys');
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
    this.MAX_RECONNECT_ATTEMPTS = 3;
    this.pendingConnections = new Map();
    this.connectionStatus = new Map();
    this.groupCache = new Map();
  }

  async initializeSession(phoneNumber, telegramId) {
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
      if (this.sessions.has(phoneNumber)) {
        const session = this.sessions.get(phoneNumber);
        if (session.connected) {
          logger.info(`Session already connected for ${phoneNumber}, reusing...`);
          return session.sock;
        }
      }

      const sessionPath = path.join(__dirname, '../../sessions', phoneNumber);
      
      if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
      }

      const { state, saveCreds } = await sessionManager.loadSession(phoneNumber);

      const sock = makeWASocket({
  auth: state,
  printQRInTerminal: false,
  browser: Browsers.macOS('Desktop'),
  version: [2, 3000, 1037673340],  // <-- Явно указываем версию
  syncFullHistory: false,
  markOnlineOnConnect: true,
  connectTimeoutMs: 60000,
  keepAliveIntervalMs: 30000,
  shouldSyncHistoryMessage: () => false,
  patchMessageBeforeSending: (message) => message,
  generateHighQualityLinkPreview: false,
  defaultQueryTimeoutMs: 60000,
        cachedGroupMetadata: async (jid) => {
          if (this.groupCache.has(jid)) {
            return this.groupCache.get(jid);
          }
          try {
            const result = await sock.groupMetadata(jid);
            this.groupCache.set(jid, result);
            setTimeout(() => this.groupCache.delete(jid), 300000);
            return result;
          } catch (error) {
            logger.error(`Failed to get group metadata for ${jid}:`, error);
            return null;
          }
        },
        getMessage: async (key) => {
          return this.store.loadMessage(key.remoteJid, key.id);
        }
      });

      this.sessions.set(phoneNumber, { 
        sock, 
        saveCreds, 
        telegramId,
        connected: false,
        qrSent: false,
        startTime: Date.now(),
        pairingCodeRequested: false
      });

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            await this.sendQRToTelegram(telegramId, qr, phoneNumber);
          } catch (error) {
            logger.error(`Failed to send QR for ${phoneNumber}:`, error);
          }
        }

        if (connection === 'open') {
          this.reconnectAttempts.delete(phoneNumber);
          this.connectionStatus.set(phoneNumber, 'connected');
          
          const session = this.sessions.get(phoneNumber);
          if (session) {
            session.connected = true;
            session.qrSent = false;
          }
          
          await WhatsAppAccountModel.updateStatus(phoneNumber, 'connected');
          logger.info(`✅ Account ${phoneNumber} connected successfully`);
          
          try {
            const bot = require('../bot');
            await bot.sendMessage(telegramId, 
              `✅ *Аккаунт ${phoneNumber} подключен!*\n\n` +
              `📱 WhatsApp готов к работе.\n` +
              `🔄 Начинается поиск партнеров для общения...`
            );
          } catch (error) {
            logger.error(`Failed to send success message:`, error);
          }
          
          setTimeout(async () => {
            try {
              await this.warmupService.startWarmup(phoneNumber);
            } catch (error) {
              logger.error(`Failed to start warmup:`, error);
            }
          }, 5000);
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const session = this.sessions.get(phoneNumber);
          
          if (session) {
            session.connected = false;
          }
          
          this.connectionStatus.set(phoneNumber, 'disconnected');

          if (statusCode === 515) {
            logger.info(`Error 515 for ${phoneNumber}, reconnecting in 5s...`);
            setTimeout(() => {
              this._doInitializeSession(phoneNumber, telegramId);
            }, 5000);
            return;
          }

          if (statusCode === DisconnectReason.loggedOut || 
              statusCode === 401 || 
              statusCode === 403 ||
              statusCode === 429) {
            logger.warn(`Account ${phoneNumber} blocked or logged out (${statusCode})`);
            await WhatsAppAccountModel.updateStatus(phoneNumber, 'disconnected');
            
            try {
              const bot = require('../bot');
              await bot.sendMessage(telegramId, 
                `❌ *Аккаунт ${phoneNumber} заблокирован или вышел*\n\n` +
                `Код ошибки: ${statusCode}\n` +
                `Пожалуйста, удалите аккаунт и попробуйте позже.`
              );
            } catch (error) {
              logger.error(`Failed to send error message:`, error);
            }
            
            this.sessions.delete(phoneNumber);
            await sessionManager.deleteSession(phoneNumber);
            return;
          }

          if (statusCode !== DisconnectReason.loggedOut) {
            const attempts = this.reconnectAttempts.get(phoneNumber) || 0;
            
            if (attempts < this.MAX_RECONNECT_ATTEMPTS) {
              this.reconnectAttempts.set(phoneNumber, attempts + 1);
              const delay = Math.min(30000 * Math.pow(2, attempts), 120000);
              
              logger.info(`Reconnecting ${phoneNumber} in ${delay}ms (attempt ${attempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})...`);
              
              setTimeout(async () => {
                try {
                  await this._doInitializeSession(phoneNumber, telegramId);
                } catch (error) {
                  logger.error(`Reconnect attempt failed:`, error);
                }
              }, delay);
            } else {
              logger.error(`Max reconnect attempts reached for ${phoneNumber}`);
              await WhatsAppAccountModel.updateStatus(phoneNumber, 'disconnected');
            }
          }
        }
      });

      sock.ev.on('creds.update', async () => {
        try {
          await saveCreds();
          logger.debug(`Credentials updated for ${phoneNumber}`);
        } catch (error) {
          logger.error(`Failed to save credentials for ${phoneNumber}:`, error);
        }
      });

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

      sock.ev.on('error', (error) => {
        logger.error(`Socket error for ${phoneNumber}:`, error);
      });

      return sock;

    } catch (error) {
      logger.error(`Error initializing session for ${phoneNumber}:`, error);
      throw error;
    }
  }

  async getPairingCode(phoneNumber) {
    try {
      let session = this.sessions.get(phoneNumber);
      
      if (!session || !session.sock) {
        const tempSessionPath = path.join(__dirname, '../../sessions', phoneNumber);
        if (!fs.existsSync(tempSessionPath)) {
          fs.mkdirSync(tempSessionPath, { recursive: true });
        }

        const { state, saveCreds } = await sessionManager.loadSession(phoneNumber);
        
        const tempSock = makeWASocket({
          auth: state,
          printQRInTerminal: false,
          browser: Browsers.macOS('Desktop'),
          connectTimeoutMs: 60000,
          keepAliveIntervalMs: 30000,
          syncFullHistory: false,
          markOnlineOnConnect: true,
          getMessage: async (key) => {
            return this.store.loadMessage(key.remoteJid, key.id);
          }
        });

        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Connection timeout')), 30000);
          
          tempSock.ev.on('connection.update', async (update) => {
            const { connection } = update;
            
            if (connection === 'open') {
              clearTimeout(timeout);
              resolve();
            }
          });
        });

        const code = await tempSock.requestPairingCode(phoneNumber);
        
        this.sessions.set(phoneNumber, {
          sock: tempSock,
          saveCreds: saveCreds,
          telegramId: null,
          connected: false,
          qrSent: false,
          startTime: Date.now(),
          pairingCodeRequested: true
        });

        return code;
      }

      if (session.sock) {
        const code = await session.sock.requestPairingCode(phoneNumber);
        return code;
      }

      throw new Error('Session not found');

    } catch (error) {
      logger.error(`Failed to get pairing code for ${phoneNumber}:`, error);
      throw error;
    }
  }

  async sendQRToTelegram(telegramId, qr, phoneNumber) {
    try {
      const bot = require('../bot');
      
      const session = this.sessions.get(phoneNumber);
      if (session && session.qrSent) {
        return;
      }
      
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
                 `⏳ QR обновляется автоматически`,
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
      
      if (session) {
        session.qrSent = true;
      }
      
      logger.info(`QR code sent to Telegram for ${phoneNumber}`);
      
    } catch (error) {
      logger.error(`Failed to send QR to Telegram: ${error.message}`);
    }
  }

  async refreshQRCode(phoneNumber, telegramId) {
    try {
      await this.disconnect(phoneNumber);
      
      const sessionPath = path.join(__dirname, '../../sessions', phoneNumber);
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
      }
      
      this.reconnectAttempts.delete(phoneNumber);
      this.connectionStatus.delete(phoneNumber);
      
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
          await this.sleep(5000);
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
