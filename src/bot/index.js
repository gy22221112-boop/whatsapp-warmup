const TelegramBot = require('node-telegram-bot-api');
const { UserModel, WhatsAppAccountModel, PaymentModel } = require('../database/models');
const whatsappManager = require('../whatsapp/manager');
const { logger } = require('../utils/logger');
const { validatePhoneNumber, formatPhoneNumber } = require('../utils/helpers');
const { getPrices, createInvoice, checkPayment } = require('../payments/cryptobot');
const { generateMessage } = require('../ai/gemini');
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
// ГЛАВНОЕ МЕНЮ
// ============================================

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || 'user';
  const referralCode = msg.text.split(' ')[1];

  let user = await UserModel.findByTelegramId(chatId);
  
  if (!user) {
    user = await UserModel.create(chatId, username);
    
    // Обработка рефералки
    if (referralCode) {
      const referrer = await UserModel.findByTelegramId(parseInt(referralCode));
      if (referrer && referrer.telegram_id !== chatId) {
        await UserModel.updateReferrals(chatId, referrer.telegram_id);
        await bot.sendMessage(chatId,
          `🎉 *Вы активировали реферальную ссылку!*\n\n` +
          `Вы получили +1 час бесплатного прогрева! 🔥\n` +
          `Ваш реферер тоже получил бонус!`
        );
      }
    }
  }

  const prices = getPrices();
  const stats = await WhatsAppAccountModel.getStats();

  await bot.sendMessage(chatId,
    `👋 *Добро пожаловать в WhatsApp Warmup Bot!*\n\n` +
    `🔥 *Прогрев WhatsApp аккаунтов*\n` +
    `🤖 Автоматическое общение между аккаунтами\n` +
    `💬 Естественные диалоги с AI\n\n` +
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
// ОБРАБОТЧИКИ КНОПОК
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
        await bot.sendMessage(chatId,
          '📱 *Отправьте номер для QR кода:*',
          { parse_mode: 'Markdown' }
        );
        break;

      case 'code_method':
        await bot.sendMessage(chatId,
          '🔑 *Отправьте номер для 8-значного кода:*',
          { parse_mode: 'Markdown' }
        );
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

      case 'account_settings':
        await showAccountSettings(chatId);
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
// ОСНОВНЫЕ ФУНКЦИИ
// ============================================

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
    message += `   ⏰ ${acc.warmup_time}ч | ${typeMap[acc.warmup_type] || '👤'}\n`;
    if (acc.custom_name) message += `   📛 Имя: ${acc.custom_name}\n`;
    message += '\n';

    keyboard.push([{
      text: `🗑️ ${acc.phone_number.slice(-6)}`,
      callback_data: `delete_${acc.phone_number}`
    }]);
  });

  message += `\n📊 *Всего:* ${accounts.length}/${process.env.MAX_ACCOUNTS || 10}`;

  keyboard.push(
    [{ text: '⚙️ Настройки аккаунтов', callback_data: 'account_settings' }],
    [{ text: '➕ Добавить номер', callback_data: 'add_account' }],
    [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
  );

  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function showWarmupOptions(chatId) {
  const user = await UserModel.findByTelegramId(chatId);
  const accounts = await WhatsAppAccountModel.findByUser(chatId);
  const connected = accounts.filter(a => a.status === 'connected');

  if (connected.length < 2) {
    await bot.sendMessage(chatId,
      `⚠️ *Недостаточно аккаунтов*\n\n` +
      `Требуется минимум 2 аккаунта. У вас: ${connected.length}\n` +
      `Добавьте больше аккаунтов и попробуйте снова.`,
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

  const prices = getPrices();

  let message = '💰 *Выберите время прогрева*\n\n';
  message += `👤 Аккаунтов: ${connected.length}\n`;
  message += `🎁 Бонусные часы: ${user.bonus_hours || 0}ч\n\n`;
  message += `⏰ 6 часов — $${prices[6]}\n`;
  message += `⏰ 12 часов — $${prices[12]}\n`;
  message += `⏰ 24 часа — $${prices[24]}\n\n`;
  message += `🎯 *Первый прогресс 6 часов БЕСПЛАТНО!*`;

  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: pricingKeyboard
    }
  });
}

async function showPricing(chatId) {
  const prices = getPrices();

  await bot.sendMessage(chatId,
    `💰 *Цены на прогрев*\n\n` +
    `⏰ 6 часов — $${prices[6]}\n` +
    `⏰ 12 часов — $${prices[12]}\n` +
    `⏰ 24 часа — $${prices[24]}\n\n` +
    `💳 *Оплата через @CryptoBot*\n` +
    `Поддерживаются: BTC, USDT, TON, TRX\n\n` +
    `🎁 *Первый раз 6 часов БЕСПЛАТНО!*\n` +
    `📢 *Приглашай друзей и получай бонусы!*`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💳 Купить', callback_data: 'start_warmup' }],
          [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
        ]
      }
    }
  );
}

