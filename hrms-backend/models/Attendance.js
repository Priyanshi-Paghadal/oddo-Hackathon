import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Attendance = sequelize.define('Attendance', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'Users', // This is the table name, normally pluralized by Sequelize
      key: 'id'
    }
  },
  date: {
    type: DataTypes.STRING, // YYYY-MM-DD format
    allowNull: false
  },
  checkIn: {
    type: DataTypes.DATE
  },
  checkOut: {
    type: DataTypes.DATE
  },
  location: {
    type: DataTypes.STRING
  },
  breaks: {
    type: DataTypes.JSON, // Array of break objects
    defaultValue: []
  },
  totalWorkedSeconds: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  lowTimeFlag: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  extraTimeFlag: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  notes: {
    type: DataTypes.TEXT
  }
}, {
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['userId', 'date']
    }
  ]
});

export default Attendance;
