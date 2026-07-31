// ============================================
// ГЛАВНОЕ МЕНЮ
// ============================================

const mainMenuKeyboard = [
  [{ text: '➕ Добавить номер', callback_data: 'add_account' }],
  [{ text: '📋 Список аккаунтов', callback_data: 'list_accounts' }],
  [{ text: '🚀 Запустить прогрев', callback_data: 'start_warmup' }],
  [{ text: '💰 Цены', callback_data: 'pricing' }],
  [{ text: '📢 Реферальная система', callback_data: 'referral' }],
  [{ text: '⚙️ Настройки прогрева', callback_data: 'warmup_settings' }],
  [{ text: '⚙️ Админ-панель', callback_data: 'admin_panel' }]
];

// ============================================
// МЕНЮ СПИСКА АККАУНТОВ
// ============================================

const accountMenuKeyboard = [
  [{ text: '➕ Добавить номер', callback_data: 'add_account' }],
  [{ text: '🔄 Обновить список', callback_data: 'list_accounts' }],
  [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
];

// ============================================
// МЕНЮ НАСТРОЕК ПРОГРЕВА
// ============================================

const warmupMenuKeyboard = (currentTime, currentType) => {
  const timeButtons = [
    { text: `⏰ 6 часов ${currentTime === 6 ? '✅' : ''}`, callback_data: 'set_time_6' },
    { text: `⏰ 12 часов ${currentTime === 12 ? '✅' : ''}`, callback_data: 'set_time_12' },
    { text: `⏰ 24 часа ${currentTime === 24 ? '✅' : ''}`, callback_data: 'set_time_24' }
  ];

  const typeButtons = [
    { text: `🐢 Медленно ${currentType === 'slow' ? '✅' : ''}`, callback_data: 'set_type_slow' },
    { text: `👤 Как человек ${currentType === 'human' ? '✅' : ''}`, callback_data: 'set_type_human' },
    { text: `🚀 Быстро ${currentType === 'fast' ? '✅' : ''}`, callback_data: 'set_type_fast' }
  ];

  return [
    timeButtons,
    typeButtons,
    [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
  ];
};

// ============================================
// МЕНЮ ЦЕН
// ============================================

const pricingKeyboard = [
  [{ text: '⏰ 6 часов - $1.5', callback_data: 'buy_6h' }],
  [{ text: '⏰ 12 часов - $2', callback_data: 'buy_12h' }],
  [{ text: '⏰ 24 часа - $4', callback_data: 'buy_24h' }],
  [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
];

// ============================================
// АДМИН-ПАНЕЛЬ
// ============================================

const adminKeyboard = [
  [{ text: '📊 Статистика', callback_data: 'stats' }],
  [{ text: '👥 Все пользователи', callback_data: 'all_users' }],
  [{ text: '💰 Управление ценами', callback_data: 'manage_prices' }],
  [{ text: '💳 Платежи', callback_data: 'payments' }],
  [{ text: '📢 Рассылка', callback_data: 'broadcast' }],
  [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
];

// ============================================
// МЕНЮ НАСТРОЕК АККАУНТА
// ============================================

const settingsKeyboard = [
  [{ text: '📛 Изменить имя', callback_data: 'change_name' }],
  [{ text: '📊 Изменить статус', callback_data: 'change_status' }],
  [{ text: '❤️ Реакции', callback_data: 'toggle_reactions' }],
  [{ text: '📷 Отправка фото', callback_data: 'toggle_photos' }],
  [{ text: '🎤 Голосовые', callback_data: 'toggle_voice' }],
  [{ text: '🔙 Назад', callback_data: 'list_accounts' }]
];

// ============================================
// РЕФЕРАЛЬНАЯ СИСТЕМА
// ============================================

const referralKeyboard = [
  [{ text: '👥 Мои рефералы', callback_data: 'my_referrals' }],
  [{ text: '🎁 Мои бонусы', callback_data: 'my_bonuses' }],
  [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
];

// ============================================
// ЭКСПОРТ ВСЕХ КЛАВИАТУР
// ============================================

module.exports = {
  mainMenuKeyboard,
  accountMenuKeyboard,
  warmupMenuKeyboard,
  adminKeyboard,
  pricingKeyboard,
  settingsKeyboard,
  referralKeyboard
};
