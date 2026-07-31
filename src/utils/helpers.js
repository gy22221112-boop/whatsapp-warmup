function validatePhoneNumber(number) {
  // Регулярное выражение: +7|7|8 + 10 цифр или 9 + 9 цифр
  const regex = /^(\+7|7|8)\d{10}$|^9\d{9}$/;
  return regex.test(number);
}

function formatPhoneNumber(number) {
  // Удаляем все нецифровые символы
  let cleaned = number.replace(/\D/g, '');
  
  // Если начинается с 8, меняем на 7
  if (cleaned.startsWith('8')) {
    cleaned = '7' + cleaned.slice(1);
  }
  
  // Если начинается с 7 или 9, оставляем как есть
  if (cleaned.startsWith('7') || cleaned.startsWith('9')) {
    return cleaned;
  }
  
  // Если есть +7, убираем +
  if (number.startsWith('+7')) {
    return number.slice(1);
  }
  
  return cleaned;
}

function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getStatusText(status) {
  const statusMap = {
    'pending': '⏳ Ожидание',
    'connected': '✅ Подключен',
    'warming': '🔄 Прогрев...',
    'warmed': '🔥 Готов',
    'disconnected': '❌ Отключен'
  };
  return statusMap[status] || status;
}

function getWarmupTypeText(type) {
  const typeMap = {
    'slow': '🐢 Медленно',
    'human': '👤 Как человек',
    'fast': '🚀 Быстро'
  };
  return typeMap[type] || type;
}

module.exports = {
  validatePhoneNumber,
  formatPhoneNumber,
  getRandomDelay,
  shuffleArray,
  sleep,
  getStatusText,
  getWarmupTypeText
};