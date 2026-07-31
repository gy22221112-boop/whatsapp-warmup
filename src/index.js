require('dotenv').config();
const { logger } = require('./utils/logger');
const { initDatabase } = require('./database');
const webhookServer = require('./webhook/server');
const { pool } = require('./database');

// ============================================
// ГЛОБАЛЬНАЯ ОБРАБОТКА ОШИБОК
// ============================================

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled rejection:', error);
  console.error('Stack:', error.stack);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
  console.error('Stack:', error.stack);
  setTimeout(() => process.exit(1), 1000);
});

// ============================================
// ОСНОВНАЯ ФУНКЦИЯ
// ============================================

async function start() {
  try {
    console.log('🚀 Starting WhatsApp Warmup Service...');
    console.log(`📅 Started at: ${new Date().toISOString()}`);
    console.log(`🖥️ Node version: ${process.version}`);
    console.log(`📦 NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
    
    // Проверка переменных окружения
    const required = ['TELEGRAM_BOT_TOKEN', 'DATABASE_URL'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      console.warn(`⚠️ Missing environment variables: ${missing.join(', ')}`);
    }
    
    // Инициализация базы данных
    console.log('📊 Initializing database...');
    try {
      await initDatabase();
      console.log('✅ Database initialized');
    } catch (dbError) {
      console.error('❌ Database init failed:', dbError.message);
      throw dbError;
    }
    
    // Проверка подключения к базе
    try {
      const client = await pool.connect();
      const result = await client.query('SELECT NOW() as time');
      console.log(`✅ Database connected at ${result.rows[0].time}`);
      client.release();
    } catch (connError) {
      console.error('❌ Database connection failed:', connError.message);
      throw connError;
    }
    
    // Запуск webhook сервера
    console.log('🌐 Starting webhook server...');
    try {
      await webhookServer.start();
      const port = process.env.PORT || 3000;
      console.log(`✅ Webhook server running on port ${port}`);
    } catch (webError) {
      console.error('❌ Webhook server failed:', webError.message);
      throw webError;
    }
    
    // Запускаем WhatsApp менеджер
    console.log('📱 Initializing WhatsApp manager...');
    try {
      const whatsappManager = require('./whatsapp/manager');
      console.log('✅ WhatsApp manager initialized');
      
      // Запускаем сессии с задержкой
      setTimeout(async () => {
        try {
          await whatsappManager.startAllSessions();
          console.log('✅ WhatsApp sessions started');
        } catch (sessionError) {
          console.error('❌ Failed to start sessions:', sessionError.message);
        }
      }, 5000);
      
    } catch (waError) {
      console.error('❌ WhatsApp manager error:', waError.message);
      // Не падаем, продолжаем работу
    }
    
    // Инициализация бота
    console.log('🤖 Initializing Telegram bot...');
    try {
      const bot = require('./bot');
      console.log('✅ Telegram bot initialized');
    } catch (botError) {
      console.error('❌ Bot initialization failed:', botError.message);
      // Не падаем, просто логируем
    }
    
    console.log('🎯 Service is running!');
    console.log(`🌐 Webhook URL: ${process.env.TELEGRAM_WEBHOOK_URL || `http://localhost:${process.env.PORT || 3000}/webhook/telegram`}`);
    
  } catch (error) {
    console.error('❌ FATAL ERROR:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// ============================================
// ЗАПУСК
// ============================================

start();
