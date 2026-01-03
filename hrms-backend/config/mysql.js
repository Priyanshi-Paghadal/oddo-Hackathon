import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// Create a connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'hrms',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test the connection
const testConnection = async () => {
    try {
        const connection = await pool.getConnection();
        console.log(`MySQL Connected: ${process.env.DB_HOST}:${process.env.DB_PORT}`);
        console.log(`Database: ${process.env.DB_NAME}`);
        connection.release();
    } catch (error) {
        console.error('Error connecting to MySQL:', error.message);
        process.exit(1);
    }
};

export { pool, testConnection };
