const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
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

const app = express();
app.use(express.json());

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// Обработка callback запросов
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;
  
  await bot.answerCallbackQuery(callbackQuery.id);

  try {
    switch(true) {
      case data === 'add_account':
        await bot.sendMessage(chatId, 
          '📱 *Добавление номера WhatsApp*\n\n' +
          'Введите номер телефона в одном из форматов:\n' +
          '• `+79123456789`\n' +
          '• `79123456789`\n' +
          '• `89123456789`\n\n' +
          'Или выберите способ подключения:',
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
        break;

      case data === 'qr_method':
        await bot.sendMessage(chatId,
          '📱 *Выберите номер для подключения по QR*\n\n' +
          'Введите номер телефона:',
          { parse_mode: 'Markdown' }
        );
        // Сохраняем состояние
        break;

      case data === 'code_method':
        await bot.sendMessage(chatId,
          '🔑 *Выберите номер для получения 8-значного кода*\n\n' +
          'Введите номер телефона:',
          { parse_mode: 'Markdown' }
        );
        break;

      case data === 'list_accounts':
        await showAccounts(chatId);
        break;

      case data === 'start_warmup':
        await startWarmup(chatId);
        break;

      case data === 'warmup_settings':
        await showWarmupSettings(chatId);
        break;

      case data === 'admin_panel':
        await showAdminPanel(chatId);
        break;

      case data === 'back_to_menu':
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
        break;

      case data === 'stats':
        await showStats(chatId);
        break;

      case data === 'all_users':
        await showAllUsers(chatId);
        break;

      case data === 'broadcast':
        await bot.sendMessage(chatId,
          '📢 *Рассылка*\n\nВведите сообщение для рассылки:',
          { parse_mode: 'Markdown' }
        );
        // Сохраняем состояние для рассылки
        break;

      case data.startsWith('delete_'):
        const phone = data.replace('delete_', '');
        await deleteAccount(chatId, phone);
        break;

      case data.startsWith('set_time_'):
        const time = parseInt(data.replace('set_time_', ''));
        await setWarmupTime(chatId, time);
        break;

      case data.startsWith('set_type_'):
        const type = data.replace('set_type_', '');
        await setWarmupType(chatId, type);
        break;

      case data.startsWith('refresh_qr_'):
        const phoneRefresh = data.replace('refresh_qr_', '');
        await bot.sendMessage(chatId, `🔄 Обновляю QR код для ${phoneRefresh}...`);
        const success = await whatsappManager.refreshQRCode(phoneRefresh, chatId);
        if (!success) {
          await bot.sendMessage(chatId, `❌ Не удалось обновить QR код. Попробуйте позже.`);
        }
        break;

      case data.startsWith('cancel_qr_'):
        const phoneCancel = data.replace('cancel_qr_', '');
        await whatsappManager.disconnect(phoneCancel);
        await bot.sendMessage(chatId,
          `❌ Подключение для ${phoneCancel} отменено`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
              ]
            }
          }
        );
        break;

      case data.startsWith('get_code_'):
        const phoneCode = data.replace('get_code_', '');
        try {
          const code = await whatsappManager.getPairingCode(phoneCode);
          await bot.sendMessage(chatId,
            `🔑 *8-значный код для номера:* \`${phoneCode}\`\n\n` +
            `📱 *Инструкция:*\n` +
            `1️⃣ Откройте WhatsApp на телефоне\n` +
            `2️⃣ Нажмите "Связанные устройства" → "Привязать устройство"\n` +
            `3️⃣ Выберите "Связать по номеру телефона"\n` +
            `4️⃣ Введите код: \`${code}\`\n\n` +
            `⏳ Код действителен 5 минут\n` +
            `🔒 Никому не сообщайте этот код!`,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔄 Получить новый код', callback_data: `get_code_${phoneCode}` }],
                  [{ text: '🔙 Назад', callback_data: 'list_accounts' }]
                ]
              }
            }
          );
        } catch (error) {
          await bot.sendMessage(chatId,
            `❌ Ошибка получения кода: ${error.message}`
          );
        }
        break;

      default:
        await bot.sendMessage(chatId, '❓ Неизвестная команда');
    }
  } catch (error) {
    logger.error('Callback error:', error);
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
  }
});

