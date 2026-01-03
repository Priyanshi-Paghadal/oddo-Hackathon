import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const LeaveRequest = sequelize.define('LeaveRequest', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  userName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  startDate: {
    type: DataTypes.STRING, // YYYY-MM-DD format
    allowNull: false
  },
  endDate: {
    type: DataTypes.STRING, // YYYY-MM-DD format
    allowNull: false
  },
  category: {
    type: DataTypes.ENUM('Paid Leave', 'Unpaid Leave', 'Half Day Leave', 'Extra Time Leave'),
    allowNull: false
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  attachmentUrl: {
    type: DataTypes.STRING
  },
  status: {
    type: DataTypes.ENUM('Pending', 'Approved', 'Rejected'),
    defaultValue: 'Pending'
  },
  hrComment: {
    type: DataTypes.TEXT
  },
  startTime: {
    type: DataTypes.STRING // HH:mm format
  },
  endTime: {
    type: DataTypes.STRING // HH:mm format
  }
}, {
  timestamps: true
});

export default LeaveRequest;
