const TelegramBot = require('node-telegram-bot-api');
const { UserModel, WhatsAppAccountModel } = require('../database/models');
const whatsappManager = require('../whatsapp/manager');
const { logger } = require('../utils/logger');
const { validatePhoneNumber, formatPhoneNumber } = require('../utils/helpers');
const { 
  mainMenuKeyboard, 
  accountMenuKeyboard, 
  warmupMenuKeyboard,
  adminKeyboard 
} = require('./keyboards');
require('dotenv').config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// ============================================
// ОБРАБОТЧИК КОМАНДЫ /start
// ============================================

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || 'user';

  await UserModel.create(chatId, username);

  await bot.sendMessage(chatId,
    `👋 *Добро пожаловать в WhatsApp Warmup Bot!*\n\n` +
    `🔥 *Автоматический прогрев WhatsApp аккаунтов*\n` +
    `🤖 Аккаунты общаются между собой как живые люди\n\n` +
    `📱 *Как это работает:*\n` +
    `1️⃣ Добавьте номер WhatsApp\n` +
    `2️⃣ Подключите через 8-значный код или QR\n` +
    `3️⃣ Нажмите "🚀 Запустить прогрев"\n` +
    `4️⃣ Аккаунты начнут общаться!\n\n` +
    `💡 *Для прогрева нужно минимум 2 аккаунта*`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: mainMenuKeyboard
      }
    }
  );
});

// ============================================
// ОБРАБОТЧИКИ CALLBACK ЗАПРОСОВ
// ============================================

bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;

  await bot.answerCallbackQuery(callbackQuery.id);

  try {
    // ============================================
    // ОБРАБОТКА ВСЕХ КОМАНД
    // ============================================

    // ---------- ДОБАВЛЕНИЕ НОМЕРА ----------
    if (data === 'add_account') {
      await bot.sendMessage(chatId,
        '📱 *Добавление номера WhatsApp*\n\n' +
        'Введите номер телефона в одном из форматов:\n' +
        '• `+79123456789`\n' +
        '• `79123456789`\n' +
        '• `89123456789`\n\n' +
        'Выберите способ подключения:',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📱 QR код', callback_data: 'qr_method' }],
              [{ text: '🔑 8-значный код', callback_data: 'code_method' }],
              [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
            ]
          }
        }
      );
      return;
    }

    if (data === 'qr_method') {
      await bot.sendMessage(chatId,
        '📱 *Отправьте номер для QR кода:*',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (data === 'code_method') {
      await bot.sendMessage(chatId,
        '🔑 *Отправьте номер для 8-значного кода:*',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // ---------- СПИСОК АККАУНТОВ ----------
    if (data === 'list_accounts') {
      await showAccounts(chatId);
      return;
    }

    // ---------- ЗАПУСК ПРОГРЕВА ----------
    if (data === 'start_warmup') {
      await startWarmup(chatId);
      return;
    }

    // ---------- СТАТИСТИКА ПРОГРЕВА ----------
    if (data === 'warmup_stats') {
      await showWarmupStats(chatId);
      return;
    }

    // ---------- НАСТРОЙКИ ----------
    if (data === 'warmup_settings') {
      await showWarmupSettings(chatId);
      return;
    }

    // ---------- АДМИН-ПАНЕЛЬ ----------
    if (data === 'admin_panel') {
      await showAdminPanel(chatId);
      return;
    }

    // ---------- НАЗАД В МЕНЮ ----------
    if (data === 'back_to_menu') {
      try {
        await bot.editMessageText(
          '👋 *Главное меню*\n\nВыберите действие:',
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: mainMenuKeyboard
            }
          }
        );
      } catch (error) {
        if (!error.message.includes('message is not modified')) {
          await bot.sendMessage(chatId,
            '👋 *Главное меню*\n\nВыберите действие:',
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: mainMenuKeyboard
              }
            }
          );
        }
      }
      return;
    }

    // ---------- ВЫБОР ВРЕМЕНИ ДЛЯ ПРОГРЕВА ----------
    if (data.startsWith('warmup_')) {
      const hours = parseInt(data.replace('warmup_', ''));
      await executeWarmup(chatId, hours);
      return;
    }

    // ---------- УДАЛЕНИЕ АККАУНТА ----------
    if (data.startsWith('delete_')) {
      const phoneToDelete = data.replace('delete_', '');
      await deleteAccount(chatId, phoneToDelete);
      return;
    }

    // ---------- НАСТРОЙКА ВРЕМЕНИ ----------
    if (data.startsWith('set_time_')) {
      const time = parseInt(data.replace('set_time_', ''));
      await setWarmupTime(chatId, time);
      return;
    }

    // ---------- НАСТРОЙКА ТИПА ----------
    if (data.startsWith('set_type_')) {
      const type = data.replace('set_type_', '');
      await setWarmupType(chatId, type);
      return;
    }

    // ---------- ПОЛУЧЕНИЕ 8-ЗНАЧНОГО КОДА ----------
    if (data.startsWith('get_code_')) {
      const phoneCode = data.replace('get_code_', '');
      await getPairingCode(chatId, phoneCode);
      return;
    }

    // ---------- ОБНОВЛЕНИЕ QR ----------
    if (data.startsWith('refresh_qr_')) {
      const phoneRefresh = data.replace('refresh_qr_', '');
      await bot.sendMessage(chatId, `🔄 Обновляю QR код для ${phoneRefresh}...`);
      const success = await whatsappManager.refreshQRCode(phoneRefresh, chatId);
      if (!success) {
        await bot.sendMessage(chatId, `❌ Не удалось обновить QR код.`);
      }
      return;
    }

    // ---------- ОТМЕНА QR ----------
    if (data.startsWith('cancel_qr_')) {
      const phoneCancel = data.replace('cancel_qr_', '');
      await whatsappManager.disconnect(phoneCancel);
      await bot.sendMessage(chatId, `❌ Подключение для ${phoneCancel} отменено`);
      return;
    }

    // ---------- НЕИЗВЕСТНАЯ КОМАНДА ----------
    await bot.sendMessage(chatId, '❓ Неизвестная команда');

  } catch (error) {
    logger.error('Callback error:', error);
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
  }
});

