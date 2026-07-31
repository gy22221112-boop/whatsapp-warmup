const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function initDatabase() {
  const client = await pool.connect();
  try {
    // Таблица пользователей
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_admin BOOLEAN DEFAULT FALSE
      )
    `);

    // Таблица аккаунтов WhatsApp
    await client.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_accounts (
        id SERIAL PRIMARY KEY,
        user_telegram_id BIGINT NOT NULL,
        phone_number VARCHAR(20) NOT NULL,
        session_path VARCHAR(255),
        is_connected BOOLEAN DEFAULT FALSE,
        warmup_time INTEGER DEFAULT 6,
        warmup_type VARCHAR(20) DEFAULT 'human',
        status VARCHAR(50) DEFAULT 'pending',
        messages_sent INTEGER DEFAULT 0,
        messages_received INTEGER DEFAULT 0,
        last_active TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_telegram_id) REFERENCES users(telegram_id)
      )
    `);

    // Таблица диалогов
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        account_from VARCHAR(20) NOT NULL,
        account_to VARCHAR(20) NOT NULL,
        message TEXT,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_read BOOLEAN DEFAULT FALSE,
        type VARCHAR(20) DEFAULT 'text'
      )
    `);

    // Таблица для статистики
    await client.query(`
      CREATE TABLE IF NOT EXISTS stats (
        id SERIAL PRIMARY KEY,
        date DATE DEFAULT CURRENT_DATE,
        total_messages INTEGER DEFAULT 0,
        total_accounts INTEGER DEFAULT 0
      )
    `);

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database init error:', error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, initDatabase };