async function showReferral(chatId) {
  const user = await UserModel.findByTelegramId(chatId);
  const referrals = await UserModel.getReferrals(chatId);
  const refLink = `https://t.me/${(await bot.getMe()).username}?start=${chatId}`;

  await bot.sendMessage(chatId,
    `📢 *Реферальная программа*\n\n` +
    `👥 Приглашай друзей и получай бонусы!\n\n` +
    `🔗 *Твоя реферальная ссылка:*\n` +
    `\`${refLink}\`\n\n` +
    `🎁 *За каждого приглашенного:*\n` +
    `• Ты получаешь +1 час прогрева\n` +
    `• Друг получает +1 час прогрева\n\n` +
    `👥 Приглашено: ${referrals.length} человек\n` +
    `🎁 Бонусных часов: ${user.bonus_hours || 0}ч\n\n` +
    `📊 *Твои рефералы:*\n${referrals.map(r => `• @${r.username || r.telegram_id}`).join('\n') || 'Пока никого нет'}`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 Список аккаунтов', callback_data: 'list_accounts' }],
          [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
        ]
      }
    }
  );
}

async function handlePurchase(chatId, hours) {
  const user = await UserModel.findByTelegramId(chatId);

  // Проверка на первый бесплатный прогрев
  const payments = await PaymentModel.getByUser(chatId);
  const hasFree = payments.filter(p => p.status === 'completed').length === 0;

  if (hasFree) {
    await bot.sendMessage(chatId,
      `🎉 *Поздравляю!*\n\n` +
      `Это ваш первый прогрев — 6 часов БЕСПЛАТНО! 🔥\n\n` +
      `Прогрев начнется автоматически.`,
      { parse_mode: 'Markdown' }
    );
    await startWarmup(chatId, 6);
    return;
  }

  // Проверка бонусных часов
  if (user.bonus_hours >= parseInt(hours)) {
    await UserModel.addBonusHours(chatId, -parseInt(hours));
    await bot.sendMessage(chatId,
      `🎁 *Использованы бонусные часы!*\n\n` +
      `Вы использовали ${hours} бонусных часов.\n` +
      `Осталось: ${user.bonus_hours - parseInt(hours)}ч\n\n` +
      `Прогрев начнется автоматически.`,
      { parse_mode: 'Markdown' }
    );
    await startWarmup(chatId, parseInt(hours));
    return;
  }

  // Создание инвойса
  try {
    const invoice = await createInvoice(chatId, hours);
    await bot.sendMessage(chatId,
      `💳 *Оплата*\n\n` +
      `Сумма: $${invoice.amount}\n` +
      `Время: ${hours} часов\n\n` +
      `Оплатите по ссылке:\n` +
      `${invoice.pay_url}\n\n` +
      `⏳ После оплаты нажмите "Проверить оплату"`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Проверить оплату', callback_data: `check_payment_${invoice.id}` }],
            [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
          ]
        }
      }
    );
  } catch (error) {
    await bot.sendMessage(chatId, `❌ Ошибка создания платежа: ${error.message}`);
  }
}

async function startWarmup(chatId, hours) {
  const accounts = await WhatsAppAccountModel.findByUser(chatId);
  const connected = accounts.filter(a => a.status === 'connected');

  for (const account of connected) {
    await WhatsAppAccountModel.updateWarmupSettings(account.phone_number, hours, 'human');
    await whatsappManager.initializeSession(account.phone_number, chatId);
  }

  await bot.sendMessage(chatId,
    `✅ *Прогрев запущен на ${hours} часов!*\n\n` +
    `📱 Аккаунтов: ${connected.length}\n` +
    `⏰ Время: ${hours} часов\n` +
    `🔄 Аккаунты начали общаться!\n\n` +
    `📊 Следите за прогрессом в списке аккаунтов.`,
    { parse_mode: 'Markdown' }
  );
}

async function showAccountSettings(chatId) {
  const accounts = await WhatsAppAccountModel.findByUser(chatId);

  await bot.sendMessage(chatId,
    `⚙️ *Настройки аккаунтов*\n\n` +
    `Выберите аккаунт для настройки:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: accounts.map(acc => [
          { text: `📱 ${acc.phone_number}`, callback_data: `settings_acc_${acc.phone_number}` }
        ]).concat([[{ text: '🔙 Назад', callback_data: 'list_accounts' }]])
      }
    }
  );
}

// ============================================
// АДМИН-ПАНЕЛЬ
// ============================================

async function showAdminPanel(chatId) {
  const user = await UserModel.findByTelegramId(chatId);
  if (!user?.is_admin) {
    await bot.sendMessage(chatId, '⛔ У вас нет прав администратора');
    return;
  }

  const stats = await WhatsAppAccountModel.getStats();
  const userStats = await UserModel.getStats();
  const paymentStats = await PaymentModel.getStats();

  await bot.sendMessage(chatId,
    `⚙️ *Админ-панель*\n\n` +
    `📊 *Общая статистика:*\n` +
    `👥 Пользователей: ${userStats.total_users || 0}\n` +
    `📱 Аккаунтов: ${stats.total_accounts || 0}\n` +
    `✅ Активных: ${stats.active || 0}\n` +
    `📤 Отправлено: ${stats.total_sent || 0}\n` +
    `📥 Получено: ${stats.total_received || 0}\n` +
    `💳 Платежей: ${paymentStats.total_payments || 0}\n` +
    `💰 Доход: $${paymentStats.total_revenue || 0}\n\n` +
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
// ЭКСПОРТ
// ============================================

module.exports = bot;