// ============================================
// ОБРАБОТЧИК ТЕКСТОВЫХ СООБЩЕНИЙ
// ============================================

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text && text.startsWith('/')) return;

  if (validatePhoneNumber(text)) {
    await addPhoneNumber(chatId, text);
  }
});

// ============================================
// АДМИНСКИЕ КОМАНДЫ
// ============================================

// ---------- /clean - очистка сессий ----------
bot.onText(/\/clean/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const user = await UserModel.findByTelegramId(chatId);
    if (!user?.is_admin) {
      await bot.sendMessage(chatId, '⛔ У вас нет прав администратора');
      return;
    }

    const fs = require('fs');
    const path = require('path');
    const sessionManager = require('../whatsapp/session');
    
    const sessionsPath = path.join(__dirname, '../../sessions');
    
    if (!fs.existsSync(sessionsPath)) {
      await bot.sendMessage(chatId, '📂 Папка с сессиями не найдена');
      return;
    }

    const folders = fs.readdirSync(sessionsPath);
    
    if (folders.length === 0) {
      await bot.sendMessage(chatId, '📂 Папка с сессиями пуста');
      return;
    }

    let deleted = 0;
    for (const folder of folders) {
      const folderPath = path.join(sessionsPath, folder);
      try {
        fs.rmSync(folderPath, { recursive: true, force: true });
        deleted++;
      } catch (error) {
        logger.error(`Failed to delete ${folder}:`, error);
      }
    }

    sessionManager.clearCache();

    await bot.sendMessage(chatId, 
      `✅ *Очистка сессий завершена*\n\n` +
      `🗑️ Удалено папок: ${deleted}\n` +
      `📂 Всего папок: ${folders.length}\n\n` +
      `🔄 Перезапустите сервис на Render.`,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
  }
});

// ---------- /cleandb - очистка базы ----------
bot.onText(/\/cleandb/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const user = await UserModel.findByTelegramId(chatId);
    if (!user?.is_admin) {
      await bot.sendMessage(chatId, '⛔ У вас нет прав администратора');
      return;
    }

    const { pool } = require('../database');
    
    await pool.query('DELETE FROM whatsapp_accounts');
    await pool.query('DELETE FROM conversations');
    await pool.query('DELETE FROM stats');
    
    await pool.query('ALTER SEQUENCE whatsapp_accounts_id_seq RESTART WITH 1');
    await pool.query('ALTER SEQUENCE conversations_id_seq RESTART WITH 1');
    await pool.query('ALTER SEQUENCE stats_id_seq RESTART WITH 1');

    await bot.sendMessage(chatId,
      `✅ *База данных полностью очищена*\n\n` +
      `🗑️ Удалено:\n` +
      `• Все аккаунты\n` +
      `• Все диалоги\n` +
      `• Вся статистика\n\n` +
      `🔄 Теперь вы можете добавлять новые номера.`,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
  }
});

