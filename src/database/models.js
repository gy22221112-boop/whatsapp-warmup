const { pool } = require('./index');

class UserModel {
  static async create(telegramId, username) {
    const query = `
      INSERT INTO users (telegram_id, username)
      VALUES ($1, $2)
      ON CONFLICT (telegram_id) DO UPDATE SET username = $2
      RETURNING *
    `;
    const result = await pool.query(query, [telegramId, username]);
    return result.rows[0];
  }

  static async findByTelegramId(telegramId) {
    const result = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    return result.rows[0];
  }

  static async getAll() {
    const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
    return result.rows;
  }

  static async getAdmins() {
    const result = await pool.query(
      'SELECT * FROM users WHERE is_admin = true'
    );
    return result.rows;
  }

  static async makeAdmin(telegramId) {
    const query = `
      UPDATE users SET is_admin = true
      WHERE telegram_id = $1
      RETURNING *
    `;
    const result = await pool.query(query, [telegramId]);
    return result.rows[0];
  }

  static async updateReferrals(telegramId, referrerId) {
    const query = `
      UPDATE users 
      SET referred_by = $1, bonus_hours = bonus_hours + 1
      WHERE telegram_id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [referrerId, telegramId]);
    return result.rows[0];
  }

  static async addBonusHours(telegramId, hours) {
    const query = `
      UPDATE users 
      SET bonus_hours = bonus_hours + $1
      WHERE telegram_id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [hours, telegramId]);
    return result.rows[0];
  }

  static async getReferrals(telegramId) {
    const result = await pool.query(
      'SELECT * FROM users WHERE referred_by = $1',
      [telegramId]
    );
    return result.rows;
  }

  static async getStats() {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN referred_by IS NOT NULL THEN 1 ELSE 0 END) as total_referrals
      FROM users
    `);
    return result.rows[0];
  }
}

class WhatsAppAccountModel {
  static async create(telegramId, phoneNumber, warmupTime = 6) {
    const query = `
      INSERT INTO whatsapp_accounts (user_telegram_id, phone_number, warmup_time)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const result = await pool.query(query, [telegramId, phoneNumber, warmupTime]);
    return result.rows[0];
  }

  static async findByUser(telegramId) {
    const result = await pool.query(
      'SELECT * FROM whatsapp_accounts WHERE user_telegram_id = $1 ORDER BY created_at DESC',
      [telegramId]
    );
    return result.rows;
  }

  static async findByPhone(phoneNumber) {
    const result = await pool.query(
      'SELECT * FROM whatsapp_accounts WHERE phone_number = $1',
      [phoneNumber]
    );
    return result.rows[0];
  }

  static async updateStatus(phoneNumber, status) {
    const query = `
      UPDATE whatsapp_accounts 
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE phone_number = $2
      RETURNING *
    `;
    const result = await pool.query(query, [status, phoneNumber]);
    return result.rows[0];
  }

  static async updateStats(phoneNumber, messagesSent, messagesReceived) {
    const query = `
      UPDATE whatsapp_accounts 
      SET messages_sent = messages_sent + $1,
          messages_received = messages_received + $2,
          last_active = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE phone_number = $3
      RETURNING *
    `;
    const result = await pool.query(query, [messagesSent, messagesReceived, phoneNumber]);
    return result.rows[0];
  }

  static async delete(phoneNumber, telegramId) {
    const query = `
      DELETE FROM whatsapp_accounts 
      WHERE phone_number = $1 AND user_telegram_id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [phoneNumber, telegramId]);
    return result.rows[0];
  }

  static async getActiveAccounts() {
    const result = await pool.query(
      "SELECT * FROM whatsapp_accounts WHERE status = 'connected'"
    );
    return result.rows;
  }

  static async getStats() {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_accounts,
        SUM(messages_sent) as total_sent,
        SUM(messages_received) as total_received,
        COUNT(CASE WHEN status = 'connected' THEN 1 END) as active
      FROM whatsapp_accounts
    `);
    return result.rows[0];
  }

  static async updateWarmupSettings(phoneNumber, warmupTime, warmupType) {
    const query = `
      UPDATE whatsapp_accounts 
      SET warmup_time = $1, warmup_type = $2, updated_at = CURRENT_TIMESTAMP
      WHERE phone_number = $3
      RETURNING *
    `;
    const result = await pool.query(query, [warmupTime, warmupType, phoneNumber]);
    return result.rows[0];
  }

  static async updateCustomSettings(phoneNumber, settings) {
    const { name, status, reactions, sendPhotos, sendVoice } = settings;
    const query = `
      UPDATE whatsapp_accounts 
      SET custom_name = COALESCE($1, custom_name),
          custom_status = COALESCE($2, custom_status),
          send_reactions = COALESCE($3, send_reactions),
          send_photos = COALESCE($4, send_photos),
          send_voice = COALESCE($5, send_voice),
          updated_at = CURRENT_TIMESTAMP
      WHERE phone_number = $6
      RETURNING *
    `;
    const result = await pool.query(query, [name, status, reactions, sendPhotos, sendVoice, phoneNumber]);
    return result.rows[0];
  }
}

class PaymentModel {
  static async create(telegramId, amount, hours, paymentId) {
    const query = `
      INSERT INTO payments (user_telegram_id, amount, hours, payment_id, status)
      VALUES ($1, $2, $3, $4, 'pending')
      RETURNING *
    `;
    const result = await pool.query(query, [telegramId, amount, hours, paymentId]);
    return result.rows[0];
  }

  static async updateStatus(paymentId, status) {
    const query = `
      UPDATE payments 
      SET status = $1, completed_at = CURRENT_TIMESTAMP
      WHERE payment_id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [status, paymentId]);
    return result.rows[0];
  }

  static async getByUser(telegramId) {
    const result = await pool.query(
      'SELECT * FROM payments WHERE user_telegram_id = $1 ORDER BY created_at DESC',
      [telegramId]
    );
    return result.rows;
  }

  static async getStats() {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_payments,
        SUM(amount) as total_revenue,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_payments
      FROM payments
    `);
    return result.rows[0];
  }
}

module.exports = { UserModel, WhatsAppAccountModel, PaymentModel };
