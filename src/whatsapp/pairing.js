const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { logger } = require('../utils/logger');

class PairingManager {
  async connectWithCode(phoneNumber) {
    try {
      const sessionPath = path.join(__dirname, '../../sessions', phoneNumber);
      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

      const sock = makeWASocket({
        auth: state,
        browser: ['WhatsApp Warmup', 'Chrome', '120.0.0.0'],
        version: [2, 3000, 1015901307],
        connectTimeoutMs: 30000
      });

      // Запрашиваем код
      const code = await sock.requestPairingCode(phoneNumber);
      
      sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
          logger.info(`✅ Account ${phoneNumber} connected via pairing code`);
        }
      });

      return { sock, code };
    } catch (error) {
      logger.error(`Pairing failed for ${phoneNumber}:`, error);
      throw error;
    }
  }
}

module.exports = new PairingManager();