// ---------- /restart - перезагрузка ----------
bot.onText(/\/restart/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const user = await UserModel.findByTelegramId(chatId);
    if (!user?.is_admin) {
      await bot.sendMessage(chatId, '⛔ У вас нет прав администратора');
      return;
    }

    await bot.sendMessage(chatId, 
      '🔄 *Перезагрузка сервиса...*\n\n' +
      'Очищаем кеш и переподключаем сессии...',
      { parse_mode: 'Markdown' }
    );

    const sessionManager = require('../whatsapp/session');
    sessionManager.clearCache();

    await whatsappManager.reconnectAll();

    await bot.sendMessage(chatId,
      '✅ *Сервис перезагружен*\n\n' +
      'Все сессии переподключены.\n' +
      'Проверьте статус аккаунтов в списке.',
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
  }
});

// ---------- /status - статус сессий ----------
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const user = await UserModel.findByTelegramId(chatId);
    if (!user?.is_admin) {
      await bot.sendMessage(chatId, '⛔ У вас нет прав администратора');
      return;
    }

    const sessionManager = require('../whatsapp/session');
    
    const allSessions = sessionManager.getAllSessions();
    const activeSessions = whatsappManager.getActiveSessions();
    
    let message = '📊 *Статус сессий*\n\n';
    message += `🟢 Активных: ${activeSessions.length}\n`;
    message += `📁 Всего сессий: ${allSessions.length}\n\n`;
    
    if (activeSessions.length > 0) {
      message += '*Активные:*\n';
      activeSessions.forEach(num => {
        message += `✅ ${num}\n`;
      });
    }
    
    if (allSessions.length > 0) {
      message += '\n*Все сессии:*\n';
      allSessions.forEach(s => {
        const status = activeSessions.includes(s.phoneNumber) ? '✅' : '❌';
        message += `${status} ${s.phoneNumber}\n`;
      });
    }

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

  } catch (error) {
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
  }
});

// ============================================
// ФУНКЦИИ ОБРАБОТЧИКИ
// ============================================

// ---------- ДОБАВЛЕНИЕ НОМЕРА ----------
async function addPhoneNumber(chatId, phoneNumber) {
  try {
    const formatted = formatPhoneNumber(phoneNumber);
    
    const accounts = await WhatsAppAccountModel.findByUser(chatId);
    const maxAccounts = parseInt(process.env.MAX_ACCOUNTS) || 10;
    
    if (accounts.length >= maxAccounts) {
      await bot.sendMessage(chatId,
        `⚠️ Достигнут лимит аккаунтов (${maxAccounts})`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
            ]
          }
        }
      );
      return;
    }

    const existing = await WhatsAppAccountModel.findByPhone(formatted);
    if (existing) {
      await bot.sendMessage(chatId,
        `❌ Номер ${formatted} уже добавлен`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📋 Список аккаунтов', callback_data: 'list_accounts' }],
              [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
            ]
          }
        }
      );
      return;
    }

    const account = await WhatsAppAccountModel.create(chatId, formatted);
    
    await whatsappManager.initializeSession(formatted, chatId);

    await bot.sendMessage(chatId,
      `✅ Номер ${formatted} успешно добавлен\n\n` +
      `📱 Ожидайте QR код для подключения...\n` +
      `⏳ Время прогрева: ${account.warmup_time} часов (по умолчанию)\n\n` +
      `📋 Вы можете изменить настройки в меню "⚙️ Настройки"`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Список аккаунтов', callback_data: 'list_accounts' }],
            [{ text: '⚙️ Настройки', callback_data: 'warmup_settings' }],
            [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
          ]
        }
      }
    );
  } catch (error) {
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
  }
}

