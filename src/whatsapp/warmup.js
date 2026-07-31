const { pool } = require('../database');
const { WhatsAppAccountModel } = require('../database/models');
const { logger } = require('../utils/logger');
const conversations = require('../data/conversations');

class WarmupService {
  constructor() {
    this.activeWarmups = new Map();
    this.messageTemplates = conversations;
    this.isRunning = false;
  }

  async startWarmup(phoneNumber) {
    try {
      const account = await WhatsAppAccountModel.findByPhone(phoneNumber);
      if (!account) {
        logger.error(`Account ${phoneNumber} not found`);
        return;
      }

      // Получаем другие аккаунты для общения
      const otherAccounts = await WhatsAppAccountModel.getActiveAccounts();
      const partners = otherAccounts.filter(a => a.phone_number !== phoneNumber);

      if (partners.length === 0) {
        logger.info(`No partners found for ${phoneNumber}`);
        return;
      }

      const warmupTime = account.warmup_time || 6;
      const warmupType = account.warmup_type || 'human';
      
      // Рассчитываем интервалы
      const messagesPerHour = this.getMessagesPerHour(warmupType);
      const totalMessages = messagesPerHour * warmupTime;
      const interval = (warmupTime * 3600000) / totalMessages;

      // Запускаем прогрев
      this.activeWarmups.set(phoneNumber, {
        account,
        partners,
        totalMessages,
        messagesSent: 0,
        interval,
        timer: null,
        isRunning: true,
        startTime: Date.now(),
        warmupType
      });

      logger.info(`Starting warmup for ${phoneNumber}: ${totalMessages} messages over ${warmupTime}h`);
      
      // Первое сообщение с задержкой
      setTimeout(() => {
        this.runWarmupLoop(phoneNumber);
      }, 30000 + Math.random() * 60000);

      // Обновляем статус
      await WhatsAppAccountModel.updateStatus(phoneNumber, 'warming');

    } catch (error) {
      logger.error(`Failed to start warmup for ${phoneNumber}:`, error);
    }
  }

  async runWarmupLoop(phoneNumber) {
    const warmup = this.activeWarmups.get(phoneNumber);
    if (!warmup || !warmup.isRunning) {
      return;
    }

    if (warmup.messagesSent >= warmup.totalMessages) {
      logger.info(`✅ Warmup completed for ${phoneNumber}`);
      await WhatsAppAccountModel.updateStatus(phoneNumber, 'warmed');
      this.activeWarmups.delete(phoneNumber);
      
      // Уведомляем пользователя
      const bot = require('../bot');
      const account = await WhatsAppAccountModel.findByPhone(phoneNumber);
      if (account) {
        await bot.sendMessage(account.user_telegram_id,
          `🔥 *Прогрев завершен для номера:* \`${phoneNumber}\`\n\n` +
          `📊 Отправлено: ${warmup.messagesSent} сообщений\n` +
          `⏱️ Время: ${Math.round((Date.now() - warmup.startTime) / 60000)} минут\n\n` +
          `✅ Аккаунт готов к работе!`
        );
      }
      return;
    }

    try {
      // Выбираем случайного партнера
      const partner = warmup.partners[Math.floor(Math.random() * warmup.partners.length)];
      
      // Выбираем шаблон сообщения
      const template = this.getRandomMessage(warmup.account.phone_number, partner.phone_number);
      
      // Отправляем сообщение
      await this.sendMessage(warmup.account.phone_number, partner.phone_number, template);
      
      warmup.messagesSent++;
      const progress = (warmup.messagesSent / warmup.totalMessages) * 100;

      // Логируем прогресс каждые 10%
      if (warmup.messagesSent % Math.round(warmup.totalMessages / 10) === 0) {
        logger.info(`📊 Warmup ${phoneNumber}: ${warmup.messagesSent}/${warmup.totalMessages} (${progress.toFixed(1)}%)`);
        
        // Уведомляем пользователя о прогрессе
        const bot = require('../bot');
        const account = await WhatsAppAccountModel.findByPhone(phoneNumber);
        if (account) {
          await bot.sendMessage(account.user_telegram_id,
            `📊 *Прогресс прогрева*\n\n` +
            `📱 Номер: \`${phoneNumber}\`\n` +
            `📨 Отправлено: ${warmup.messagesSent}/${warmup.totalMessages}\n` +
            `📈 Прогресс: ${progress.toFixed(1)}%\n` +
            `⏱️ Осталось: ~${Math.round((warmup.totalMessages - warmup.messagesSent) * warmup.interval / 3600000)} часов`
          );
        }
      }

    } catch (error) {
      logger.error(`Warmup error for ${phoneNumber}:`, error);
    }

    // Планируем следующее сообщение
    const delay = this.getDelay(warmup);
    warmup.timer = setTimeout(() => {
      this.runWarmupLoop(phoneNumber);
    }, delay);
  }