// Обработка текстовых сообщений
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === '/start') {
    await handleStart(chatId);
    return;
  }

  // Проверка на номер телефона
  if (validatePhoneNumber(text)) {
    await addPhoneNumber(chatId, text);
    return;
  }
});

// Функции обработчики
async function handleStart(chatId) {
  const user = await UserModel.create(chatId, 'user');
  
  await bot.sendMessage(chatId, 
    `👋 *Добро пожаловать в сервис прогрева WhatsApp!*\n\n` +
    `📱 Здесь вы можете автоматически прогревать ваши WhatsApp аккаунты.\n` +
    `🔄 Аккаунты будут общаться между собой естественно.\n\n` +
    `📊 *Статистика:*\n` +
    `• Аккаунтов: 0/10\n` +
    `• Активных: 0\n\n` +
    `Выберите действие ниже:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: mainMenuKeyboard
      }
    }
  );
}

async function addPhoneNumber(chatId, phoneNumber) {
  try {
    // Форматируем номер
    const formatted = formatPhoneNumber(phoneNumber);
    
    // Проверка лимита
    const accounts = await WhatsAppAccountModel.findByUser(chatId);
    if (accounts.length >= (process.env.MAX_ACCOUNTS || 10)) {
      await bot.sendMessage(chatId,
        `⚠️ Достигнут лимит аккаунтов (${process.env.MAX_ACCOUNTS || 10})`,
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

    // Проверка на дубликат
    const existing = await WhatsAppAccountModel.findByPhone(formatted);
    if (existing) {
      await bot.sendMessage(chatId,
        `❌ Номер ${formatted} уже добавлен`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Назад', callback_data: 'list_accounts' }]
            ]
          }
        }
      );
      return;
    }

    // Сохраняем аккаунт
    const account = await WhatsAppAccountModel.create(chatId, formatted);
    
    // Подключаем сессию
    await whatsappManager.initializeSession(formatted, chatId);

    await bot.sendMessage(chatId,
      `✅ Номер ${formatted} успешно добавлен\n\n` +
      `📱 Ожидайте QR код для подключения...\n` +
      `⏳ Время прогрева: ${account.warmup_time} часов (по умолчанию)\n\n` +
      `📋 Вы можете изменить настройки в меню "Настройки прогрева"`,
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

async function showAccounts(chatId) {
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
    const statusEmoji = {
      'pending': '⏳',
      'connected': '✅',
      'warming': '🔄',
      'warmed': '🔥',
      'disconnected': '❌'
    }[acc.status] || '❓';

    const statusText = {
      'pending': 'Ожидание',
      'connected': 'Подключен',
      'warming': 'Прогрев...',
      'warmed': 'Готов',
      'disconnected': 'Отключен'
    }[acc.status] || acc.status;

    message += `${index + 1}. ${statusEmoji} \`${acc.phone_number}\`\n`;
    message += `   📊 Статус: ${statusText}\n`;
    message += `   📨 Отпр: ${acc.messages_sent} | Пол: ${acc.messages_received}\n`;
    message += `   ⏰ ${acc.warmup_time}ч | ${acc.warmup_type === 'slow' ? '🐢 Медл' : acc.warmup_type === 'human' ? '👤 Человек' : '🚀 Быстр'}\n\n`;

    keyboard.push([{
      text: `🗑️ ${acc.phone_number.slice(-6)}`,
      callback_data: `delete_${acc.phone_number}`
    }]);
  });

  message += `\n📊 *Всего:* ${accounts.length}/${process.env.MAX_ACCOUNTS || 10}`;

  // Добавляем кнопки управления
  keyboard.push(
    [{ text: '➕ Добавить номер', callback_data: 'add_account' }],
    [{ text: '🚀 Запустить прогрев', callback_data: 'start_warmup' }],
    [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
  );

  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: keyboard
    }
  });
}