// ---------- ПОЛУЧЕНИЕ 8-ЗНАЧНОГО КОДА ----------
async function getPairingCode(chatId, phoneNumber) {
  try {
    await bot.sendMessage(chatId, `🔄 Получаю код для ${phoneNumber}...`);
    
    const code = await whatsappManager.getPairingCode(phoneNumber);
    
    await bot.sendMessage(chatId,
      `🔑 *8-значный код для номера:* \`${phoneNumber}\`\n\n` +
      `📱 *Инструкция:*\n` +
      `1️⃣ Откройте WhatsApp на телефоне\n` +
      `2️⃣ Настройки → Связанные устройства → Связывание устройства\n` +
      `3️⃣ Выберите "Связать по номеру телефона"\n` +
      `4️⃣ Введите код: \`${code}\`\n\n` +
      `⏳ Код действителен 5 минут\n` +
      `🔒 Никому не сообщайте этот код!`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Получить новый код', callback_data: `get_code_${phoneNumber}` }],
            [{ text: '📋 Список аккаунтов', callback_data: 'list_accounts' }]
          ]
        }
      }
    );
  } catch (error) {
    await bot.sendMessage(chatId, `❌ Ошибка получения кода: ${error.message}`);
  }
}

// ---------- СПИСОК АККАУНТОВ ----------
async function showAccounts(chatId) {
  try {
    const accounts = await WhatsAppAccountModel.findByUser(chatId);
    
    if (accounts.length === 0) {
      await bot.sendMessage(chatId,
        '📭 *У вас нет добавленных аккаунтов*\n\n' +
        'Нажмите "➕ Добавить номер" чтобы начать',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '➕ Добавить номер', callback_data: 'add_account' }],
              [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
            ]
          }
        }
      );
      return;
    }

    let message = '📋 *Ваши WhatsApp аккаунты:*\n\n';
    const keyboard = [];

    accounts.forEach((acc, index) => {
      const statusMap = {
        'pending': { emoji: '⏳', text: 'Ожидание' },
        'connected': { emoji: '✅', text: 'Подключен' },
        'warming': { emoji: '🔄', text: 'Прогрев...' },
        'warmed': { emoji: '🔥', text: 'Готов' },
        'disconnected': { emoji: '❌', text: 'Отключен' }
      };
      
      const status = statusMap[acc.status] || { emoji: '❓', text: acc.status };
      const typeMap = { 'slow': '🐢', 'human': '👤', 'fast': '🚀' };

      message += `${index + 1}. ${status.emoji} \`${acc.phone_number}\`\n`;
      message += `   📊 ${status.text}\n`;
      message += `   📨 Отпр: ${acc.messages_sent} | Пол: ${acc.messages_received}\n`;
      message += `   ⏰ ${acc.warmup_time}ч | ${typeMap[acc.warmup_type] || '👤'}\n\n`;

      keyboard.push([{
        text: `🗑️ ${acc.phone_number.slice(-6)}`,
        callback_data: `delete_${acc.phone_number}`
      }]);
    });

    message += `\n📊 *Всего:* ${accounts.length}/${process.env.MAX_ACCOUNTS || 10}`;

    keyboard.push(
      [{ text: '➕ Добавить номер', callback_data: 'add_account' }],
      [{ text: '🚀 Запустить прогрев', callback_data: 'start_warmup' }],
      [{ text: '📊 Статистика прогрева', callback_data: 'warmup_stats' }],
      [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
    );

    await bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });

  } catch (error) {
    logger.error(`Error showing accounts: ${error.message}`);
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
  }
}

// ---------- УДАЛЕНИЕ АККАУНТА ----------
async function deleteAccount(chatId, phoneNumber) {
  try {
    await whatsappManager.disconnect(phoneNumber);
    await WhatsAppAccountModel.delete(phoneNumber, chatId);
    
    await bot.sendMessage(chatId, `✅ Аккаунт ${phoneNumber} удален`);
    await showAccounts(chatId);

  } catch (error) {
    logger.error(`Error deleting account: ${error.message}`);
    await bot.sendMessage(chatId, `❌ Ошибка при удалении: ${error.message}`);
  }
}

