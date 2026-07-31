require('dotenv').config();
const { logger } = require('./utils/logger');
const { initDatabase } = require('./database');
const whatsappManager = require('./whatsapp/manager');
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
    
    // Запуск WhatsApp менеджера с задержкой
    setTimeout(async () => {
      await whatsappManager.startAllSessions();
      logger.info('✅ WhatsApp sessions started');
    }, 5000);
    
    logger.info('🎯 Service is running!');
    
    // Проверка подключения к базе
    const { pool } = require('./database');
    const client = await pool.connect();
    logger.info('✅ Database connection verified');
    client.release();
    
  } catch (error) {
    logger.error('❌ Failed to start service:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  
  // Закрываем все WhatsApp сессии
  const { pool } = require('./database');
  await pool.end();
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  
  // Закрываем все WhatsApp сессии
  const { pool } = require('./database');
  await pool.end();
  
  process.exit(0);
});

// Обработка ошибок
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
});

start();
