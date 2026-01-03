import { pool } from '../config/mysql.js';

class AuditLog {
  constructor(data) {
    this.id = data.id;
    this._id = data.id;
    this.actorId = data.actorId || data.actor_id;
    this.actorName = data.actorName || data.actor_name;
    this.action = data.action;
    this.targetType = data.targetType || data.target_type;
    this.targetId = data.targetId || data.target_id;
    this.beforeData = data.beforeData || data.before_data;
    this.afterData = data.afterData || data.after_data;
    this.details = data.details;
    this.createdAt = data.createdAt || data.created_at;

    // Populated
    this.actorDetails = data.actorDetails;
  }

  static async find(query = {}) {
    let sql = 'SELECT * FROM audit_logs';
    // No filters used in controller yet, just find().sort().limit()

    sql += ' ORDER BY created_at DESC';


    const [rows] = await pool.query(sql);
    return rows.map(r => new AuditLog(r));
  }

  async save() {
    const data = {
      actor_id: this.actorId,
      actor_name: this.actorName,
      action: this.action,
      target_type: this.targetType,
      target_id: this.targetId,
      before_data: this.beforeData, // JSON string
      after_data: this.afterData,   // JSON string
      details: this.details
    };

    const keys = Object.keys(data);
    const values = Object.values(data);
    const sql = `INSERT INTO audit_logs (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
    const [result] = await pool.query(sql, values);
    this.id = result.insertId;
    this._id = result.insertId;
    return this;
  }
}

export default AuditLog;
