const { GoogleGenerativeAI } = require('@google/generative-ai');
const { logger } = require('../utils/logger');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

const messageTemplates = [
  'Привет! Как дела?',
  'Здравствуй! Чем занимаешься?',
  'Привет, давно не виделись!',
  'Что нового? Рассказывай',
  'Как работа? Всё успеваешь?',
  'Планы на выходные есть?',
  'Фильм какой-нибудь смотрел?'
];

async function generateMessage(context = '') {
  try {
    const prompt = `Сгенерируй естественное сообщение для WhatsApp от обычного человека. 
    Тема: ${context || 'обычный разговор'}. 
    Сообщение должно быть на русском языке, дружелюбным, с возможным использованием эмодзи.
    Длина: 1-2 предложения.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    logger.error('Gemini generateMessage error:', error);
    // Возвращаем случайный шаблон
    return messageTemplates[Math.floor(Math.random() * messageTemplates.length)];
  }
}

async function generateResponse(message) {
  try {
    const prompt = `Ответь на сообщение в WhatsApp как обычный человек.
    Сообщение: "${message}"
    Ответ должен быть естественным, дружелюбным, на русском языке.
    Длина: 1-2 предложения.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    logger.error('Gemini generateResponse error:', error);
    const responses = [
      'Привет! Да, всё хорошо :)',
      'Спасибо за сообщение!',
      'Понял, спасибо за информацию',
      'Да, согласен с тобой',
      'Интересно, расскажи подробнее'
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
}

module.exports = { generateMessage, generateResponse };
