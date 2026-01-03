import { testConnection } from './mysql.js';

const connectDB = async () => {
  await testConnection();
};

export default connectDB;
