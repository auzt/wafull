require('dotenv').config();

const defaultConfig = {
    server: {
        port: process.env.PORT || 3000,
        environment: process.env.NODE_ENV || 'development',
        apiKey: process.env.API_KEY || 'default_api_key'
    },

    whatsapp: {
        countryCode: process.env.DEFAULT_COUNTRY_CODE || '62',
        webhookUrl: process.env.DEFAULT_WEBHOOK_URL || null,
        webhookDelay: parseInt(process.env.DEFAULT_WEBHOOK_DELAY) || 1000,
        messageDelay: parseInt(process.env.DEFAULT_MESSAGE_DELAY) || 2000,
        typingDelay: parseInt(process.env.DEFAULT_TYPING_DELAY) || 1500,
        pauseDelay: parseInt(process.env.DEFAULT_PAUSE_DELAY) || 500,
        readMessageDelay: parseInt(process.env.DEFAULT_READ_MESSAGE_DELAY) || 3000,
        showTyping: process.env.DEFAULT_SHOW_TYPING === 'true',
        autoRead: process.env.DEFAULT_AUTO_READ === 'true',
        checkNumber: process.env.DEFAULT_CHECK_NUMBER === 'true'
    },

    database: {
        storage: process.env.DB_STORAGE || './data/database.sqlite',
        logging: process.env.DB_LOGGING === 'true'
    },

    logging: {
        level: process.env.LOG_LEVEL || 'info',
        fileSize: parseInt(process.env.LOG_FILE_SIZE) || 10485760,
        maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5
    },

    security: {
        rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
        rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
    },

    media: {
        maxFileSize: process.env.MAX_FILE_SIZE || '50MB',
        uploadPath: process.env.UPLOAD_PATH || './data/uploads'
    },

    session: {
        path: process.env.SESSION_PATH || './data/sessions',
        timeout: parseInt(process.env.SESSION_TIMEOUT) || 300000,
        maxReconnectAttempts: parseInt(process.env.MAX_RECONNECT_ATTEMPTS) || 5,
        reconnectInterval: parseInt(process.env.RECONNECT_INTERVAL) || 5000
    },

    webhook: {
        timeout: parseInt(process.env.WEBHOOK_TIMEOUT) || 10000,
        retryAttempts: parseInt(process.env.WEBHOOK_RETRY_ATTEMPTS) || 3,
        retryDelay: parseInt(process.env.WEBHOOK_RETRY_DELAY) || 2000
    },

    qr: {
        timeout: parseInt(process.env.QR_TIMEOUT) || 60000
    }
};

// Fungsi untuk mendapatkan konfigurasi per session
const getSessionConfig = (sessionId, customConfig = {}) => {
    return {
        ...defaultConfig.whatsapp,
        ...customConfig,
        sessionId
    };
};

// Fungsi untuk validasi konfigurasi
const validateConfig = (config) => {
    const errors = [];

    if (config.messageDelay < 1000) {
        errors.push('messageDelay minimal 1000ms');
    }

    if (config.webhookDelay < 500) {
        errors.push('webhookDelay minimal 500ms');
    }

    if (config.typingDelay < 500) {
        errors.push('typingDelay minimal 500ms');
    }

    if (config.readMessageDelay < 1000) {
        errors.push('readMessageDelay minimal 1000ms');
    }

    return errors;
};

module.exports = {
    defaultConfig,
    getSessionConfig,
    validateConfig
};