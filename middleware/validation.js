const Joi = require('joi');
const multer = require('multer');
const path = require('path');
const { isValidPhoneNumber } = require('../utils/phoneFormatter');
const { defaultConfig } = require('../config/default');

/**
 * Validation schemas
 */
const schemas = {
    // Session validation
    createSession: Joi.object({
        sessionId: Joi.string().alphanum().min(3).max(50).optional(),
        config: Joi.object({
            countryCode: Joi.string().pattern(/^\d{1,4}$/).optional(),
            webhookUrl: Joi.string().uri().optional().allow(''),
            webhookDelay: Joi.number().integer().min(500).max(10000).optional(),
            messageDelay: Joi.number().integer().min(1000).max(30000).optional(),
            typingDelay: Joi.number().integer().min(500).max(5000).optional(),
            pauseDelay: Joi.number().integer().min(100).max(2000).optional(),
            readMessageDelay: Joi.number().integer().min(1000).max(10000).optional(),
            showTyping: Joi.boolean().optional(),
            autoRead: Joi.boolean().optional(),
            checkNumber: Joi.boolean().optional()
        }).optional()
    }),

    // Message validation
    sendText: Joi.object({
        sessionId: Joi.string().required(),
        to: Joi.alternatives().try(
            Joi.string().required(),
            Joi.array().items(Joi.string()).min(1).required()
        ),
        text: Joi.string().min(1).max(65536).required(),
        options: Joi.object({
            quoted: Joi.object().optional(),
            mentions: Joi.array().items(Joi.string()).optional()
        }).optional()
    }),

    sendLocation: Joi.object({
        sessionId: Joi.string().required(),
        to: Joi.alternatives().try(
            Joi.string().required(),
            Joi.array().items(Joi.string()).min(1).required()
        ),
        latitude: Joi.number().min(-90).max(90).required(),
        longitude: Joi.number().min(-180).max(180).required(),
        name: Joi.string().max(100).optional().allow(''),
        address: Joi.string().max(200).optional().allow(''),
        options: Joi.object().optional()
    }),

    sendContact: Joi.object({
        sessionId: Joi.string().required(),
        to: Joi.alternatives().try(
            Joi.string().required(),
            Joi.array().items(Joi.string()).min(1).required()
        ),
        contact: Joi.object({
            name: Joi.string().min(1).max(100).required(),
            phone: Joi.string().required(),
            organization: Joi.string().max(100).optional().allow('')
        }).required(),
        options: Joi.object().optional()
    }),

    sendReaction: Joi.object({
        sessionId: Joi.string().required(),
        messageKey: Joi.object({
            id: Joi.string().required(),
            remoteJid: Joi.string().required(),
            fromMe: Joi.boolean().optional(),
            participant: Joi.string().optional()
        }).required(),
        emoji: Joi.string().min(1).max(10).required()
    }),

    messageAction: Joi.object({
        sessionId: Joi.string().required(),
        messageKey: Joi.object({
            id: Joi.string().required(),
            remoteJid: Joi.string().required(),
            fromMe: Joi.boolean().optional(),
            participant: Joi.string().optional()
        }).required()
    }),

    // Auth validation
    connect: Joi.object({
        sessionId: Joi.string().required(),
        config: Joi.object().optional()
    }),

    checkNumber: Joi.object({
        sessionId: Joi.string().required(),
        phone: Joi.string().required()
    }),

    pairingCode: Joi.object({
        sessionId: Joi.string().required(),
        phoneNumber: Joi.string().pattern(/^\d{10,15}$/).required()
    })
};

/**
 * Generic validation middleware
 */
const validate = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.body, {
            allowUnknown: false,
            stripUnknown: true,
            abortEarly: false
        });

        if (error) {
            const errors = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message,
                value: detail.context?.value
            }));

            return res.status(400).json({
                success: false,
                error: 'Validation error',
                details: errors
            });
        }

        req.body = value;
        next();
    };
};

/**
 * Custom phone number validation
 */
const validatePhoneNumbers = (req, res, next) => {
    const { to } = req.body;

    if (!to) {
        return next();
    }

    const numbers = Array.isArray(to) ? to : to.split(',').map(n => n.trim());
    const invalidNumbers = [];

    for (const number of numbers) {
        if (!isValidPhoneNumber(number)) {
            invalidNumbers.push(number);
        }
    }

    if (invalidNumbers.length > 0) {
        return res.status(400).json({
            success: false,
            error: 'Invalid phone numbers detected',
            invalidNumbers: invalidNumbers
        });
    }

    next();
};

