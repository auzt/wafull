const { Sequelize } = require('sequelize');
const { defaultConfig } = require('./default');
const { logger } = require('../utils/logger');

// Konfigurasi database SQLite
const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: defaultConfig.database.storage,
    logging: defaultConfig.database.logging ? (msg) => logger.info('Database Query:', msg) : false,
    pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
    },
    retry: {
        max: 3
    }
});

/**
 * Test koneksi database
 */
const testConnection = async () => {
    try {
        await sequelize.authenticate();
        logger.info('Database connection established successfully');
        return true;
    } catch (error) {
        logger.error('Unable to connect to database:', error);
        return false;
    }
};

/**
 * Initialize database dan buat tabel
 */
const initializeDatabase = async () => {
    try {
        // Import models
        const Session = require('../models/Session');
        const Message = require('../models/Message');
        const Contact = require('../models/Contact');
        const Webhook = require('../models/Webhook');

        // Sync database
        await sequelize.sync({ alter: true });
        logger.info('Database synchronized successfully');

        return true;
    } catch (error) {
        logger.error('Error initializing database:', error);
        return false;
    }
};

/**
 * Close database connection
 */
const closeConnection = async () => {
    try {
        await sequelize.close();
        logger.info('Database connection closed');
    } catch (error) {
        logger.error('Error closing database connection:', error);
    }
};

/**
 * Reset database (development only)
 */
const resetDatabase = async () => {
    if (defaultConfig.server.environment === 'production') {
        throw new Error('Cannot reset database in production');
    }

    try {
        await sequelize.drop();
        await initializeDatabase();
        logger.info('Database reset successfully');
    } catch (error) {
        logger.error('Error resetting database:', error);
        throw error;
    }
};

/**
 * Backup database
 */
const backupDatabase = async () => {
    // Implementation untuk backup SQLite file
    const fs = require('fs');
    const path = require('path');

    try {
        const backupDir = './data/backups';
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(backupDir, `database-backup-${timestamp}.sqlite`);

        fs.copyFileSync(defaultConfig.database.storage, backupPath);
        logger.info(`Database backed up to: ${backupPath}`);

        return backupPath;
    } catch (error) {
        logger.error('Error backing up database:', error);
        throw error;
    }
};

module.exports = {
    sequelize,
    testConnection,
    initializeDatabase,
    closeConnection,
    resetDatabase,
    backupDatabase
};