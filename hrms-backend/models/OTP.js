import { pool } from '../config/mysql.js';

class OTP {
  // Find OTP by ID
  static async findById(id) {
    const [rows] = await pool.query(
      'SELECT * FROM otps WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  }

  // Find latest OTP for email
  static async findByEmail(email) {
    const [rows] = await pool.query(
      'SELECT * FROM otps WHERE email = ? AND verified = FALSE AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
      [email.toLowerCase()]
    );
    return rows[0] || null;
  }

  // Create OTP
  static async create(otpData) {
    const { email, otp, expiresAt, contextData } = otpData;

    const expiryDate = expiresAt || new Date(Date.now() + 10 * 60 * 1000); // 10 minutes default

    const [result] = await pool.query(
      'INSERT INTO otps (email, otp, expires_at, context_data) VALUES (?, ?, ?, ?)',
      [email.toLowerCase(), otp, expiryDate, JSON.stringify(contextData || {})]
    );

    return await OTP.findById(result.insertId);
  }

  // Verify OTP
  static async verify(email, otp) {
    const otpRecord = await OTP.findByEmail(email);

    if (!otpRecord) {
      return { success: false, message: 'OTP not found or expired' };
    }

    if (otpRecord.otp !== otp) {
      return { success: false, message: 'Invalid OTP' };
    }

    // Mark as verified
    await pool.query(
      'UPDATE otps SET verified = TRUE WHERE id = ?',
      [otpRecord.id]
    );

    return { success: true, message: 'OTP verified successfully' };
  }

  // Delete OTP
  static async delete(id) {
    const [result] = await pool.query(
      'DELETE FROM otps WHERE id = ?',
      [id]
    );
    return result.affectedRows > 0;
  }

  // Delete expired OTPs
  static async deleteExpired() {
    const [result] = await pool.query(
      'DELETE FROM otps WHERE expires_at < NOW()'
    );
    return result.affectedRows;
  }

  // Delete all OTPs for an email
  static async deleteByEmail(email) {
    const [result] = await pool.query(
      'DELETE FROM otps WHERE email = ?',
      [email.toLowerCase()]
    );
    return result.affectedRows;
  }
}

export default OTP;