// ---------- ЗАПУСК ПРОГРЕВА ----------
async function startWarmup(chatId) {
  try {
    const accounts = await WhatsAppAccountModel.findByUser(chatId);
    const connectedAccounts = accounts.filter(a => a.status === 'connected');

    if (connectedAccounts.length < 2) {
      await bot.sendMessage(chatId,
        `⚠️ *Недостаточно аккаунтов для прогрева*\n\n` +
        `📱 Требуется минимум 2 аккаунта в статусе "✅ Подключен"\n` +
        `👤 У вас: ${connectedAccounts.length}\n\n` +
        `➕ Добавьте больше аккаунтов и попробуйте снова.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '➕ Добавить номер', callback_data: 'add_account' }],
              [{ text: '📋 Список аккаунтов', callback_data: 'list_accounts' }],
              [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
            ]
          }
        }
      );
      return;
    }

    await bot.sendMessage(chatId,
      `🚀 *Запуск прогрева*\n\n` +
      `📱 Аккаунтов: ${connectedAccounts.length}\n` +
      `⏰ Выберите время прогрева:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⏰ 6 часов', callback_data: 'warmup_6' }],
            [{ text: '⏰ 12 часов', callback_data: 'warmup_12' }],
            [{ text: '⏰ 24 часа', callback_data: 'warmup_24' }],
            [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
          ]
        }
      }
    );

  } catch (error) {
    logger.error(`Error starting warmup: ${error.message}`);
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
  }
}

// ---------- ЗАПУСК ПРОГРЕВА С ВЫБРАННЫМ ВРЕМЕНЕМ ----------
async function executeWarmup(chatId, hours) {
  try {
    const accounts = await WhatsAppAccountModel.findByUser(chatId);
    const connectedAccounts = accounts.filter(a => a.status === 'connected');

    for (const account of connectedAccounts) {
      await WhatsAppAccountModel.updateWarmupSettings(
        account.phone_number, 
        hours, 
        'human'
      );
    }

    let started = 0;
    for (const account of connectedAccounts) {
      try {
        const result = await whatsappManager.startWarmupManually(account.phone_number);
        if (result) {
          started++;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        logger.error(`Failed to start warmup for ${account.phone_number}:`, error);
      }
    }

    await bot.sendMessage(chatId,
      `✅ *Прогрев запущен!*\n\n` +
      `📱 Аккаунтов: ${started}/${connectedAccounts.length}\n` +
      `⏰ Время: ${hours} часов\n` +
      `🔄 Аккаунты начали общаться!\n\n` +
      `📊 Следите за прогрессом в "📊 Статистика прогрева"`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📊 Статистика прогрева', callback_data: 'warmup_stats' }],
            [{ text: '📋 Список аккаунтов', callback_data: 'list_accounts' }],
            [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
          ]
        }
      }
    );

  } catch (error) {
    logger.error(`Error executing warmup: ${error.message}`);
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
  }
}

// ---------- СТАТИСТИКА ПРОГРЕВА ----------
async function showWarmupStats(chatId) {
  try {
    const accounts = await WhatsAppAccountModel.findByUser(chatId);
    
    if (accounts.length === 0) {
      await bot.sendMessage(chatId, '📭 У вас нет аккаунтов');
      return;
    }

    let message = '📊 *Статистика прогрева*\n\n';
    let hasActiveWarmup = false;
    
    const warmupService = require('../whatsapp/warmup');
    
    for (const acc of accounts) {
      const statusMap = {
        'pending': '⏳ Ожидание',
        'connected': '✅ Подключен',
        'warming': '🔄 Прогрев...',
        'warmed': '🔥 Готов',
        'disconnected': '❌ Отключен'
      };
      
      const status = statusMap[acc.status] || acc.status;
      const progress = warmupService.getWarmupStatus(acc.phone_number);
      
      message += `📱 *${acc.phone_number}*\n`;
      message += `   Статус: ${status}\n`;
      message += `   📤 Отправлено: ${acc.messages_sent}\n`;
      message += `   📥 Получено: ${acc.messages_received}\n`;
      message += `   ⏰ Время: ${acc.warmup_time}ч\n`;
      
      if (progress && progress.isRunning) {
        message += `   📈 Прогресс: ${progress.progress.toFixed(1)}%\n`;
        message += `   👥 Партнеров: ${progress.partners}\n`;
        message += `   📨 Сообщений: ${progress.messagesSent}/${progress.totalMessages}\n`;
        hasActiveWarmup = true;
      } else if (acc.status === 'warming') {
        message += `   ⏳ Прогрев запускается...\n`;
      }
      
      message += '\n';
    }

    if (!hasActiveWarmup) {
      message += `\n🔴 *Прогрев не запущен*\n`;
      message += `Нажмите "🚀 Запустить прогрев" для начала.\n`;
    }

    await bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Обновить', callback_data: 'warmup_stats' }],
          [{ text: '🚀 Запустить прогрев', callback_data: 'start_warmup' }],
          [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
        ]
      }
    });

  } catch (error) {
    logger.error(`Error showing warmup stats: ${error.message}`);
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
  }
}

