const axios = require('axios');
const { logger } = require('../utils/logger');
require('dotenv').config();

const CRYPTOBOT_TOKEN = process.env.CRYPTOBOT_TOKEN;
const CRYPTOBOT_API_URL = 'https://api.cryptobot.com/v1';

// Цены
const PRICES = {
  6: parseFloat(process.env.PRICE_6H) || 1.5,
  12: parseFloat(process.env.PRICE_12H) || 2.0,
  24: parseFloat(process.env.PRICE_24H) || 4.0
};

function getPrices() {
  return PRICES;
}

async function createInvoice(telegramId, hours) {
  try {
    const amount = PRICES[hours];
    const response = await axios.post(
      `${CRYPTOBOT_API_URL}/createInvoice`,
      {
        asset: 'USDT',
        amount: amount,
        description: `Прогрев WhatsApp ${hours} часов`,
        paid_btn_name: 'callback',
        paid_btn_url: `https://t.me/${(await bot.getMe()).username}?start=payment_${telegramId}`,
        payload: JSON.stringify({ telegramId, hours })
      },
      {
        headers: {
          'Crypto-Pay-API-Token': CRYPTOBOT_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      id: response.data.result.invoice_id,
      amount: response.data.result.amount,
      pay_url: response.data.result.pay_url,
      status: response.data.result.status
    };
  } catch (error) {
    logger.error('CryptoBot createInvoice error:', error.response?.data || error.message);
    throw error;
  }
}

async function checkPayment(invoiceId) {
  try {
    const response = await axios.get(
      `${CRYPTOBOT_API_URL}/getInvoices`,
      {
        params: { invoice_ids: invoiceId },
        headers: {
          'Crypto-Pay-API-Token': CRYPTOBOT_TOKEN
        }
      }
    );

    const invoice = response.data.result.items[0];
    return {
      status: invoice.status,
      paid: invoice.status === 'paid',
      amount: invoice.amount,
      asset: invoice.asset
    };
  } catch (error) {
    logger.error('CryptoBot checkPayment error:', error.response?.data || error.message);
    throw error;
  }
}

module.exports = { getPrices, createInvoice, checkPayment };
