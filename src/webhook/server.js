const express = require('express');
const { logger } = require('../utils/logger');
require('dotenv').config();

const app = express();
app.use(express.json());

// ============================================
// WEBHOOK ДЛЯ TELEGRAM
// ============================================

app.post('/webhook/telegram', async (req, res) => {
  try {
    // Проверяем, что это запрос от Telegram
    if (!req.body || !req.body.update_id) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Получаем бота
    const bot = require('../bot');
    
    // Проверяем наличие метода processUpdate
    if (typeof bot.processUpdate === 'function') {
      // Обрабатываем обновление через бота
      await bot.processUpdate(req.body);
      logger.debug('Webhook processed successfully');
    } else {
      // Если метод отсутствует, создаем временный бот для обработки
      const TelegramBot = require('node-telegram-bot-api');
      const token = process.env.TELEGRAM_BOT_TOKEN;
      
      if (!token) {
        throw new Error('TELEGRAM_BOT_TOKEN not set');
      }
      
      const tempBot = new TelegramBot(token);
      await tempBot.processUpdate(req.body);
      logger.debug('Webhook processed with temporary bot');
    }
    
    // Отвечаем Telegram, что все хорошо
    res.sendStatus(200);
    
  } catch (error) {
    logger.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.version
  });
});

// ============================================
// СТАТИСТИКА
// ============================================

app.get('/stats', async (req, res) => {
  try {
    const { WhatsAppAccountModel } = require('../database/models');
    const stats = await WhatsAppAccountModel.getStats();
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Stats error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ============================================
// ПРОВЕРКА СТАТУСА АККАУНТОВ
// ============================================

app.get('/accounts', async (req, res) => {
  try {
    const { WhatsAppAccountModel } = require('../database/models');
    const accounts = await WhatsAppAccountModel.getActiveAccounts();
    res.json({
      success: true,
      count: accounts.length,
      data: accounts.map(a => ({
        phone: a.phone_number,
        status: a.status,
        messages_sent: a.messages_sent,
        messages_received: a.messages_received,
        warmup_time: a.warmup_time,
        warmup_type: a.warmup_type,
        last_active: a.last_active
      })),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Accounts error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ============================================
// ЗАПУСК СЕРВЕРА
// ============================================

let server = null;

function start() {
  return new Promise((resolve) => {
    const PORT = process.env.PORT || 3000;
    
    server = app.listen(PORT, () => {
      logger.info(`🌐 Webhook server running on port ${PORT}`);
      resolve(server);
    });
    
    // Обработка ошибок сервера
    server.on('error', (error) => {
      logger.error('Server error:', error);
    });
  });
}

function stop() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        logger.info('Webhook server stopped');
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// ============================================
// ЭКСПОРТ
// ============================================

module.exports = { app, start, stop };
