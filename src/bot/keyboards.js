const mainMenuKeyboard = [
  [{ text: '➕ Добавить номер', callback_data: 'add_account' }],
  [{ text: '📋 Список аккаунтов', callback_data: 'list_accounts' }],
  [{ text: '🚀 Запустить прогрев', callback_data: 'start_warmup' }],
  [{ text: '⚙️ Настройки прогрева', callback_data: 'warmup_settings' }],
  [{ text: '⚙️ Админ-панель', callback_data: 'admin_panel' }]
];

const accountMenuKeyboard = [
  [{ text: '➕ Добавить номер', callback_data: 'add_account' }],
  [{ text: '🔄 Обновить список', callback_data: 'list_accounts' }],
  [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
];

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

const adminKeyboard = [
  [{ text: '📊 Статистика', callback_data: 'stats' }],
  [{ text: '👥 Все пользователи', callback_data: 'all_users' }],
  [{ text: '📢 Рассылка', callback_data: 'broadcast' }],
  [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
];

module.exports = {
  mainMenuKeyboard,
  accountMenuKeyboard,
  warmupMenuKeyboard,
  adminKeyboard
};