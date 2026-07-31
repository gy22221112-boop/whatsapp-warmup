const express = require('express');
const { logger } = require('../utils/logger');
require('dotenv').config();

const app = express();
app.use(express.json());

// Webhook для Telegram
app.post('/webhook/telegram', (req, res) => {
  try {
    const bot = require('../bot');
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    logger.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Статистика
app.get('/stats', async (req, res) => {
  try {
    const { WhatsAppAccountModel } = require('../database/models');
    const stats = await WhatsAppAccountModel.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

let server = null;

function start() {
  const PORT = process.env.PORT || 3000;
  
  return new Promise((resolve) => {
    server = app.listen(PORT, () => {
      logger.info(`🌐 Webhook server running on port ${PORT}`);
      resolve(server);
    });
  });
}

function stop() {
  if (server) {
    server.close();
  }
}

module.exports = { app, start, stop };