/**
 * File upload configuration
 */
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    // Allowed file types
    const allowedMimes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'video/mp4',
        'video/avi',
        'video/mkv',
        'video/mov',
        'audio/mp3',
        'audio/wav',
        'audio/ogg',
        'audio/m4a',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain',
        'application/zip',
        'application/x-rar-compressed'
    ];

    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`File type not allowed: ${file.mimetype}`), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
        files: 1
    }
});

/**
 * Media type validation
 */
const validateMediaType = (req, res, next) => {
    const { type } = req.body;
    const file = req.file;

    if (!type || !file) {
        return next();
    }

    const typeMapping = {
        image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
        video: ['video/mp4', 'video/avi', 'video/mkv', 'video/mov'],
        audio: ['audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a'],
        document: [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/plain',
            'application/zip',
            'application/x-rar-compressed'
        ]
    };

    const allowedMimes = typeMapping[type.toLowerCase()];

    if (!allowedMimes || !allowedMimes.includes(file.mimetype)) {
        return res.status(400).json({
            success: false,
            error: `File type ${file.mimetype} not allowed for media type ${type}`,
            allowedTypes: allowedMimes
        });
    }

    next();
};

/**
 * Session existence validation
 */
const validateSessionExists = (req, res, next) => {
    const sessionManager = require('../services/sessionManager');
    const sessionId = req.body.sessionId || req.params.sessionId;

    if (!sessionId) {
        return res.status(400).json({
            success: false,
            error: 'Session ID is required'
        });
    }

    if (!sessionManager.hasSession(sessionId)) {
        return res.status(404).json({
            success: false,
            error: 'Session not found'
        });
    }

    next();
};

/**
 * Session connection validation
 */
const validateSessionConnected = (req, res, next) => {
    const sessionManager = require('../services/sessionManager');
    const sessionId = req.body.sessionId || req.params.sessionId;

    if (!sessionManager.isSessionConnected(sessionId)) {
        return res.status(400).json({
            success: false,
            error: 'Session not connected'
        });
    }

    next();
};

/**
 * Rate limiting untuk file upload
 */
const uploadRateLimit = (req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    const windowMs = 60000; // 1 menit
    const maxUploads = 10; // maksimal 10 upload per menit per IP

    if (!uploadRateLimit.uploads) {
        uploadRateLimit.uploads = new Map();
    }

    const ipUploads = uploadRateLimit.uploads.get(ip) || [];

    // Remove old uploads
    const validUploads = ipUploads.filter(time => now - time < windowMs);

    if (validUploads.length >= maxUploads) {
        return res.status(429).json({
            success: false,
            error: `Upload rate limit exceeded. Max ${maxUploads} uploads per minute.`,
            retryAfter: Math.ceil(windowMs / 1000)
        });
    }

    // Add current upload
    validUploads.push(now);
    uploadRateLimit.uploads.set(ip, validUploads);

    next();
};

/**
 * Validate webhook URL
 */
const validateWebhookUrl = (req, res, next) => {
    const { config } = req.body;

    if (config && config.webhookUrl) {
        try {
            const url = new URL(config.webhookUrl);

            // Check protocol
            if (!['http:', 'https:'].includes(url.protocol)) {
                return res.status(400).json({
                    success: false,
                    error: 'Webhook URL must use HTTP or HTTPS protocol'
                });
            }

            // Check localhost in production
            if (defaultConfig.server.environment === 'production' &&
                (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
                return res.status(400).json({
                    success: false,
                    error: 'Localhost URLs not allowed in production'
                });
            }

        } catch (error) {
            return res.status(400).json({
                success: false,
                error: 'Invalid webhook URL format'
            });
        }
    }

    next();
};

/**
 * Validate text message length
 */
const validateTextLength = (req, res, next) => {
    const { text } = req.body;

    if (text && text.length > 65536) {
        return res.status(400).json({
            success: false,
            error: 'Text message too long. Maximum 65536 characters.'
        });
    }

    next();
};

/**
 * Validate recipients limit
 */
const validateRecipientsLimit = (maxRecipients = 100) => {
    return (req, res, next) => {
        const { to } = req.body;

        if (to) {
            const recipients = Array.isArray(to) ? to : to.split(',');

            if (recipients.length > maxRecipients) {
                return res.status(400).json({
                    success: false,
                    error: `Too many recipients. Maximum ${maxRecipients} allowed.`,
                    provided: recipients.length
                });
            }
        }

        next();
    };
};

module.exports = {
    schemas,
    validate,
    validatePhoneNumbers,
    upload,
    validateMediaType,
    validateSessionExists,
    validateSessionConnected,
    uploadRateLimit,
    validateWebhookUrl,
    validateTextLength,
    validateRecipientsLimit
};