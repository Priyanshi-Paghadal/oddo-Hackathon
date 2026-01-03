import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import bcrypt from 'bcryptjs';

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('Employee', 'HR', 'Admin'),
    allowNull: false,
    defaultValue: 'Employee'
  },
  department: {
    type: DataTypes.STRING,
    allowNull: false
  },
  phone: {
    type: DataTypes.STRING
  },
  aadhaarNumber: {
    type: DataTypes.STRING
  },
  guardianName: {
    type: DataTypes.STRING
  },
  mobileNumber: {
    type: DataTypes.STRING
  },
  guardianMobileNumber: {
    type: DataTypes.STRING
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  isFirstLogin: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  lastLogin: {
    type: DataTypes.DATE
  },
  paidLeaveAllocation: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  paidLeaveLastAllocatedDate: {
    type: DataTypes.DATE
  },
  joiningDate: {
    type: DataTypes.STRING // Keeping as String to match Mongoose schema (dd-mm-yyyy)
  },
  bonds: {
    type: DataTypes.JSON, // Using JSON to store array of objects
    defaultValue: []
  },
  salaryBreakdown: {
    type: DataTypes.JSON, // Using JSON to store array of objects
    defaultValue: []
  }
}, {
  timestamps: true,
  hooks: {
    beforeCreate: async (user) => {
      if (user.password) {
        user.password = await bcrypt.hash(user.password, 10);
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password')) {
        user.password = await bcrypt.hash(user.password, 10);
      }
    }
  }
});

// Instance method to compare password
User.prototype.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

export default User;
