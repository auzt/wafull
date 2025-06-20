const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { defaultConfig } = require('../config/default');

// Pastikan folder logs ada
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Format untuk log
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// Format untuk console
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let msg = `${timestamp} [${level}]: ${message}`;
        if (Object.keys(meta).length > 0) {
            msg += ` ${JSON.stringify(meta)}`;
        }
        return msg;
    })
);

// Konfigurasi logger utama
const logger = winston.createLogger({
    level: defaultConfig.logging.level,
    format: logFormat,
    defaultMeta: { service: 'wa-api' },
    transports: [
        // File untuk semua log
        new winston.transports.File({
            filename: path.join(logsDir, 'app.log'),
            maxsize: defaultConfig.logging.fileSize,
            maxFiles: defaultConfig.logging.maxFiles
        }),

        // File khusus untuk error
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            maxsize: defaultConfig.logging.fileSize,
            maxFiles: defaultConfig.logging.maxFiles
        }),

        // File khusus untuk webhook
        new winston.transports.File({
            filename: path.join(logsDir, 'webhook.log'),
            level: 'info',
            maxsize: defaultConfig.logging.fileSize,
            maxFiles: defaultConfig.logging.maxFiles
        })
    ]
});

// Tambahkan console transport untuk development
if (defaultConfig.server.environment !== 'production') {
    logger.add(new winston.transports.Console({
        format: consoleFormat
    }));
}

// Logger khusus untuk WhatsApp events
const waLogger = winston.createLogger({
    level: 'info',
    format: logFormat,
    defaultMeta: { service: 'whatsapp' },
    transports: [
        new winston.transports.File({
            filename: path.join(logsDir, 'whatsapp.log'),
            maxsize: defaultConfig.logging.fileSize,
            maxFiles: defaultConfig.logging.maxFiles
        })
    ]
});

// Logger khusus untuk webhook
const webhookLogger = winston.createLogger({
    level: 'info',
    format: logFormat,
    defaultMeta: { service: 'webhook' },
    transports: [
        new winston.transports.File({
            filename: path.join(logsDir, 'webhook.log'),
            maxsize: defaultConfig.logging.fileSize,
            maxFiles: defaultConfig.logging.maxFiles
        })
    ]
});

// Fungsi helper untuk log dengan session ID
const logWithSession = (level, message, sessionId, meta = {}) => {
    logger.log(level, message, { sessionId, ...meta });
};

// Fungsi helper untuk log WhatsApp events
const logWhatsappEvent = (event, sessionId, data = {}) => {
    waLogger.info(`WhatsApp Event: ${event}`, { sessionId, ...data });
};

// Fungsi helper untuk log webhook
const logWebhook = (url, method, status, sessionId, data = {}) => {
    webhookLogger.info(`Webhook ${method} ${url} - ${status}`, { sessionId, ...data });
};

module.exports = {
    logger,
    waLogger,
    webhookLogger,
    logWithSession,
    logWhatsappEvent,
    logWebhook
};