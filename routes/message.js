const express = require('express');
const router = express.Router();

// Import controllers
const messageController = require('../controllers/messageController');

// Import middleware
const {
    sanitizeInput,
    sessionRateLimit,
    validateRequired,
    requestTimeout
} = require('../middleware/auth');

const {
    validate,
    schemas,
    validatePhoneNumbers,
    upload,
    validateMediaType,
    validateSessionExists,
    validateSessionConnected,
    uploadRateLimit,
    validateTextLength,
    validateRecipientsLimit
} = require('../middleware/validation');

/**
 * Apply middleware untuk semua message routes
 */
router.use(sanitizeInput);
router.use(sessionRateLimit);
router.use(requestTimeout(60000)); // 60 detik timeout untuk upload media

/**
 * POST /api/message/send-text
 * Send text message to single or multiple recipients
 */
router.post('/send-text',
    validate(schemas.sendText),
    validateSessionExists,
    validateSessionConnected,
    validatePhoneNumbers,
    validateTextLength,
    validateRecipientsLimit(100),
    messageController.sendText
);

/**
 * POST /api/message/send-media
 * Send media message (image, video, audio, document)
 */
router.post('/send-media',
    uploadRateLimit,
    upload.single('media'),
    (req, res, next) => {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Media file is required'
            });
        }
        next();
    },
    validateSessionExists,
    validateSessionConnected,
    validatePhoneNumbers,
    validateMediaType,
    validateRecipientsLimit(50), // Lebih sedikit untuk media karena ukuran file
    messageController.sendMedia
);

/**
 * POST /api/message/send-location
 * Send location message
 */
router.post('/send-location',
    validate(schemas.sendLocation),
    validateSessionExists,
    validateSessionConnected,
    validatePhoneNumbers,
    validateRecipientsLimit(100),
    messageController.sendLocation
);

/**
 * POST /api/message/send-contact
 * Send contact message
 */
router.post('/send-contact',
    validate(schemas.sendContact),
    validateSessionExists,
    validateSessionConnected,
    validatePhoneNumbers,
    validateRecipientsLimit(100),
    messageController.sendContact
);

/**
 * POST /api/message/send-reaction
 * Send reaction to a message
 */
router.post('/send-reaction',
    validate(schemas.sendReaction),
    validateSessionExists,
    validateSessionConnected,
    messageController.sendReaction
);

/**
 * POST /api/message/forward
 * Forward message to recipients
 */
router.post('/forward',
    validateRequired(['sessionId', 'to', 'message']),
    validateSessionExists,
    validateSessionConnected,
    validatePhoneNumbers,
    validateRecipientsLimit(50),
    messageController.forwardMessage
);

/**
 * POST /api/message/delete
 * Delete message
 */
router.post('/delete',
    validate(schemas.messageAction),
    (req, res, next) => {
        // Add forEveryone field validation
        if (req.body.forEveryone !== undefined && typeof req.body.forEveryone !== 'boolean') {
            return res.status(400).json({
                success: false,
                error: 'forEveryone must be a boolean value'
            });
        }
        next();
    },
    validateSessionExists,
    validateSessionConnected,
    messageController.deleteMessage
);

/**
 * POST /api/message/edit
 * Edit message text
 */
router.post('/edit',
    validate(schemas.messageAction),
    validateRequired(['newText']),
    validateSessionExists,
    validateSessionConnected,
    validateTextLength,
    messageController.editMessage
);

/**
 * POST /api/message/download-media
 * Download media from message
 */
router.post('/download-media',
    validateRequired(['sessionId', 'message']),
    validateSessionExists,
    validateSessionConnected,
    messageController.downloadMedia
);

/**
 * GET /api/message/history/:sessionId/:jid
 * Get message history for a chat
 */