// ---------- НАСТРОЙКИ ПРОГРЕВА ----------
async function showWarmupSettings(chatId) {
  try {
    const accounts = await WhatsAppAccountModel.findByUser(chatId);
    let currentTime = 6;
    let currentType = 'human';
    
    if (accounts.length > 0) {
      currentTime = accounts[0].warmup_time || 6;
      currentType = accounts[0].warmup_type || 'human';
    }

    await bot.sendMessage(chatId,
      `⚙️ *Настройки прогрева*\n\n` +
      `⏰ Текущее время: ${currentTime} часов\n` +
      `📊 Текущий тип: ${currentType === 'slow' ? '🐢 Медленно' : currentType === 'human' ? '👤 Как человек' : '🚀 Быстро'}\n\n` +
      `Выберите новые параметры:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: warmupMenuKeyboard(currentTime, currentType)
        }
      }
    );

  } catch (error) {
    logger.error(`Error showing warmup settings: ${error.message}`);
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
  }
}

// ---------- УСТАНОВКА ВРЕМЕНИ ----------
async function setWarmupTime(chatId, hours) {
  const accounts = await WhatsAppAccountModel.findByUser(chatId);
  if (accounts.length > 0) {
    for (const acc of accounts) {
      await WhatsAppAccountModel.updateWarmupSettings(
        acc.phone_number, 
        hours, 
        acc.warmup_type
      );
    }
  }

  await bot.sendMessage(chatId,
    `✅ *Время прогрева установлено: ${hours} часов*\n\n` +
    `Новые настройки применены ко всем аккаунтам.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Назад', callback_data: 'warmup_settings' }]
        ]
      }
    }
  );
}

// ---------- УСТАНОВКА ТИПА ----------
async function setWarmupType(chatId, type) {
  const typeLabels = {
    'slow': '🐢 Медленно',
    'human': '👤 Как человек',
    'fast': '🚀 Быстро'
  };

  const accounts = await WhatsAppAccountModel.findByUser(chatId);
  if (accounts.length > 0) {
    for (const acc of accounts) {
      await WhatsAppAccountModel.updateWarmupSettings(
        acc.phone_number, 
        acc.warmup_time, 
        type
      );
    }
  }

  await bot.sendMessage(chatId,
    `✅ *Тип прогрева установлен: ${typeLabels[type]}*\n\n` +
    `Новые настройки применены ко всем аккаунтам.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Назад', callback_data: 'warmup_settings' }]
        ]
      }
    }
  );
}

// ---------- АДМИН-ПАНЕЛЬ ----------
async function showAdminPanel(chatId) {
  const user = await UserModel.findByTelegramId(chatId);
  if (!user?.is_admin) {
    await bot.sendMessage(chatId, '⛔ У вас нет прав администратора');
    return;
  }

  const stats = await WhatsAppAccountModel.getStats();

  await bot.sendMessage(chatId,
    `⚙️ *Админ-панель*\n\n` +
    `📊 Общая статистика:\n` +
    `📱 Всего аккаунтов: ${stats.total_accounts || 0}\n` +
    `✅ Активных: ${stats.active || 0}\n` +
    `📤 Отправлено: ${stats.total_sent || 0}\n` +
    `📥 Получено: ${stats.total_received || 0}\n\n` +
    `Выберите действие:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: adminKeyboard
      }
    }
  );
}

// ============================================
// НАСТРОЙКА WEBHOOK
// ============================================

const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
if (process.env.NODE_ENV === 'production' && webhookUrl) {
  bot.setWebHook(webhookUrl)
    .then(() => logger.info('Webhook set successfully'))
    .catch(err => logger.error('Webhook error:', err));
}

// ============================================
// ЭКСПОРТ
// ============================================

module.exports = bot;
