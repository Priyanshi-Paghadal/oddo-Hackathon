import { pool } from '../config/mysql.js';
import bcrypt from 'bcryptjs';

class User {
  constructor(data) {
    this.id = data.id;
    this._id = data.id; // Alias for MongoDB compatibility
    this.name = data.name;
    this.username = data.username;
    this.email = data.email;
    this.password = data.password;
    this.role = data.role || 'Employee';
    this.department = data.department;
    this.phone = data.phone;
    this.aadhaarNumber = data.aadhaarNumber || data.aadhaar_number;
    this.guardianName = data.guardianName || data.guardian_name;
    this.mobileNumber = data.mobileNumber || data.mobile_number;
    this.guardianMobileNumber = data.guardianMobileNumber || data.guardian_mobile_number;
    this.isActive = data.isActive !== undefined ? data.isActive : (data.is_active !== undefined ? data.is_active : true);
    this.isFirstLogin = data.isFirstLogin !== undefined ? data.isFirstLogin : (data.is_first_login !== undefined ? data.is_first_login : true);
    this.lastLogin = data.lastLogin || data.last_login;
    this.paidLeaveAllocation = data.paidLeaveAllocation || data.paid_leave_allocation || 0;
    this.paidLeaveLastAllocatedDate = data.paidLeaveLastAllocatedDate || data.paid_leave_last_allocated_date;
    this.joiningDate = data.joiningDate || data.joining_date;

    // Handle JSON fields
    this.bonds = typeof data.bonds === 'string' ? JSON.parse(data.bonds) : (data.bonds || []);
    this.salaryBreakdown = typeof data.salaryBreakdown === 'string' ? JSON.parse(data.salaryBreakdown) : (data.salary_breakdown || data.salaryBreakdown || []);

    // Timestamps
    this.createdAt = data.createdAt || data.created_at;
    this.updatedAt = data.updatedAt || data.updated_at;
  }

  // Find user by ID
  static async findById(id) {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    if (rows.length === 0) return null;
    return new User(rows[0]);
  }

  // Find user by query (simple/common queries)
  static async findOne(query) {
    const keys = Object.keys(query);
    if (keys.length === 0) return null;

    const conditions = keys.map(key => `${key} = ?`).join(' AND ');
    const values = keys.map(key => query[key]);

    const [rows] = await pool.query(`SELECT * FROM users WHERE ${conditions} LIMIT 1`, values);
    if (rows.length === 0) return null;
    return new User(rows[0]);
  }

  // Find multiple users
  static async find(query = {}) {
    let sql = 'SELECT * FROM users';
    const values = [];
    const conditions = [];

    // Map common fields from camelCase to snake_case if needed, or assume query keys match DB columns
    // For now, support direct mapping for role, isActive, etc.
    const fieldMap = {
      isActive: 'is_active',
      role: 'role',
      department: 'department'
    };

    if (query.role) {
      if (typeof query.role === 'object' && query.role.$in) {
        conditions.push(`role IN (?)`);
        values.push(query.role.$in);
      } else {
        conditions.push('role = ?');
        values.push(query.role);
      }
    }

    if (query.isActive !== undefined) {
      conditions.push('is_active = ?');
      values.push(query.isActive);
    }

    // Handle specific complex queries manually or strictly if needed
    // Simple implementation for now

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    // Add sorting (default name ASC if not specified)
    sql += ' ORDER BY name ASC';

    const [rows] = await pool.query(sql, values);
    return rows.map(row => new User(row));
  }

  // Save (Insert or Update)
  async save() {
    const data = {
      name: this.name,
      username: this.username,
      email: this.email,
      password: this.password, // Assumed to be hashed already if modified, or we handle hashing here?
      // Mongoose model had pre-save hook for hashing. 
      // We should handle hashing in controller OR check if password is modified.
      // For simplicity, assume controller hashes it if new/changed, or we check isFirstLogin handling etc.
      role: this.role,
      department: this.department,
      phone: this.phone,
      aadhaar_number: this.aadhaarNumber,
      guardian_name: this.guardianName,
      mobile_number: this.mobileNumber,
      guardian_mobile_number: this.guardianMobileNumber,
      is_active: this.isActive,
      is_first_login: this.isFirstLogin,
      last_login: this.lastLogin,
      paid_leave_allocation: this.paidLeaveAllocation,
      paid_leave_last_allocated_date: this.paidLeaveLastAllocatedDate,
      joining_date: this.joiningDate,
      bonds: JSON.stringify(this.bonds),
      salary_breakdown: JSON.stringify(this.salaryBreakdown)
    };

    if (this.id) {
      // Update
      const keys = Object.keys(data);
      const setClause = keys.map(key => `${key} = ?`).join(', ');
      const values = [...keys.map(key => data[key]), this.id];

      await pool.query(`UPDATE users SET ${setClause} WHERE id = ?`, values);
    } else {
      // Insert
      // Hash password if it looks plain (basic check) or rely on controller
      // The controller creates new User with plain text password usually, so we might need to hash it here if it's new.
      // But looking at userController in prompt: `const user = new User({...}); await user.save();`
      // And in User.js Mongoose: `pre('save')` hashes it.
      // So I MUST hash it here if it's a new user or password changed.
      // Since tracking "changed" is hard without a proxy, I'll rely on the fact that `save()` 
      // is called with a new password in `createUser` and `changePassword`.
      // BUT `changePassword` updates the instance `user.password = newPassword` and calls `save()`.
      // `createUser` sets `password: userPassword` (plain) and calls `save()`.
      // `login` calls `save()` to update `lastLogin` - we DO NOT want to re-hash the already hashed password.

      // Strategy: Check if password corresponds to a known hash format (bcrypt starts with $2a$ or $2b$). 
      // If not, hash it.
      if (this.password && !this.password.startsWith('$2a$') && !this.password.startsWith('$2b$')) {
        this.password = await bcrypt.hash(this.password, 10);
        data.password = this.password;
      }

      const keys = Object.keys(data);
      const insertSql = `INSERT INTO users (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
      const [result] = await pool.query(insertSql, Object.values(data));
      this.id = result.insertId;
    }

    return this;
  }

  // Compare password
  async comparePassword(candidatePassword) {
    if (!this.password) return false;
    return await bcrypt.compare(candidatePassword, this.password);
  }

  // Helper to select without password (shim for .select('-password'))
  // This cannot be chained easily on find() without a QueryBuilder.
  // We can just implement a `toJSON` that removes it.
  toJSON() {
    const obj = { ...this };
    delete obj.password;
    // Map snake_case to camelCase for API response if needed, 
    // but constructor already normalized it to camelCase on `this`.
    // The `this` object has camelCase keys.
    return obj;
  }

  // Shim for select() method chain in Mongoose
  // This is a hack to support `await User.find().select('-password')`
  // But `User.find()` returns a Promise<Array>, not a Query object.
  // The controllers will fail if they try to chain `.select()`.
  // I will need to update the controllers to remove `.select()`.
}

export default User;