router.get('/history/:sessionId/:jid',
    (req, res, next) => {
        const { sessionId, jid } = req.params;

        if (!sessionId || !jid) {
            return res.status(400).json({
                success: false,
                error: 'sessionId and jid parameters are required'
            });
        }

        // Validate limit and before query params
        const { limit, before } = req.query;

        if (limit && (isNaN(limit) || parseInt(limit) > 1000)) {
            return res.status(400).json({
                success: false,
                error: 'limit must be a number and maximum 1000'
            });
        }

        if (before && isNaN(before)) {
            return res.status(400).json({
                success: false,
                error: 'before must be a valid timestamp'
            });
        }

        next();
    },
    messageController.getMessageHistory
);

/**
 * POST /api/message/send-poll
 * Send poll message
 */
router.post('/send-poll',
    (req, res, next) => {
        const { sessionId, to, question, options } = req.body;

        if (!sessionId || !to || !question || !options) {
            return res.status(400).json({
                success: false,
                error: 'sessionId, to, question, and options are required'
            });
        }

        if (!Array.isArray(options) || options.length < 2 || options.length > 12) {
            return res.status(400).json({
                success: false,
                error: 'options must be an array with 2-12 items'
            });
        }

        next();
    },
    validateSessionExists,
    validateSessionConnected,
    validatePhoneNumbers,
    validateRecipientsLimit(50),
    async (req, res) => {
        try {
            const { sessionId, to, question, options, allowMultipleAnswers = false } = req.body;
            const sessionManager = require('../services/sessionManager');
            const { formatMultipleToWhatsAppId } = require('../utils/phoneFormatter');
            const { logWithSession } = require('../utils/logger');

            const sock = sessionManager.getSession(sessionId);
            const config = sessionManager.getSessionConfig(sessionId);
            const recipients = Array.isArray(to) ? to : [to];
            const results = [];

            for (const recipient of recipients) {
                try {
                    const jid = formatMultipleToWhatsAppId(recipient, config.countryCode)[0];

                    const pollMessage = {
                        poll: {
                            name: question,
                            values: options.map(option => ({ name: option })),
                            selectableCount: allowMultipleAnswers ? options.length : 1
                        }
                    };

                    const sentMessage = await sock.sendMessage(jid, pollMessage);

                    results.push({
                        to: recipient,
                        success: true,
                        messageId: sentMessage.key.id,
                        timestamp: sentMessage.messageTimestamp
                    });

                    logWithSession('info', 'Poll message sent', sessionId, {
                        to: jid,
                        question: question,
                        optionsCount: options.length
                    });

                } catch (error) {
                    results.push({
                        to: recipient,
                        success: false,
                        error: error.message
                    });
                }
            }

            res.json({
                success: results.every(r => r.success),
                message: 'Poll message processed',
                data: results
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

/**
 * POST /api/message/send-list
 * Send list message (interactive)
 */
router.post('/send-list',
    (req, res, next) => {
        const { sessionId, to, title, buttonText, sections } = req.body;

        if (!sessionId || !to || !title || !buttonText || !sections) {
            return res.status(400).json({
                success: false,
                error: 'sessionId, to, title, buttonText, and sections are required'
            });
        }

        if (!Array.isArray(sections) || sections.length === 0 || sections.length > 10) {
            return res.status(400).json({
                success: false,
                error: 'sections must be an array with 1-10 items'
            });
        }

        // Validate sections structure
        for (const section of sections) {
            if (!section.title || !section.rows || !Array.isArray(section.rows)) {
                return res.status(400).json({
                    success: false,
                    error: 'Each section must have title and rows array'
                });
            }

            if (section.rows.length === 0 || section.rows.length > 10) {
                return res.status(400).json({
                    success: false,
                    error: 'Each section must have 1-10 rows'
                });
            }

            for (const row of section.rows) {
                if (!row.rowId || !row.title) {
                    return res.status(400).json({
                        success: false,
                        error: 'Each row must have rowId and title'
                    });
                }
            }
        }

        next();
    },
    validateSessionExists,
    validateSessionConnected,
    validatePhoneNumbers,
    validateRecipientsLimit(20), // Lebih sedikit untuk interactive messages
    async (req, res) => {
        try {
            const { sessionId, to, title, buttonText, sections, footer = '' } = req.body;
            const sessionManager = require('../services/sessionManager');
            const { formatMultipleToWhatsAppId } = require('../utils/phoneFormatter');
            const { logWithSession } = require('../utils/logger');

            const sock = sessionManager.getSession(sessionId);
            const config = sessionManager.getSessionConfig(sessionId);
            const recipients = Array.isArray(to) ? to : [to];
            const results = [];

            for (const recipient of recipients) {
                try {
                    const jid = formatMultipleToWhatsAppId(recipient, config.countryCode)[0];

                    const listMessage = {
                        text: title,
                        footer: footer,
                        title: title,
                        buttonText: buttonText,
                        sections: sections
                    };

                    const sentMessage = await sock.sendMessage(jid, listMessage);

                    results.push({
                        to: recipient,
                        success: true,
                        messageId: sentMessage.key.id,
                        timestamp: sentMessage.messageTimestamp
                    });

                    logWithSession('info', 'List message sent', sessionId, {
                        to: jid,
                        title: title,
                        sectionsCount: sections.length
                    });

                } catch (error) {
                    results.push({
                        to: recipient,
                        success: false,
                        error: error.message
                    });
                }
            }

            res.json({
                success: results.every(r => r.success),
                message: 'List message processed',
                data: results
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

/**
 * POST /api/message/send-button
 * Send button message
 */
router.post('/send-button',
    (req, res, next) => {
        const { sessionId, to, text, buttons } = req.body;

        if (!sessionId || !to || !text || !buttons) {
            return res.status(400).json({
                success: false,
                error: 'sessionId, to, text, and buttons are required'
            });
        }

        if (!Array.isArray(buttons) || buttons.length === 0 || buttons.length > 3) {
            return res.status(400).json({
                success: false,
                error: 'buttons must be an array with 1-3 items'
            });
        }

        // Validate buttons structure
        for (const button of buttons) {
            if (!button.buttonId || !button.displayText) {
                return res.status(400).json({
                    success: false,
                    error: 'Each button must have buttonId and displayText'
                });
            }
        }

        next();
    },
    validateSessionExists,
    validateSessionConnected,
    validatePhoneNumbers,
    validateRecipientsLimit(20),
    async (req, res) => {
        try {
            const { sessionId, to, text, buttons, footer = '', header = '' } = req.body;
            const sessionManager = require('../services/sessionManager');
            const { formatMultipleToWhatsAppId } = require('../utils/phoneFormatter');
            const { logWithSession } = require('../utils/logger');

            const sock = sessionManager.getSession(sessionId);
            const config = sessionManager.getSessionConfig(sessionId);
            const recipients = Array.isArray(to) ? to : [to];
            const results = [];

            for (const recipient of recipients) {
                try {
                    const jid = formatMultipleToWhatsAppId(recipient, config.countryCode)[0];

                    const buttonMessage = {
                        text: text,
                        footer: footer,
                        headerText: header,
                        buttons: buttons.map((btn, index) => ({
                            buttonId: btn.buttonId,
                            buttonText: { displayText: btn.displayText },
                            type: 1
                        }))
                    };

                    const sentMessage = await sock.sendMessage(jid, buttonMessage);

                    results.push({
                        to: recipient,
                        success: true,
                        messageId: sentMessage.key.id,
                        timestamp: sentMessage.messageTimestamp
                    });

                    logWithSession('info', 'Button message sent', sessionId, {
                        to: jid,
                        text: text,
                        buttonsCount: buttons.length
                    });

                } catch (error) {
                    results.push({
                        to: recipient,
                        success: false,
                        error: error.message
                    });
                }
            }

            res.json({
                success: results.every(r => r.success),
                message: 'Button message processed',
                data: results
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

module.exports = router;