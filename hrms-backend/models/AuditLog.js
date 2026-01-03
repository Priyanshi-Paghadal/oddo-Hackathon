import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const AuditLog = sequelize.define('AuditLog', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  actorId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  actorName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  action: {
    type: DataTypes.STRING,
    allowNull: false
  },
  targetType: {
    type: DataTypes.ENUM('USER', 'ATTENDANCE', 'LEAVE', 'SYSTEM'),
    allowNull: false
  },
  targetId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  beforeData: {
    type: DataTypes.TEXT // Use TEXT for large JSON strings
  },
  afterData: {
    type: DataTypes.TEXT // Use TEXT for large JSON strings
  },
  details: {
    type: DataTypes.STRING,
    allowNull: false
  }
}, {
  timestamps: true,
  indexes: [
    {
      fields: ['actorId']
    }
  ]
});

export default AuditLog;