  async sendMessage(from, to, message) {
    try {
      const manager = require('./manager');
      const fromSession = manager.getSession(from);
      
      if (!fromSession) {
        logger.error(`Session not found for ${from}`);
        return;
      }

      const toJid = `${to}@s.whatsapp.net`;
      
      // Имитация набора текста
      await fromSession.sock.sendPresenceUpdate('composing', toJid);
      await this.sleep(2000 + Math.random() * 8000);
      
      // Отправка сообщения
      const sentMessage = await fromSession.sock.sendMessage(toJid, { 
        text: message
      });

      // Сохраняем в базу
      await pool.query(
        `INSERT INTO conversations (account_from, account_to, message) 
         VALUES ($1, $2, $3)`,
        [from, to, message]
      );

      // Обновляем статистику
      await WhatsAppAccountModel.updateStats(from, 1, 0);

      logger.debug(`Message sent from ${from} to ${to}`);

    } catch (error) {
      logger.error(`Failed to send message from ${from} to ${to}:`, error);
      
      // Если ошибка, пробуем переподключиться
      if (error.message.includes('logged out')) {
        const manager = require('./manager');
        const account = await WhatsAppAccountModel.findByPhone(from);
        if (account) {
          await manager.initializeSession(from, account.user_telegram_id);
        }
      }
    }
  }

  getDelay(warmup) {
    const baseDelay = warmup.interval;
    // Добавляем случайность ±40%
    const jitter = 0.6 + Math.random() * 0.8;
    return baseDelay * jitter;
  }

  getMessagesPerHour(type) {
    const speeds = {
      'slow': 2,
      'human': 5,
      'fast': 10
    };
    return speeds[type] || 5;
  }

  getRandomMessage(from, to) {
    const templates = this.messageTemplates;
    let template = templates[Math.floor(Math.random() * templates.length)];
    
    // Заменяем плейсхолдеры
    const names = ['Анна', 'Борис', 'Виктор', 'Галина', 'Дмитрий', 'Елена', 'Иван', 'Ксения', 'Леонид', 'Мария'];
    template = template.replace(/{name}/g, names[Math.floor(Math.random() * names.length)]);
    
    return template;
  }

  async handleIncomingMessage(phoneNumber, text, messageKey) {
    try {
      const warmup = this.activeWarmups.get(phoneNumber);
      if (!warmup || !warmup.isRunning) return;

      // Генерируем ответ с задержкой
      const delay = 5000 + Math.random() * 15000;
      
      setTimeout(async () => {
        // Получаем отправителя
        const fromJid = messageKey.remoteJid;
        const fromNumber = fromJid.replace('@s.whatsapp.net', '');
        
        // Проверяем, что это один из партнеров
        if (warmup.partners.some(p => p.phone_number === fromNumber)) {
          const response = this.generateResponse(text);
          await this.sendMessage(phoneNumber, fromNumber, response);
        }
      }, delay);

    } catch (error) {
      logger.error(`Failed to handle incoming message for ${phoneNumber}:`, error);
    }
  }

  generateResponse(text) {
    const responses = [
      'Привет! Да, всё хорошо :)',
      'Спасибо за сообщение!',
      'Понял, спасибо за информацию',
      'Да, согласен с тобой',
      'Интересно, расскажи подробнее',
      'Хорошо, договорились!',
      'Отлично, рад слышать!',
      'Спасибо, что написал(а)'
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stopWarmup(phoneNumber) {
    const warmup = this.activeWarmups.get(phoneNumber);
    if (warmup) {
      clearTimeout(warmup.timer);
      warmup.isRunning = false;
      this.activeWarmups.delete(phoneNumber);
      logger.info(`Warmup stopped for ${phoneNumber}`);
    }
  }

  getWarmupStatus(phoneNumber) {
    const warmup = this.activeWarmups.get(phoneNumber);
    if (!warmup) return null;
    
    return {
      totalMessages: warmup.totalMessages,
      messagesSent: warmup.messagesSent,
      progress: (warmup.messagesSent / warmup.totalMessages) * 100,
      isRunning: warmup.isRunning
    };
  }
}

module.exports = WarmupService;