async function deleteAccount(chatId, phoneNumber) {
  try {
    await whatsappManager.disconnect(phoneNumber);
    await WhatsAppAccountModel.delete(phoneNumber, chatId);
    
    await bot.answerCallbackQuery({
      callback_query_id: chatId,
      text: `✅ Аккаунт ${phoneNumber} удален`,
      show_alert: true
    });

    await showAccounts(chatId);
  } catch (error) {
    await bot.sendMessage(chatId, `❌ Ошибка при удалении: ${error.message}`);
  }
}

async function startWarmup(chatId) {
  const accounts = await WhatsAppAccountModel.findByUser(chatId);
  const activeAccounts = accounts.filter(a => a.status === 'connected');

  if (activeAccounts.length < 2) {
    await bot.sendMessage(chatId,
      '⚠️ *Недостаточно аккаунтов для прогрева*\n\n' +
      `Требуется минимум 2 аккаунта. У вас: ${activeAccounts.length}\n` +
      'Добавьте больше аккаунтов и попробуйте снова.',
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

  // Запускаем прогревы для всех аккаунтов
  let started = 0;
  for (const account of activeAccounts) {
    try {
      await whatsappManager.initializeSession(account.phone_number, chatId);
      started++;
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      logger.error(`Failed to start warmup for ${account.phone_number}:`, error);
    }
  }

  await bot.sendMessage(chatId,
    `✅ *Прогрев запущен*\n\n` +
    `📱 Активных аккаунтов: ${started}/${activeAccounts.length}\n` +
    `⏳ Время прогрева: ${activeAccounts[0]?.warmup_time || 6} часов\n` +
    `🔄 Тип: ${activeAccounts[0]?.warmup_type === 'slow' ? '🐢 Медленно' : activeAccounts[0]?.warmup_type === 'human' ? '👤 Как человек' : '🚀 Быстро'}\n\n` +
    `📊 Следите за прогрессом в списке аккаунтов.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📊 Статус прогрева', callback_data: 'list_accounts' }],
          [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
        ]
      }
    }
  );
}

async function showWarmupSettings(chatId) {
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
}

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

// Админ-панель
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

async function showStats(chatId) {
  const stats = await WhatsAppAccountModel.getStats();
  const users = await UserModel.getAll();

  await bot.sendMessage(chatId,
    `📊 *Общая статистика*\n\n` +
    `👥 Всего пользователей: ${users.length}\n` +
    `📱 Всего аккаунтов: ${stats.total_accounts || 0}\n` +
    `✅ Активных: ${stats.active || 0}\n` +
    `📤 Отправлено сообщений: ${stats.total_sent || 0}\n` +
    `📥 Получено сообщений: ${stats.total_received || 0}`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Назад', callback_data: 'admin_panel' }]
        ]
      }
    }
  );
}

async function showAllUsers(chatId) {
  const users = await UserModel.getAll();
  
  if (users.length === 0) {
    await bot.sendMessage(chatId, '👥 Нет зарегистрированных пользователей');
    return;
  }

  let message = '👥 *Все пользователи:*\n\n';
  users.forEach((user, index) => {
    const accounts = WhatsAppAccountModel.findByUser(user.telegram_id);
    message += `${index + 1}. ${user.username || 'Без имени'} (${user.telegram_id})\n`;
  });

  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔙 Назад', callback_data: 'admin_panel' }]
      ]
    }
  });
}

// Настройка webhook
const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
if (process.env.NODE_ENV === 'production' && webhookUrl) {
  bot.setWebHook(webhookUrl)
    .then(() => logger.info('Webhook set successfully'))
    .catch(err => logger.error('Webhook error:', err));
}

// Экспортируем для использования в других модулях
module.exports = bot;
module.exports.showAccounts = showAccounts;
module.exports.showStats = showStats;