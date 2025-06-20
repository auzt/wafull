const Joi = require('joi');

/**
 * Validation rules untuk berbagai input
 */
const validationRules = {
    // Session validation
    sessionId: Joi.string().alphanum().min(3).max(50),
    countryCode: Joi.string().pattern(/^\d{1,4}$/),
    phoneNumber: Joi.string().pattern(/^[\d\s\-\+\(\)]{10,20}$/),

    // URL validation
    webhookUrl: Joi.string().uri({ allowRelative: false }),

    // Numeric validations
    delay: {
        webhook: Joi.number().integer().min(500).max(30000),
        message: Joi.number().integer().min(1000).max(60000),
        typing: Joi.number().integer().min(500).max(10000),
        pause: Joi.number().integer().min(100).max(5000),
        readMessage: Joi.number().integer().min(1000).max(30000)
    },

    // Boolean validations
    booleanField: Joi.boolean(),

    // Text validations
    text: {
        short: Joi.string().max(100),
        medium: Joi.string().max(500),
        long: Joi.string().max(65536),
        message: Joi.string().min(1).max(65536)
    },

    // File validations
    file: {
        maxSize: 50 * 1024 * 1024, // 50MB
        allowedMimes: {
            image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
            video: ['video/mp4', 'video/avi', 'video/mkv', 'video/mov', 'video/webm'],
            audio: ['audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/aac'],
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
        }
    },

    // Coordinate validation
    coordinates: {
        latitude: Joi.number().min(-90).max(90),
        longitude: Joi.number().min(-180).max(180)
    },

    // Array validations
    array: {
        phones: Joi.array().items(Joi.string()).min(1).max(100),
        participants: Joi.array().items(Joi.string()).min(1).max(256),
        mentions: Joi.array().items(Joi.string()).max(50)
    }
};

/**
 * Custom validation functions
 */
