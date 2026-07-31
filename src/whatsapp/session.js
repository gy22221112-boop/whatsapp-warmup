const { useMultiFileAuthState, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const { logger } = require('../utils/logger');
const path = require('path');
const fs = require('fs');

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.sessionPath = path.join(__dirname, '../../sessions');
    
    // Создаем папку для сессий если её нет
    if (!fs.existsSync(this.sessionPath)) {
      fs.mkdirSync(this.sessionPath, { recursive: true });
    }
  }

  /**
   * Получить путь к папке сессии для номера
   */
  getSessionPath(phoneNumber) {
    return path.join(this.sessionPath, phoneNumber);
  }

  /**
   * Загрузить или создать состояние сессии
   */
  async loadSession(phoneNumber) {
    try {
      const sessionFolder = this.getSessionPath(phoneNumber);
      
      // Создаем папку для сессии если её нет
      if (!fs.existsSync(sessionFolder)) {
        fs.mkdirSync(sessionFolder, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
      
      // Сохраняем состояние в кеш
      this.sessions.set(phoneNumber, {
        state,
        saveCreds,
        loaded: true,
        folder: sessionFolder
      });

      logger.info(`✅ Session loaded for ${phoneNumber}`);
      return { state, saveCreds };

    } catch (error) {
      logger.error(`❌ Failed to load session for ${phoneNumber}:`, error);
      throw error;
    }
  }

  /**
   * Сохранить состояние сессии
   */
  async saveSession(phoneNumber) {
    const session = this.sessions.get(phoneNumber);
    if (!session) {
      logger.warn(`Session not found for ${phoneNumber}`);
      return false;
    }

    try {
      await session.saveCreds();
      logger.info(`💾 Session saved for ${phoneNumber}`);
      return true;
    } catch (error) {
      logger.error(`❌ Failed to save session for ${phoneNumber}:`, error);
      return false;
    }
  }

  /**
   * Проверить существует ли сессия
   */
  hasSession(phoneNumber) {
    const session = this.sessions.get(phoneNumber);
    return session && session.loaded;
  }

  /**
   * Получить состояние сессии
   */
  getSession(phoneNumber) {
    return this.sessions.get(phoneNumber);
  }

  /**
   * Удалить сессию
   */
  async deleteSession(phoneNumber) {
    try {
      const sessionFolder = this.getSessionPath(phoneNumber);
      
      if (fs.existsSync(sessionFolder)) {
        fs.rmSync(sessionFolder, { recursive: true, force: true });
      }

      this.sessions.delete(phoneNumber);
      logger.info(`🗑️ Session deleted for ${phoneNumber}`);
      return true;

    } catch (error) {
      logger.error(`❌ Failed to delete session for ${phoneNumber}:`, error);
      return false;
    }
  }

  /**
   * Получить все активные сессии
   */
  getAllSessions() {
    const result = [];
    this.sessions.forEach((session, phoneNumber) => {
      result.push({ phoneNumber, ...session });
    });
    return result;
  }

  /**
   * Очистить кеш сессий
   */
  clearCache() {
    this.sessions.clear();
    logger.info('🗑️ Session cache cleared');
  }

  /**
   * Проверить валидность сессии (существуют ли файлы)
   */
  validateSession(phoneNumber) {
    const sessionFolder = this.getSessionPath(phoneNumber);
    
    if (!fs.existsSync(sessionFolder)) {
      return false;
    }

    // Проверяем наличие ключевых файлов сессии
    const requiredFiles = ['creds.json', 'app-state-sync-key-*'];
    const files = fs.readdirSync(sessionFolder);
    
    // Проверяем хотя бы наличие creds.json
    if (!files.includes('creds.json')) {
      return false;
    }

    return true;
  }

  /**
   * Очистить старые сессии (старше N дней)
   */
  async cleanupOldSessions(days = 30) {
    try {
      const folders = fs.readdirSync(this.sessionPath);
      const now = Date.now();
      const maxAge = days * 24 * 60 * 60 * 1000;

      for (const folder of folders) {
        const folderPath = path.join(this.sessionPath, folder);
        const stats = fs.statSync(folderPath);
        
        if (now - stats.mtimeMs > maxAge) {
          fs.rmSync(folderPath, { recursive: true, force: true });
          logger.info(`🗑️ Removed old session: ${folder}`);
        }
      }

      logger.info(`✅ Cleaned up sessions older than ${days} days`);
      return true;

    } catch (error) {
      logger.error('❌ Failed to cleanup sessions:', error);
      return false;
    }
  }

  /**
   * Получить информацию о сессии
   */
  getSessionInfo(phoneNumber) {
    const session = this.sessions.get(phoneNumber);
    if (!session) {
      return null;
    }

    const sessionFolder = this.getSessionPath(phoneNumber);
    let size = 0;
    
    if (fs.existsSync(sessionFolder)) {
      const files = fs.readdirSync(sessionFolder);
      for (const file of files) {
        const stats = fs.statSync(path.join(sessionFolder, file));
        size += stats.size;
      }
    }

    return {
      phoneNumber,
      loaded: session.loaded,
      folder: sessionFolder,
      size: size > 0 ? `${(size / 1024).toFixed(2)} KB` : '0 KB',
      hasFiles: fs.existsSync(sessionFolder) && fs.readdirSync(sessionFolder).length > 0
    };
  }

  /**
   * Получить размер всех сессий
   */
  getTotalSize() {
    let totalSize = 0;
    
    if (fs.existsSync(this.sessionPath)) {
      const folders = fs.readdirSync(this.sessionPath);
      for (const folder of folders) {
        const folderPath = path.join(this.sessionPath, folder);
        const files = fs.readdirSync(folderPath);
        for (const file of files) {
          const stats = fs.statSync(path.join(folderPath, file));
          totalSize += stats.size;
        }
      }
    }

    return totalSize > 0 ? `${(totalSize / 1024).toFixed(2)} KB` : '0 KB';
  }

  /**
   * Получить список всех папок сессий
   */
  listSessions() {
    const result = [];
    
    if (fs.existsSync(this.sessionPath)) {
      const folders = fs.readdirSync(this.sessionPath);
      for (const folder of folders) {
        const folderPath = path.join(this.sessionPath, folder);
        if (fs.statSync(folderPath).isDirectory()) {
          result.push({
            phoneNumber: folder,
            exists: true,
            size: this.getFolderSize(folderPath)
          });
        }
      }
    }

    return result;
  }

  getFolderSize(folderPath) {
    let size = 0;
    try {
      const files = fs.readdirSync(folderPath);
      for (const file of files) {
        const stats = fs.statSync(path.join(folderPath, file));
        size += stats.size;
      }
    } catch (error) {
      logger.error(`Error getting folder size: ${error.message}`);
    }
    return size > 0 ? `${(size / 1024).toFixed(2)} KB` : '0 KB';
  }
}

module.exports = new SessionManager();