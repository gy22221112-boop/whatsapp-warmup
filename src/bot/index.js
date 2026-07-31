require('dotenv').config();
const { logger } = require('../utils/logger');  // ✅ Правильно
const { initDatabase } = require('./database');
const whatsappManager = require('./whatsapp/manager');
const webhookServer = require('./webhook/server');
const { pool } = require('./database');

// ============================================
// ПРОВЕРКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ
// ============================================

function checkEnvVariables() {
  const required = ['TELEGRAM_BOT_TOKEN', 'DATABASE_URL'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    logger.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    return false;
  }
  
  return true;
}

// ============================================
// ОСНОВНАЯ ФУНКЦИЯ ЗАПУСКА
// ============================================

async function start() {
  try {
    logger.info('🚀 Starting WhatsApp Warmup Service...');
    logger.info(`📅 Started at: ${new Date().toISOString()}`);
    logger.info(`🖥️ Node version: ${process.version}`);
    logger.info(`📦 NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
    
    // Проверка переменных окружения
    if (!checkEnvVariables()) {
      logger.warn('⚠️ Some environment variables are missing. Service may not work correctly.');
    }
    
    // Инициализация базы данных
    logger.info('📊 Initializing database...');
    await initDatabase();
    logger.info('✅ Database initialized successfully');
    
    // Проверка подключения к базе
    try {
      const client = await pool.connect();
      const result = await client.query('SELECT NOW() as time');
      logger.info(`✅ Database connected at ${result.rows[0].time}`);
      client.release();
    } catch (error) {
      logger.error('❌ Database connection failed:', error.message);
      throw new Error('Database connection failed');
    }
    
    // Запуск webhook сервера
    logger.info('🌐 Starting webhook server...');
    await webhookServer.start();
    const port = process.env.PORT || 3000;
    logger.info(`✅ Webhook server running on port ${port}`);
    
    // Получаем все активные аккаунты
    const { WhatsAppAccountModel } = require('./database/models');
    const accounts = await WhatsAppAccountModel.getActiveAccounts();
    logger.info(`📱 Found ${accounts.length} active accounts in database`);
    
    // Запуск WhatsApp менеджера с задержкой
    if (accounts.length > 0) {
      logger.info('📱 Starting WhatsApp sessions...');
      setTimeout(async () => {
        try {
          await whatsappManager.startAllSessions();
          logger.info('✅ WhatsApp sessions started');
        } catch (error) {
          logger.error('❌ Failed to start WhatsApp sessions:', error);
        }
      }, 5000);
    } else {
      logger.info('📱 No active accounts to start. Add accounts through Telegram bot.');
    }
    
    // Вывод информации о сервисе
    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL || `http://localhost:${port}/webhook/telegram`;
    logger.info(`🌐 Webhook URL: ${webhookUrl}`);
    logger.info(`📊 Health check: http://localhost:${port}/health`);
    logger.info(`📊 Stats: http://localhost:${port}/stats`);
    
    // Проверка Telegram бота
    if (process.env.TELEGRAM_BOT_TOKEN) {
      try {
        const bot = require('./bot');
        logger.info('✅ Telegram bot configured');
      } catch (error) {
        logger.error('❌ Telegram bot error:', error.message);
      }
    }
    
    logger.info('🎯 Service is running!');
    logger.info('💡 Use your Telegram bot to manage WhatsApp accounts.');
    
  } catch (error) {
    logger.error('❌ Failed to start service:', error);
    process.exit(1);
  }
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  logger.info(`Shutdown time: ${new Date().toISOString()}`);
  
  try {
    // Закрываем все WhatsApp сессии
    const sessions = whatsappManager.getActiveSessions();
    if (sessions.length > 0) {
      logger.info(`📱 Closing ${sessions.length} WhatsApp sessions...`);
      let closed = 0;
      for (const phone of sessions) {
        try {
          await whatsappManager.disconnect(phone);
          closed++;
        } catch (error) {
          logger.error(`❌ Error disconnecting ${phone}:`, error.message);
        }
      }
      logger.info(`✅ Closed ${closed}/${sessions.length} sessions`);
    }
    
    // Останавливаем все прогревы
    const warmupService = require('./whatsapp/warmup');
    const accounts = await require('./database/models').WhatsAppAccountModel.getActiveAccounts();
    for (const account of accounts) {
      try {
        warmupService.stopWarmup(account.phone_number);
      } catch (error) {
        // Игнорируем ошибки остановки прогрева
      }
    }
    logger.info('✅ Warmup processes stopped');
    
    // Закрываем соединение с базой
    try {
      await pool.end();
      logger.info('✅ Database connection closed');
    } catch (error) {
      logger.error('❌ Error closing database:', error.message);
    }
    
    // Закрываем webhook сервер
    try {
      await webhookServer.stop();
      logger.info('✅ Webhook server stopped');
    } catch (error) {
      logger.error('❌ Error stopping webhook server:', error.message);
    }
    
    logger.info('✅ Graceful shutdown complete');
    process.exit(0);
    
  } catch (error) {
    logger.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

// ============================================
// ОБРАБОТКА СИГНАЛОВ
// ============================================

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGHUP', () => shutdown('SIGHUP'));

// ============================================
// ОБРАБОТКА НЕОБРАБОТАННЫХ ОШИБОК
// ============================================

// Необработанные rejection
process.on('unhandledRejection', (error, promise) => {
  logger.error('❌ Unhandled rejection:');
  logger.error('Error:', error);
  logger.error('Promise:', promise);
  if (error.stack) {
    logger.error('Stack:', error.stack);
  }
});

// Необработанные исключения
process.on('uncaughtException', (error) => {
  logger.error('❌ Uncaught exception:');
  logger.error('Error:', error);
  if (error.stack) {
    logger.error('Stack:', error.stack);
  }
  
  // При необработанном исключении пытаемся gracefully shutdown
  setTimeout(() => {
    shutdown('uncaughtException');
  }, 2000);
});

// ============================================
// ОБРАБОТКА ПЕРЕЗАГРУЗКИ (nodemon)
// ============================================

process.on('SIGUSR2', () => {
  logger.info('📌 Received SIGUSR2 (nodemon restart), cleaning up...');
  shutdown('SIGUSR2');
});

// ============================================
// ПЕРИОДИЧЕСКАЯ ПРОВЕРКА ЗДОРОВЬЯ
// ============================================

setInterval(async () => {
  try {
    // Проверка базы данных
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    
    // Проверка WhatsApp сессий
    const sessions = whatsappManager.getActiveSessions();
    logger.debug(`💚 Health check: ${sessions.length} active sessions`);
    
  } catch (error) {
    logger.error('❌ Health check failed:', error.message);
  }
}, 60000); // Каждую минуту

// ============================================
// ЗАПУСК
// ============================================

// Проверяем, что это не тестовый запуск
if (require.main === module) {
  start();
}

// Экспортируем для использования в тестах
module.exports = { start, shutdown };
