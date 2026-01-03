import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const SystemSettings = sequelize.define('SystemSettings', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  timezone: {
    type: DataTypes.STRING,
    defaultValue: 'Asia/Kolkata'
  }
}, {
  timestamps: true
});

// Helper to ensure singleton settings
SystemSettings.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({ timezone: 'Asia/Kolkata' });
  }
  return settings;
};

export default SystemSettings;
