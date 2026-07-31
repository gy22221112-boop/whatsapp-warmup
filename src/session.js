const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { logger } = require('./utils/logger');
const path = require('path');
const fs = require('fs');

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.sessionPath = path.join(__dirname, '../sessions');
    
    if (!fs.existsSync(this.sessionPath)) {
      fs.mkdirSync(this.sessionPath, { recursive: true });
    }
  }

  async loadSession(phoneNumber) {
    try {
      const sessionFolder = path.join(this.sessionPath, phoneNumber);
      
      if (!fs.existsSync(sessionFolder)) {
        fs.mkdirSync(sessionFolder, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
      
      this.sessions.set(phoneNumber, {
        state,
        saveCreds,
        loaded: true,
        folder: sessionFolder
      });

      return { state, saveCreds };
    } catch (error) {
      logger.error(`Failed to load session for ${phoneNumber}:`, error);
      throw error;
    }
  }

  async deleteSession(phoneNumber) {
    try {
      const sessionFolder = path.join(this.sessionPath, phoneNumber);
      
      if (fs.existsSync(sessionFolder)) {
        fs.rmSync(sessionFolder, { recursive: true, force: true });
      }

      this.sessions.delete(phoneNumber);
      logger.info(`Session deleted for ${phoneNumber}`);
      return true;
    } catch (error) {
      logger.error(`Failed to delete session for ${phoneNumber}:`, error);
      return false;
    }
  }

  getSession(phoneNumber) {
    return this.sessions.get(phoneNumber);
  }
}

module.exports = new SessionManager();
