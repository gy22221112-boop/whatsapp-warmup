const TelegramBot = require('node-telegram-bot-api');
const { UserModel, WhatsAppAccountModel, PaymentModel } = require('../database/models');
const whatsappManager = require('../whatsapp/manager');
const { logger } = require('../utils/logger');
const { validatePhoneNumber, formatPhoneNumber } = require('../utils/helpers');
const { getPrices } = require('../payments/cryptobot');
const {
  mainMenuKeyboard,
  accountMenuKeyboard,
  warmupMenuKeyboard,
  adminKeyboard,
  pricingKeyboard,
  settingsKeyboard,
  referralKeyboard
} = require('./keyboards');
require('dotenv').config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// ============================================
// ОБРАБОТЧИК КОМАНДЫ /start
// ============================================

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || 'user';
  const referralCode = msg.text.split(' ')[1];

  let user = await UserModel.findByTelegramId(chatId);
  
  if (!user) {
    user = await UserModel.create(chatId, username);
    
    if (referralCode) {
      const referrer = await UserModel.findByTelegramId(parseInt(referralCode));
      if (referrer && referrer.telegram_id !== chatId) {
        await UserModel.updateReferrals(chatId, referrer.telegram_id);
        await bot.sendMessage(chatId,
          `🎉 *Вы активировали реферальную ссылку!*\n\n` +
          `Вы получили +1 час бесплатного прогрева! 🔥`
        );
      }
    }
  }

  const prices = getPrices();
  const stats = await WhatsAppAccountModel.getStats();

  await bot.sendMessage(chatId,
    `👋 *Добро пожаловать в WhatsApp Warmup Bot!*\n\n` +
    `🔥 *Прогрев WhatsApp аккаунтов*\n` +
    `🤖 Автоматическое общение между аккаунтами\n\n` +
    `📊 *Статистика:*\n` +
    `• Всего аккаунтов: ${stats.total_accounts || 0}\n` +
    `• Активных: ${stats.active || 0}\n` +
    `• Твои бонусные часы: ${user.bonus_hours || 0}ч\n\n` +
    `💰 *Цены:*\n` +
    `• 6 часов — $${prices[6]}\n` +
    `• 12 часов — $${prices[12]}\n` +
    `• 24 часа — $${prices[24]}\n\n` +
    `🎁 *Первый раз 6 часов БЕСПЛАТНО!*`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: mainMenuKeyboard
      }
    }
  );
});

// ============================================
// ОБРАБОТЧИКИ CALLBACK
// ============================================

bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;

  await bot.answerCallbackQuery(callbackQuery.id);

  try {
    switch (data) {
      case 'add_account':
        await bot.sendMessage(chatId,
          '📱 *Добавление номера WhatsApp*\n\n' +
          'Введите номер телефона:\n' +
          '• `+79123456789`\n' +
          '• `79123456789`\n\n' +
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
        break;

      case 'qr_method':
        await bot.sendMessage(chatId, '📱 *Отправьте номер для QR кода:*', { parse_mode: 'Markdown' });
        break;

      case 'code_method':
        await bot.sendMessage(chatId, '🔑 *Отправьте номер для 8-значного кода:*', { parse_mode: 'Markdown' });
        break;

      case 'list_accounts':
        await showAccounts(chatId);
        break;

      case 'start_warmup':
        await showWarmupOptions(chatId);
        break;

      case 'warmup_settings':
        await showWarmupSettings(chatId);
        break;

      case 'admin_panel':
        await showAdminPanel(chatId);
        break;

      case 'referral':
        await showReferral(chatId);
        break;

      case 'pricing':
        await showPricing(chatId);
        break;

      case 'back_to_menu':
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

      case 'buy_6h':
      case 'buy_12h':
      case 'buy_24h':
        await handlePurchase(chatId, data.replace('buy_', ''));
        break;

      default:
        if (data.startsWith('delete_')) {
          const phone = data.replace('delete_', '');
          await deleteAccount(chatId, phone);
        } else if (data.startsWith('set_time_')) {
          const time = parseInt(data.replace('set_time_', ''));
          await setWarmupTime(chatId, time);
        } else if (data.startsWith('set_type_')) {
          const type = data.replace('set_type_', '');
          await setWarmupType(chatId, type);
        } else if (data.startsWith('get_code_')) {
          const phone = data.replace('get_code_', '');
          await getPairingCode(chatId, phone);
        }
        break;
    }
  } catch (error) {
    logger.error('Callback error:', error);
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
  }
});

// ============================================
// ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ
// ============================================

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text.startsWith('/')) return;

  if (validatePhoneNumber(text)) {
    await addPhoneNumber(chatId, text);
  }
});

// ============================================
// ФУНКЦИИ
// ============================================

