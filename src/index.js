require('dotenv').config();
const { logger } = require('./utils/logger');
const { initDatabase } = require('./database');
const whatsappManager = require('./whatsapp/manager');
const bot = require('./bot');
const webhookServer = require('./webhook/server');

async function start() {
  try {
    logger.info('🚀 Starting WhatsApp Warmup Service...');
    
    // Инициализация базы данных
    await initDatabase();
    logger.info('✅ Database initialized');
    
    // Запуск webhook сервера
    await webhookServer.start();
    logger.info('✅ Webhook server started');
    
    // Запуск WhatsApp менеджера
    await whatsappManager.startAllSessions();
    logger.info('✅ WhatsApp sessions started');
    
    logger.info('🎯 Service is running!');
  } catch (error) {
    logger.error('❌ Failed to start service:', error);
    process.exit(1);
  }
}

// Обработка ошибок
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
});

start();