const customValidations = {
    /**
     * Validate phone number format
     */
    validatePhoneNumber: (phone) => {
        const phoneRegex = /^[\d\s\-\+\(\)]{8,20}$/;
        return phoneRegex.test(phone);
    },

    /**
     * Validate WhatsApp JID format
     */
    validateJid: (jid) => {
        const jidRegex = /^\d{10,15}@(s\.whatsapp\.net|g\.us)$/;
        return jidRegex.test(jid);
    },

    /**
     * Validate session configuration
     */
    validateSessionConfig: (config) => {
        const schema = Joi.object({
            countryCode: validationRules.countryCode.optional(),
            webhookUrl: validationRules.webhookUrl.optional().allow(''),
            webhookDelay: validationRules.delay.webhook.optional(),
            messageDelay: validationRules.delay.message.optional(),
            typingDelay: validationRules.delay.typing.optional(),
            pauseDelay: validationRules.delay.pause.optional(),
            readMessageDelay: validationRules.delay.readMessage.optional(),
            showTyping: validationRules.booleanField.optional(),
            autoRead: validationRules.booleanField.optional(),
            checkNumber: validationRules.booleanField.optional()
        });

        return schema.validate(config);
    },

    /**
     * Validate media file
     */
    validateMediaFile: (file, mediaType) => {
        const errors = [];

        // Check file size
        if (file.size > validationRules.file.maxSize) {
            errors.push('File size exceeds maximum limit (50MB)');
        }

        // Check mime type
        const allowedMimes = validationRules.file.allowedMimes[mediaType.toLowerCase()];
        if (!allowedMimes || !allowedMimes.includes(file.mimetype)) {
            errors.push(`Invalid file type for ${mediaType}. Allowed types: ${allowedMimes?.join(', ') || 'none'}`);
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    },

    /**
     * Validate contact data
     */
    validateContact: (contact) => {
        const schema = Joi.object({
            name: validationRules.text.short.required(),
            phone: validationRules.phoneNumber.required(),
            organization: validationRules.text.medium.optional().allow('')
        });

        return schema.validate(contact);
    },

    /**
     * Validate location data
     */
    validateLocation: (location) => {
        const schema = Joi.object({
            latitude: validationRules.coordinates.latitude.required(),
            longitude: validationRules.coordinates.longitude.required(),
            name: validationRules.text.short.optional().allow(''),
            address: validationRules.text.medium.optional().allow('')
        });

        return schema.validate(location);
    },

    /**
     * Validate message key
     */
    validateMessageKey: (messageKey) => {
        const schema = Joi.object({
            id: Joi.string().required(),
            remoteJid: Joi.string().required(),
            fromMe: Joi.boolean().optional(),
            participant: Joi.string().optional()
        });

        return schema.validate(messageKey);
    },

    /**
     * Validate poll options
     */
    validatePollOptions: (options) => {
        const schema = Joi.array()
            .items(Joi.string().min(1).max(100))
            .min(2)
            .max(12);

        return schema.validate(options);
    },

    /**
     * Validate list sections
     */
    validateListSections: (sections) => {
        const rowSchema = Joi.object({
            rowId: Joi.string().required(),
            title: Joi.string().min(1).max(24).required(),
            description: Joi.string().max(72).optional().allow('')
        });

        const sectionSchema = Joi.object({
            title: Joi.string().min(1).max(24).required(),
            rows: Joi.array().items(rowSchema).min(1).max(10).required()
        });

        const schema = Joi.array()
            .items(sectionSchema)
            .min(1)
            .max(10);

        return schema.validate(sections);
    },

    /**
     * Validate button data
     */
    validateButtons: (buttons) => {
        const buttonSchema = Joi.object({
            buttonId: Joi.string().required(),
            displayText: Joi.string().min(1).max(20).required(),
            type: Joi.number().valid(1).default(1)
        });

        const schema = Joi.array()
            .items(buttonSchema)
            .min(1)
            .max(3);

        return schema.validate(buttons);
    },

    /**
     * Validate webhook event data
     */
    validateWebhookEvent: (eventData) => {
        const schema = Joi.object({
            event: Joi.string().required(),
            sessionId: Joi.string().required(),
            timestamp: Joi.string().isoDate().required(),
            data: Joi.object().optional()
        });

        return schema.validate(eventData);
    },

    /**
     * Validate privacy settings
     */
    validatePrivacySettings: (settings) => {
        const privacyValues = ['all', 'contacts', 'contact_blacklist', 'none'];
        const privacySettings = ['readreceipts', 'profile', 'status', 'online', 'last', 'groupadd'];

        const schema = Joi.object({
            setting: Joi.string().valid(...privacySettings).required(),
            value: Joi.string().valid(...privacyValues).required()
        });

        return schema.validate(settings);
    }
};

/**
 * Common validation schemas
 */
const commonSchemas = {
    pagination: Joi.object({
        limit: Joi.number().integer().min(1).max(1000).default(50),
        offset: Joi.number().integer().min(0).default(0)
    }),

    sessionIdentifier: Joi.object({
        sessionId: validationRules.sessionId.required()
    }),

    phoneInput: Joi.object({
        phone: validationRules.phoneNumber.required()
    }),

    messageTarget: Joi.object({
        to: Joi.alternatives().try(
            validationRules.phoneNumber,
            validationRules.array.phones
        ).required()
    })
};

/**
 * Validation error formatter
 */
const formatValidationError = (error) => {
    if (!error || !error.details) {
        return { errors: ['Unknown validation error'] };
    }

    const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
    }));

    return { errors };
};

/**
 * Sanitize input data
 */
const sanitizeInput = (data, options = {}) => {
    if (typeof data !== 'object' || data === null) {
        return data;
    }

    const sanitized = {};
    const { allowHtml = false, maxLength = 10000 } = options;

    for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string') {
            let sanitizedValue = value.trim();

            // Remove HTML if not allowed
            if (!allowHtml) {
                sanitizedValue = sanitizedValue.replace(/<[^>]*>/g, '');
            }

            // Limit length
            if (sanitizedValue.length > maxLength) {
                sanitizedValue = sanitizedValue.substring(0, maxLength);
            }

            sanitized[key] = sanitizedValue;
        } else if (typeof value === 'object' && value !== null) {
            sanitized[key] = sanitizeInput(value, options);
        } else {
            sanitized[key] = value;
        }
    }

    return sanitized;
};

module.exports = {
    validationRules,
    customValidations,
    commonSchemas,
    formatValidationError,
    sanitizeInput
};