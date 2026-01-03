import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const CompanyHoliday = sequelize.define('CompanyHoliday', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  date: {
    type: DataTypes.STRING, // YYYY-MM-DD format
    allowNull: false,
    unique: true
  },
  description: {
    type: DataTypes.STRING,
    allowNull: false
  },
  createdBy: {
    type: DataTypes.INTEGER,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  createdByName: {
    type: DataTypes.STRING
  },
  createdByRole: {
    type: DataTypes.ENUM('Admin', 'HR', 'Employee')
  }
}, {
  timestamps: true
});

export default CompanyHoliday;