// ---- ДОБАВЛЕНИЕ НОМЕРА ----
async function addPhoneNumber(chatId, phoneNumber) {
  try {
    const formatted = formatPhoneNumber(phoneNumber);
    const accounts = await WhatsAppAccountModel.findByUser(chatId);
    const maxAccounts = parseInt(process.env.MAX_ACCOUNTS) || 10;

    if (accounts.length >= maxAccounts) {
      await bot.sendMessage(chatId, `⚠️ Достигнут лимит аккаунтов (${maxAccounts})`);
      return;
    }

    const existing = await WhatsAppAccountModel.findByPhone(formatted);
    if (existing) {
      await bot.sendMessage(chatId, `❌ Номер ${formatted} уже добавлен`);
      return;
    }

    await WhatsAppAccountModel.create(chatId, formatted);
    await whatsappManager.initializeSession(formatted, chatId);

    await bot.sendMessage(chatId,
      `✅ Номер ${formatted} успешно добавлен\n\n` +
      `📱 Ожидайте QR код для подключения...`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
  }
}

// ---- ПОЛУЧЕНИЕ КОДА ----
async function getPairingCode(chatId, phoneNumber) {
  try {
    const code = await whatsappManager.getPairingCode(phoneNumber);
    await bot.sendMessage(chatId,
      `🔑 *8-значный код для номера:* \`${phoneNumber}\`\n\n` +
      `1️⃣ Откройте WhatsApp на телефоне\n` +
      `2️⃣ Нажмите "Связанные устройства" → "Привязать устройство"\n` +
      `3️⃣ Выберите "Связать по номеру телефона"\n` +
      `4️⃣ Введите код: \`${code}\``,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
  }
}

// ---- СПИСОК АККАУНТОВ ----
async function showAccounts(chatId) {
  const accounts = await WhatsAppAccountModel.findByUser(chatId);

  if (accounts.length === 0) {
    await bot.sendMessage(chatId, '📭 *У вас нет добавленных аккаунтов*', { parse_mode: 'Markdown' });
    return;
  }

  let message = '📋 *Ваши WhatsApp аккаунты:*\n\n';
  const keyboard = [];

  accounts.forEach((acc, index) => {
    const statusMap = {
      'pending': '⏳ Ожидание',
      'connected': '✅ Подключен',
      'warming': '🔄 Прогрев...',
      'warmed': '🔥 Готов',
      'disconnected': '❌ Отключен'
    };

    message += `${index + 1}. ${statusMap[acc.status] || '❓'} \`${acc.phone_number}\`\n`;
    message += `   📨 Отпр: ${acc.messages_sent} | Пол: ${acc.messages_received}\n`;
    message += `   ⏰ ${acc.warmup_time}ч\n\n`;

    keyboard.push([{
      text: `🗑️ ${acc.phone_number.slice(-6)}`,
      callback_data: `delete_${acc.phone_number}`
    }]);
  });

  message += `\n📊 *Всего:* ${accounts.length}/${process.env.MAX_ACCOUNTS || 10}`;

  keyboard.push(
    [{ text: '➕ Добавить номер', callback_data: 'add_account' }],
    [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
  );

  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
}

// ---- УДАЛЕНИЕ АККАУНТА ----
async function deleteAccount(chatId, phoneNumber) {
  try {
    await whatsappManager.disconnect(phoneNumber);
    await WhatsAppAccountModel.delete(phoneNumber, chatId);
    await bot.sendMessage(chatId, `✅ Аккаунт ${phoneNumber} удален`);
    await showAccounts(chatId);
  } catch (error) {
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
  }
}

// ---- НАСТРОЙКИ ПРОГРЕВА ----
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
  for (const acc of accounts) {
    await WhatsAppAccountModel.updateWarmupSettings(acc.phone_number, hours, acc.warmup_type);
  }
  await bot.sendMessage(chatId, `✅ *Время прогрева установлено: ${hours} часов*`, { parse_mode: 'Markdown' });
}

async function setWarmupType(chatId, type) {
  const typeLabels = { 'slow': '🐢 Медленно', 'human': '👤 Как человек', 'fast': '🚀 Быстро' };
  const accounts = await WhatsAppAccountModel.findByUser(chatId);
  for (const acc of accounts) {
    await WhatsAppAccountModel.updateWarmupSettings(acc.phone_number, acc.warmup_time, type);
  }
  await bot.sendMessage(chatId, `✅ *Тип прогрева установлен: ${typeLabels[type]}*`, { parse_mode: 'Markdown' });
}

// ---- ОПЦИИ ПРОГРЕВА ----
async function showWarmupOptions(chatId) {
  const accounts = await WhatsAppAccountModel.findByUser(chatId);
  const connected = accounts.filter(a => a.status === 'connected');

  if (connected.length < 2) {
    await bot.sendMessage(chatId,
      `⚠️ *Недостаточно аккаунтов*\n\nТребуется минимум 2 аккаунта. У вас: ${connected.length}`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const prices = getPrices();
  await bot.sendMessage(chatId,
    `💰 *Выберите время прогрева*\n\n` +
    `👤 Аккаунтов: ${connected.length}\n\n` +
    `⏰ 6 часов — $${prices[6]}\n` +
    `⏰ 12 часов — $${prices[12]}\n` +
    `⏰ 24 часа — $${prices[24]}\n\n` +
    `🎯 *Первый прогресс 6 часов БЕСПЛАТНО!*`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: pricingKeyboard
      }
    }
  );
}

// ---- ПОКУПКА ----
async function handlePurchase(chatId, hours) {
  const user = await UserModel.findByTelegramId(chatId);

  // Проверка на первый бесплатный прогрев
  const payments = await PaymentModel.getByUser(chatId);
  const hasFree = payments.filter(p => p.status === 'completed').length === 0;

  if (hasFree) {
    await bot.sendMessage(chatId,
      `🎉 *Поздравляю!*\n\nЭто ваш первый прогрев — 6 часов БЕСПЛАТНО! 🔥`,
      { parse_mode: 'Markdown' }
    );
    await startWarmup(chatId, 6);
    return;
  }

  // Проверка бонусных часов
  if (user.bonus_hours >= parseInt(hours)) {
    await UserModel.addBonusHours(chatId, -parseInt(hours));
    await bot.sendMessage(chatId,
      `🎁 *Использованы бонусные часы!*\n\nОсталось: ${user.bonus_hours - parseInt(hours)}ч`,
      { parse_mode: 'Markdown' }
    );
    await startWarmup(chatId, parseInt(hours));
    return;
  }

  await bot.sendMessage(chatId,
    `💳 *Оплата*\n\nСумма: $${getPrices()[hours]}\nВремя: ${hours} часов\n\n` +
    `Оплата через @CryptoBot (в разработке)`,
    { parse_mode: 'Markdown' }
  );
}

// ---- ЗАПУСК ПРОГРЕВА ----
async function startWarmup(chatId, hours) {
  const accounts = await WhatsAppAccountModel.findByUser(chatId);
  const connected = accounts.filter(a => a.status === 'connected');

  for (const account of connected) {
    await WhatsAppAccountModel.updateWarmupSettings(account.phone_number, hours, 'human');
    await whatsappManager.initializeSession(account.phone_number, chatId);
  }

  await bot.sendMessage(chatId,
    `✅ *Прогрев запущен на ${hours} часов!*\n\n📱 Аккаунтов: ${connected.length}\n🔄 Аккаунты начали общаться!`,
    { parse_mode: 'Markdown' }
  );
}

// ---- РЕФЕРАЛКА ----
async function showReferral(chatId) {
  const user = await UserModel.findByTelegramId(chatId);
  const referrals = await UserModel.getReferrals(chatId);
  const botInfo = await bot.getMe();
  const refLink = `https://t.me/${botInfo.username}?start=${chatId}`;

  await bot.sendMessage(chatId,
    `📢 *Реферальная программа*\n\n` +
    `🔗 *Твоя ссылка:*\n\`${refLink}\`\n\n` +
    `👥 Приглашено: ${referrals.length}\n` +
    `🎁 Бонусов: ${user.bonus_hours || 0}ч`,
    { parse_mode: 'Markdown' }
  );
}

// ---- ЦЕНЫ ----
async function showPricing(chatId) {
  const prices = getPrices();
  await bot.sendMessage(chatId,
    `💰 *Цены на прогрев*\n\n` +
    `⏰ 6 часов — $${prices[6]}\n` +
    `⏰ 12 часов — $${prices[12]}\n` +
    `⏰ 24 часа — $${prices[24]}\n\n` +
    `💳 *Оплата через @CryptoBot*`,
    { parse_mode: 'Markdown' }
  );
}

// ---- АДМИН-ПАНЕЛЬ ----
async function showAdminPanel(chatId) {
  const user = await UserModel.findByTelegramId(chatId);
  if (!user?.is_admin) {
    await bot.sendMessage(chatId, '⛔ У вас нет прав администратора');
    return;
  }

  const stats = await WhatsAppAccountModel.getStats();
  await bot.sendMessage(chatId,
    `⚙️ *Админ-панель*\n\n` +
    `📱 Аккаунтов: ${stats.total_accounts || 0}\n` +
    `✅ Активных: ${stats.active || 0}\n` +
    `📤 Отправлено: ${stats.total_sent || 0}\n` +
    `📥 Получено: ${stats.total_received || 0}`,
    { parse_mode: 'Markdown' }
  );
}

// ============================================
// ЭКСПОРТ
// ============================================

module.exports = bot;
