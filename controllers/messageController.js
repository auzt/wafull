const messageService = require('../services/messageService');
const sessionManager = require('../services/sessionManager');
const { logger, logWithSession } = require('../utils/logger');
const { formatMultiplePhones, isValidPhoneNumber } = require('../utils/phoneFormatter');

class MessageController {

    /**
     * Send text message
     * POST /api/message/send-text
     */
    async sendText(req, res) {
        try {
            const { sessionId, to, text, options = {} } = req.body;

            // Validasi input
            if (!sessionId || !to || !text) {
                return res.status(400).json({
                    success: false,
                    error: 'sessionId, to, and text are required'
                });
            }

            // Cek apakah session exist dan terhubung
            if (!sessionManager.hasSession(sessionId)) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            if (!sessionManager.isSessionConnected(sessionId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Session not connected'
                });
            }

            // Validasi nomor telepon
            const recipients = Array.isArray(to) ? to : to.split(',').map(phone => phone.trim());
            const invalidNumbers = recipients.filter(phone => !isValidPhoneNumber(phone));

            if (invalidNumbers.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid phone numbers',
                    invalidNumbers: invalidNumbers
                });
            }

            // Send message
            const result = await messageService.sendTextMessage(sessionId, recipients, text, options);

            logWithSession('info', 'Text message sent via API', sessionId, {
                to: recipients,
                success: result.success
            });

            res.json({
                success: result.success,
                message: 'Text message sent',
                data: result.results
            });

        } catch (error) {
            logger.error('Error in sendText:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Send media message
     * POST /api/message/send-media
     */
    async sendMedia(req, res) {
        try {
            const { sessionId, to, type, caption, fileName, options = {} } = req.body;

            // Validasi input
            if (!sessionId || !to || !type || !req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'sessionId, to, type, and media file are required'
                });
            }

            // Validasi tipe media
            const allowedTypes = ['image', 'video', 'audio', 'document'];
            if (!allowedTypes.includes(type.toLowerCase())) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid media type. Allowed types: ${allowedTypes.join(', ')}`
                });
            }

            // Cek session
            if (!sessionManager.hasSession(sessionId)) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            if (!sessionManager.isSessionConnected(sessionId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Session not connected'
                });
            }

            // Validasi nomor telepon
            const recipients = Array.isArray(to) ? to : to.split(',').map(phone => phone.trim());
            const invalidNumbers = recipients.filter(phone => !isValidPhoneNumber(phone));

            if (invalidNumbers.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid phone numbers',
                    invalidNumbers: invalidNumbers
                });
            }

            // Prepare media options
            const mediaOptions = {
                caption: caption || '',
                fileName: fileName || req.file.originalname,
                mimeType: req.file.mimetype,
                ...options
            };

            // Send media message
            const result = await messageService.sendMediaMessage(
                sessionId,
                recipients,
                req.file.buffer,
                type,
                mediaOptions
            );

            logWithSession('info', 'Media message sent via API', sessionId, {
                to: recipients,
                type: type,
                fileName: req.file.originalname,
                success: result.success
            });

            res.json({
                success: result.success,
                message: 'Media message sent',
                data: result.results
            });

        } catch (error) {
            logger.error('Error in sendMedia:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Send location message
     * POST /api/message/send-location
     */
    async sendLocation(req, res) {
        try {
            const { sessionId, to, latitude, longitude, name, address, options = {} } = req.body;

            // Validasi input
            if (!sessionId || !to || latitude === undefined || longitude === undefined) {
                return res.status(400).json({
                    success: false,
                    error: 'sessionId, to, latitude, and longitude are required'
                });
            }

            // Validasi koordinat
            if (typeof latitude !== 'number' || typeof longitude !== 'number') {
                return res.status(400).json({
                    success: false,
                    error: 'latitude and longitude must be numbers'
                });
            }

            if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid coordinates'
                });
            }

            // Cek session
            if (!sessionManager.hasSession(sessionId)) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            if (!sessionManager.isSessionConnected(sessionId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Session not connected'
                });
            }

            // Validasi nomor telepon
            const recipients = Array.isArray(to) ? to : to.split(',').map(phone => phone.trim());
            const invalidNumbers = recipients.filter(phone => !isValidPhoneNumber(phone));

            if (invalidNumbers.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid phone numbers',
                    invalidNumbers: invalidNumbers
                });
            }

            // Send location message
            const locationOptions = {
                name: name || '',
                address: address || '',
                ...options
            };

            const result = await messageService.sendLocationMessage(
                sessionId,
                recipients,
                latitude,
                longitude,
                locationOptions
            );

            logWithSession('info', 'Location message sent via API', sessionId, {
                to: recipients,
                latitude: latitude,
                longitude: longitude,
                success: result.success
            });

            res.json({
                success: result.success,
                message: 'Location message sent',
                data: result.results
            });

        } catch (error) {
            logger.error('Error in sendLocation:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Send contact message
     * POST /api/message/send-contact
     */
    async sendContact(req, res) {
        try {
            const { sessionId, to, contact, options = {} } = req.body;

            // Validasi input
            if (!sessionId || !to || !contact || !contact.name || !contact.phone) {
                return res.status(400).json({
                    success: false,
                    error: 'sessionId, to, contact.name, and contact.phone are required'
                });
            }

            // Cek session
            if (!sessionManager.hasSession(sessionId)) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            if (!sessionManager.isSessionConnected(sessionId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Session not connected'
                });
            }

            // Validasi nomor telepon
            const recipients = Array.isArray(to) ? to : to.split(',').map(phone => phone.trim());
            const invalidNumbers = recipients.filter(phone => !isValidPhoneNumber(phone));

            if (invalidNumbers.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid phone numbers',
                    invalidNumbers: invalidNumbers
                });
            }

            // Validasi nomor kontak
            if (!isValidPhoneNumber(contact.phone)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid contact phone number'
                });
            }

            // Send contact message
            const result = await messageService.sendContactMessage(sessionId, recipients, contact, options);

            logWithSession('info', 'Contact message sent via API', sessionId, {
                to: recipients,
                contactName: contact.name,
                success: result.success
            });

            res.json({
                success: result.success,
                message: 'Contact message sent',
                data: result.results
            });

        } catch (error) {
            logger.error('Error in sendContact:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Send reaction to message
     * POST /api/message/send-reaction
     */
    async sendReaction(req, res) {
        try {
            const { sessionId, messageKey, emoji } = req.body;

            // Validasi input
            if (!sessionId || !messageKey || !emoji) {
                return res.status(400).json({
                    success: false,
                    error: 'sessionId, messageKey, and emoji are required'
                });
            }

            // Validasi messageKey
            if (!messageKey.id || !messageKey.remoteJid) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid messageKey format'
                });
            }

            // Cek session
            if (!sessionManager.hasSession(sessionId)) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            if (!sessionManager.isSessionConnected(sessionId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Session not connected'
                });
            }

            // Send reaction
            const result = await messageService.sendReaction(sessionId, messageKey, emoji);

            logWithSession('info', 'Reaction sent via API', sessionId, {
                messageId: messageKey.id,
                emoji: emoji
            });

            res.json({
                success: result.success,
                message: 'Reaction sent',
                data: result
            });

        } catch (error) {
            logger.error('Error in sendReaction:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Forward message
     * POST /api/message/forward
     */
    async forwardMessage(req, res) {
        try {
            const { sessionId, to, message } = req.body;

            // Validasi input
            if (!sessionId || !to || !message) {
                return res.status(400).json({
                    success: false,
                    error: 'sessionId, to, and message are required'
                });
            }

            // Cek session
            if (!sessionManager.hasSession(sessionId)) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            if (!sessionManager.isSessionConnected(sessionId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Session not connected'
                });
            }

            // Validasi nomor telepon
            const recipients = Array.isArray(to) ? to : to.split(',').map(phone => phone.trim());
            const invalidNumbers = recipients.filter(phone => !isValidPhoneNumber(phone));

            if (invalidNumbers.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid phone numbers',
                    invalidNumbers: invalidNumbers
                });
            }

            // Forward message
            const result = await messageService.forwardMessage(sessionId, recipients, message);

            logWithSession('info', 'Message forwarded via API', sessionId, {
                to: recipients,
                originalMessageId: message.key?.id,
                success: result.success
            });

            res.json({
                success: result.success,
                message: 'Message forwarded',
                data: result.results
            });

        } catch (error) {
            logger.error('Error in forwardMessage:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Delete message
     * POST /api/message/delete
     */
    async deleteMessage(req, res) {
        try {
            const { sessionId, messageKey, forEveryone = false } = req.body;

            // Validasi input
            if (!sessionId || !messageKey) {
                return res.status(400).json({
                    success: false,
                    error: 'sessionId and messageKey are required'
                });
            }

            // Validasi messageKey
            if (!messageKey.id || !messageKey.remoteJid) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid messageKey format'
                });
            }

            // Cek session
            if (!sessionManager.hasSession(sessionId)) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            if (!sessionManager.isSessionConnected(sessionId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Session not connected'
                });
            }

            // Delete message
            const result = await messageService.deleteMessage(sessionId, messageKey, forEveryone);

            logWithSession('info', 'Message deleted via API', sessionId, {
                messageId: messageKey.id,
                forEveryone: forEveryone
            });

            res.json({
                success: result.success,
                message: 'Message deleted',
                data: result
            });

        } catch (error) {
            logger.error('Error in deleteMessage:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Edit message
     * POST /api/message/edit
     */
    async editMessage(req, res) {
        try {
            const { sessionId, messageKey, newText } = req.body;

            // Validasi input
            if (!sessionId || !messageKey || !newText) {
                return res.status(400).json({
                    success: false,
                    error: 'sessionId, messageKey, and newText are required'
                });
            }

            // Validasi messageKey
            if (!messageKey.id || !messageKey.remoteJid) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid messageKey format'
                });
            }

            // Cek session
            if (!sessionManager.hasSession(sessionId)) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            if (!sessionManager.isSessionConnected(sessionId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Session not connected'
                });
            }

            // Edit message
            const result = await messageService.editMessage(sessionId, messageKey, newText);

            logWithSession('info', 'Message edited via API', sessionId, {
                originalMessageId: messageKey.id,
                newText: newText
            });

            res.json({
                success: result.success,
                message: 'Message edited',
                data: result
            });

        } catch (error) {
            logger.error('Error in editMessage:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Download media from message
     * POST /api/message/download-media
     */
    async downloadMedia(req, res) {
        try {
            const { sessionId, message, saveToFile = false } = req.body;

            // Validasi input
            if (!sessionId || !message) {
                return res.status(400).json({
                    success: false,
                    error: 'sessionId and message are required'
                });
            }

            // Cek session
            if (!sessionManager.hasSession(sessionId)) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            if (!sessionManager.isSessionConnected(sessionId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Session not connected'
                });
            }

            // Download media
            const uploadDir = saveToFile ? './data/uploads' : null;
            const result = await messageService.downloadMedia(sessionId, message, uploadDir);

            logWithSession('info', 'Media downloaded via API', sessionId, {
                messageId: message.key?.id,
                savedToFile: saveToFile,
                size: result.size
            });

            if (saveToFile && result.filePath) {
                res.json({
                    success: result.success,
                    message: 'Media downloaded and saved',
                    data: {
                        fileName: result.fileName,
                        filePath: result.filePath,
                        size: result.size
                    }
                });
            } else {
                // Return buffer sebagai base64
                res.json({
                    success: result.success,
                    message: 'Media downloaded',
                    data: {
                        buffer: result.buffer.toString('base64'),
                        size: result.size
                    }
                });
            }

        } catch (error) {
            logger.error('Error in downloadMedia:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Get message history
     * GET /api/message/history/:sessionId/:jid
     */
    async getMessageHistory(req, res) {
        try {
            const { sessionId, jid } = req.params;
            const { limit = 50, before } = req.query;

            // Cek session
            if (!sessionManager.hasSession(sessionId)) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            // Get store
            const whatsappService = require('../services/whatsappService');
            const store = whatsappService.getStore(sessionId);

            if (!store) {
                return res.status(400).json({
                    success: false,
                    error: 'Store not available'
                });
            }

            // Get messages from store
            const messages = store.messages[jid] || [];

            // Apply filters
            let filteredMessages = messages;

            if (before) {
                filteredMessages = messages.filter(msg =>
                    msg.messageTimestamp < parseInt(before)
                );
            }

            // Sort by timestamp (newest first) and limit
            filteredMessages = filteredMessages
                .sort((a, b) => b.messageTimestamp - a.messageTimestamp)
                .slice(0, parseInt(limit));

            res.json({
                success: true,
                message: 'Message history retrieved',
                data: {
                    jid: jid,
                    messages: filteredMessages,
                    count: filteredMessages.length,
                    hasMore: messages.length > filteredMessages.length
                }
            });

        } catch (error) {
            logger.error('Error in getMessageHistory:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
}

module.exports = new MessageController();