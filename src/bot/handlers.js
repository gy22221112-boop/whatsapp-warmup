const { UserModel, WhatsAppAccountModel } = require('../database/models');
const whatsappManager = require('../whatsapp/manager');
const { logger } = require('../utils/logger');
const { validatePhoneNumber, formatPhoneNumber } = require('../utils/helpers');
const { mainMenuKeyboard, accountMenuKeyboard, warmupMenuKeyboard, adminKeyboard } = require('./keyboards');

/**
 * Обработчик команды /start
 */
async function handleStart(bot, msg) {
  const chatId = msg.chat.id;
  const username = msg.from.username || 'user';
  
  try {
    const user = await UserModel.create(chatId, username);
    
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
    
    logger.info(`User ${chatId} started bot`);
  } catch (error) {
    logger.error(`Error in /start: ${error.message}`);
    await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
  }
}

/**
 * Обработчик добавления номера телефона
 */
async function handleAddPhone(bot, chatId, phoneNumber) {
  try {
    const formatted = formatPhoneNumber(phoneNumber);
    
    // Проверка валидности
    if (!validatePhoneNumber(phoneNumber)) {
      await bot.sendMessage(chatId,
        '❌ *Неверный формат номера*\n\n' +
        'Используйте форматы:\n' +
        '• `+79123456789`\n' +
        '• `79123456789`\n' +
        '• `89123456789`',
        { parse_mode: 'Markdown' }
      );
      return false;
    }

    // Проверка лимита
    const accounts = await WhatsAppAccountModel.findByUser(chatId);
    const maxAccounts = parseInt(process.env.MAX_ACCOUNTS) || 10;
    
    if (accounts.length >= maxAccounts) {
      await bot.sendMessage(chatId,
        `⚠️ *Достигнут лимит аккаунтов*\n\n` +
        `Максимум: ${maxAccounts}\n` +
        `У вас: ${accounts.length}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
            ]
          }
        }
      );
      return false;
    }

    // Проверка на дубликат
    const existing = await WhatsAppAccountModel.findByPhone(formatted);
    if (existing) {
      await bot.sendMessage(chatId,
        `❌ *Номер уже добавлен*\n\n` +
        `Номер: \`${formatted}\``,
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
      return false;
    }

    // Сохраняем аккаунт
    const account = await WhatsAppAccountModel.create(chatId, formatted);
    
    // Подключаем сессию
    await whatsappManager.initializeSession(formatted, chatId);

    await bot.sendMessage(chatId,
      `✅ *Номер успешно добавлен*\n\n` +
      `📱 Номер: \`${formatted}\`\n` +
      `⏳ Ожидайте QR код для подключения...\n` +
      `⏰ Время прогрева: ${account.warmup_time} часов (по умолчанию)\n\n` +
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

    return true;

  } catch (error) {
    logger.error(`Error adding phone: ${error.message}`);
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
    return false;
  }
}

/**
 * Показать список аккаунтов
 */
async function showAccounts(bot, chatId) {
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
      
      const typeMap = {
        'slow': '🐢 Медл',
        'human': '👤 Человек',
        'fast': '🚀 Быстр'
      };

      message += `${index + 1}. ${status.emoji} \`${acc.phone_number}\`\n`;
      message += `   📊 Статус: ${status.text}\n`;
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

/**
 * Удалить аккаунт
 */
async function deleteAccount(bot, chatId, phoneNumber) {
  try {
    await whatsappManager.disconnect(phoneNumber);
    await WhatsAppAccountModel.delete(phoneNumber, chatId);
    
    await bot.answerCallbackQuery({
      callback_query_id: chatId,
      text: `✅ Аккаунт ${phoneNumber} удален`,
      show_alert: true
    });

    await showAccounts(bot, chatId);

  } catch (error) {
    logger.error(`Error deleting account: ${error.message}`);
    await bot.sendMessage(chatId, `❌ Ошибка при удалении: ${error.message}`);
  }
}

/**
 * Запустить прогрев
 */
async function startWarmup(bot, chatId) {
  try {
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

  } catch (error) {
    logger.error(`Error starting warmup: ${error.message}`);
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
  }
}

/**
 * Показать настройки прогрева
 */
async function showWarmupSettings(bot, chatId) {
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

module.exports = {
  handleStart,
  handleAddPhone,
  showAccounts,
  deleteAccount,
  startWarmup,
  showWarmupSettings
};