const {
    generateWAMessageFromContent,
    proto,
    getDevice,
    prepareWAMessageMedia,
    downloadMediaMessage
} = require('@whiskeysockets/baileys');

const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

const sessionManager = require('./sessionManager');
const whatsappService = require('./whatsappService');
const { logWithSession, logWhatsappEvent } = require('../utils/logger');
const {
    formatToWhatsAppId,
    formatMultipleToWhatsAppId,
    isValidPhoneNumber,
    extractPhoneFromJid
} = require('../utils/phoneFormatter');

class MessageService {
    constructor() {
        this.messageQueue = new Map(); // Queue untuk delay pengiriman
        this.setupMessageQueue();
    }

    /**
     * Setup message queue processor
     */
    setupMessageQueue() {
        setInterval(() => {
            this.processMessageQueue();
        }, 1000);
    }

    /**
     * Send text message
     * @param {string} sessionId - ID session
     * @param {string|Array} to - Nomor tujuan atau array nomor
     * @param {string} text - Teks pesan
     * @param {Object} options - Opsi tambahan
     */
    async sendTextMessage(sessionId, to, text, options = {}) {
        try {
            const sock = sessionManager.getSession(sessionId);
            if (!sock) {
                throw new Error('Session not connected');
            }

            const config = sessionManager.getSessionConfig(sessionId);
            const recipients = Array.isArray(to) ? to : [to];
            const results = [];

            for (const recipient of recipients) {
                try {
                    const jid = formatToWhatsAppId(recipient, config.countryCode);

                    if (!jid) {
                        results.push({
                            to: recipient,
                            success: false,
                            error: 'Invalid phone number'
                        });
                        continue;
                    }

                    // Check number if enabled
                    if (config.checkNumber) {
                        const numberCheck = await whatsappService.checkNumber(sessionId, recipient);
                        if (!numberCheck.exists) {
                            results.push({
                                to: recipient,
                                success: false,
                                error: 'Number not registered on WhatsApp'
                            });
                            continue;
                        }
                    }

                    // Show typing if enabled
                    if (config.showTyping) {
                        await sock.sendPresenceUpdate('composing', jid);
                        await this.delay(config.typingDelay);
                    }

                    // Prepare message
                    const messageOptions = {
                        text: text
                    };

                    // Add quoted message if provided
                    if (options.quoted) {
                        messageOptions.quoted = options.quoted;
                    }

                    // Add mentions if provided
                    if (options.mentions && options.mentions.length > 0) {
                        messageOptions.mentions = options.mentions.map(mention =>
                            formatToWhatsAppId(mention, config.countryCode)
                        );
                    }

                    // Send message
                    const sentMessage = await sock.sendMessage(jid, messageOptions);

                    // Stop typing
                    if (config.showTyping) {
                        await sock.sendPresenceUpdate('paused', jid);
                        await this.delay(config.pauseDelay);
                    }

                    results.push({
                        to: recipient,
                        success: true,
                        messageId: sentMessage.key.id,
                        timestamp: sentMessage.messageTimestamp
                    });

                    logWhatsappEvent('message_sent', sessionId, {
                        to: jid,
                        type: 'text',
                        messageId: sentMessage.key.id
                    });

                    // Delay before next message
                    if (recipients.length > 1) {
                        await this.delay(config.messageDelay);
                    }

                } catch (error) {
                    results.push({
                        to: recipient,
                        success: false,
                        error: error.message
                    });

                    logWithSession('error', 'Error sending text message', sessionId, {
                        to: recipient,
                        error: error.message
                    });
                }
            }

            return {
                success: results.every(r => r.success),
                results: results
            };

        } catch (error) {
            logWithSession('error', 'Error in sendTextMessage', sessionId, { error: error.message });
            throw error;
        }
    }

    /**
     * Send media message
     * @param {string} sessionId - ID session
     * @param {string|Array} to - Nomor tujuan
     * @param {Buffer|string} media - Media buffer atau path file
     * @param {string} type - Type media (image, video, audio, document)
     * @param {Object} options - Opsi tambahan
     */
    async sendMediaMessage(sessionId, to, media, type, options = {}) {
        try {
            const sock = sessionManager.getSession(sessionId);
            if (!sock) {
                throw new Error('Session not connected');
            }

            const config = sessionManager.getSessionConfig(sessionId);
            const recipients = Array.isArray(to) ? to : [to];
            const results = [];

            // Prepare media
            let mediaBuffer;
            let fileName = options.fileName;
            let mimeType = options.mimeType;

            if (typeof media === 'string') {
                // Media adalah path file
                if (!fs.existsSync(media)) {
                    throw new Error('Media file not found');
                }
                mediaBuffer = fs.readFileSync(media);
                fileName = fileName || path.basename(media);
                mimeType = mimeType || mime.lookup(media) || 'application/octet-stream';
            } else {
                // Media adalah buffer
                mediaBuffer = media;
                mimeType = mimeType || 'application/octet-stream';
            }

            for (const recipient of recipients) {
                try {
                    const jid = formatToWhatsAppId(recipient, config.countryCode);

                    if (!jid) {
                        results.push({
                            to: recipient,
                            success: false,
                            error: 'Invalid phone number'
                        });
                        continue;
                    }

                    // Check number if enabled
                    if (config.checkNumber) {
                        const numberCheck = await whatsappService.checkNumber(sessionId, recipient);
                        if (!numberCheck.exists) {
                            results.push({
                                to: recipient,
                                success: false,
                                error: 'Number not registered on WhatsApp'
                            });
                            continue;
                        }
                    }

                    // Show typing if enabled
                    if (config.showTyping) {
                        await sock.sendPresenceUpdate('composing', jid);
                        await this.delay(config.typingDelay);
                    }

                    // Prepare message based on type
                    let messageContent;

                    switch (type.toLowerCase()) {
                        case 'image':
                            messageContent = {
                                image: mediaBuffer,
                                caption: options.caption || '',
                                fileName: fileName,
                                mimetype: mimeType
                            };
                            break;

                        case 'video':
                            messageContent = {
                                video: mediaBuffer,
                                caption: options.caption || '',
                                fileName: fileName,
                                mimetype: mimeType,
                                gifPlayback: options.gif || false
                            };
                            break;

                        case 'audio':
                            messageContent = {
                                audio: mediaBuffer,
                                fileName: fileName,
                                mimetype: mimeType,
                                ptt: options.ptt || false // voice note
                            };
                            break;

                        case 'document':
                            messageContent = {
                                document: mediaBuffer,
                                fileName: fileName || 'document',
                                mimetype: mimeType,
                                caption: options.caption || ''
                            };
                            break;

                        default:
                            throw new Error(`Unsupported media type: ${type}`);
                    }

                    // Add quoted message if provided
                    if (options.quoted) {
                        messageContent.quoted = options.quoted;
                    }

                    // Send media message
                    const sentMessage = await sock.sendMessage(jid, messageContent);

                    // Stop typing
                    if (config.showTyping) {
                        await sock.sendPresenceUpdate('paused', jid);
                        await this.delay(config.pauseDelay);
                    }

                    results.push({
                        to: recipient,
                        success: true,
                        messageId: sentMessage.key.id,
                        timestamp: sentMessage.messageTimestamp
                    });

                    logWhatsappEvent('message_sent', sessionId, {
                        to: jid,
                        type: type,
                        messageId: sentMessage.key.id,
                        fileName: fileName
                    });

                    // Delay before next message
                    if (recipients.length > 1) {
                        await this.delay(config.messageDelay);
                    }

                } catch (error) {
                    results.push({
                        to: recipient,
                        success: false,
                        error: error.message
                    });

                    logWithSession('error', 'Error sending media message', sessionId, {
                        to: recipient,
                        type: type,
                        error: error.message
                    });
                }
            }

            return {
                success: results.every(r => r.success),
                results: results
            };

        } catch (error) {
            logWithSession('error', 'Error in sendMediaMessage', sessionId, { error: error.message });
            throw error;
        }
    }

    /**
     * Send location message
     * @param {string} sessionId - ID session
     * @param {string|Array} to - Nomor tujuan
     * @param {number} latitude - Latitude
     * @param {number} longitude - Longitude
     * @param {Object} options - Opsi tambahan
     */
    async sendLocationMessage(sessionId, to, latitude, longitude, options = {}) {
        try {
            const sock = sessionManager.getSession(sessionId);
            if (!sock) {
                throw new Error('Session not connected');
            }

            const config = sessionManager.getSessionConfig(sessionId);
            const recipients = Array.isArray(to) ? to : [to];
            const results = [];

            for (const recipient of recipients) {
                try {
                    const jid = formatToWhatsAppId(recipient, config.countryCode);

                    if (!jid) {
                        results.push({
                            to: recipient,
                            success: false,
                            error: 'Invalid phone number'
                        });
                        continue;
                    }

                    // Show typing if enabled
                    if (config.showTyping) {
                        await sock.sendPresenceUpdate('composing', jid);
                        await this.delay(config.typingDelay);
                    }

                    const messageContent = {
                        location: {
                            degreesLatitude: latitude,
                            degreesLongitude: longitude,
                            name: options.name || '',
                            address: options.address || ''
                        }
                    };

                    // Add quoted message if provided
                    if (options.quoted) {
                        messageContent.quoted = options.quoted;
                    }

                    const sentMessage = await sock.sendMessage(jid, messageContent);

                    // Stop typing
                    if (config.showTyping) {
                        await sock.sendPresenceUpdate('paused', jid);
                        await this.delay(config.pauseDelay);
                    }

                    results.push({
                        to: recipient,
                        success: true,
                        messageId: sentMessage.key.id,
                        timestamp: sentMessage.messageTimestamp
                    });

                    logWhatsappEvent('message_sent', sessionId, {
                        to: jid,
                        type: 'location',
                        messageId: sentMessage.key.id
                    });

                    // Delay before next message
                    if (recipients.length > 1) {
                        await this.delay(config.messageDelay);
                    }

                } catch (error) {
                    results.push({
                        to: recipient,
                        success: false,
                        error: error.message
                    });
                }
            }

            return {
                success: results.every(r => r.success),
                results: results
            };

        } catch (error) {
            logWithSession('error', 'Error in sendLocationMessage', sessionId, { error: error.message });
            throw error;
        }
    }

    /**
     * Send contact message
     * @param {string} sessionId - ID session
     * @param {string|Array} to - Nomor tujuan
     * @param {Object} contact - Data kontak
     * @param {Object} options - Opsi tambahan
     */
    async sendContactMessage(sessionId, to, contact, options = {}) {
        try {
            const sock = sessionManager.getSession(sessionId);
            if (!sock) {
                throw new Error('Session not connected');
            }

            const config = sessionManager.getSessionConfig(sessionId);
            const recipients = Array.isArray(to) ? to : [to];
            const results = [];

            for (const recipient of recipients) {
                try {
                    const jid = formatToWhatsAppId(recipient, config.countryCode);

                    if (!jid) {
                        results.push({
                            to: recipient,
                            success: false,
                            error: 'Invalid phone number'
                        });
                        continue;
                    }

                    // Show typing if enabled
                    if (config.showTyping) {
                        await sock.sendPresenceUpdate('composing', jid);
                        await this.delay(config.typingDelay);
                    }

                    const vcard = `BEGIN:VCARD
VERSION:3.0
FN:${contact.name || 'Unknown'}
ORG:${contact.organization || ''}
TEL;type=CELL;type=VOICE;waid=${contact.phone}:+${contact.phone}
END:VCARD`;

                    const messageContent = {
                        contacts: {
                            displayName: contact.name || 'Contact',
                            contacts: [{
                                vcard: vcard
                            }]
                        }
                    };

                    // Add quoted message if provided
                    if (options.quoted) {
                        messageContent.quoted = options.quoted;
                    }

                    const sentMessage = await sock.sendMessage(jid, messageContent);

                    // Stop typing
                    if (config.showTyping) {
                        await sock.sendPresenceUpdate('paused', jid);
                        await this.delay(config.pauseDelay);
                    }

                    results.push({
                        to: recipient,
                        success: true,
                        messageId: sentMessage.key.id,
                        timestamp: sentMessage.messageTimestamp
                    });

                    logWhatsappEvent('message_sent', sessionId, {
                        to: jid,
                        type: 'contact',
                        messageId: sentMessage.key.id
                    });

                    // Delay before next message
                    if (recipients.length > 1) {
                        await this.delay(config.messageDelay);
                    }

                } catch (error) {
                    results.push({
                        to: recipient,
                        success: false,
                        error: error.message
                    });
                }
            }

            return {
                success: results.every(r => r.success),
                results: results
            };

        } catch (error) {
            logWithSession('error', 'Error in sendContactMessage', sessionId, { error: error.message });
            throw error;
        }
    }

    /**
     * Send reaction to message
     * @param {string} sessionId - ID session
     * @param {Object} messageKey - Key dari message yang akan direact
     * @param {string} emoji - Emoji untuk reaction
     */
    async sendReaction(sessionId, messageKey, emoji) {
        try {
            const sock = sessionManager.getSession(sessionId);
            if (!sock) {
                throw new Error('Session not connected');
            }

            const reactionMessage = {
                react: {
                    text: emoji,
                    key: messageKey
                }
            };

            const sentMessage = await sock.sendMessage(messageKey.remoteJid, reactionMessage);

            logWhatsappEvent('reaction_sent', sessionId, {
                to: messageKey.remoteJid,
                messageId: messageKey.id,
                emoji: emoji
            });

            return {
                success: true,
                messageId: sentMessage.key.id,
                timestamp: sentMessage.messageTimestamp
            };

        } catch (error) {
            logWithSession('error', 'Error sending reaction', sessionId, { error: error.message });
            throw error;
        }
    }

    /**
     * Forward message
     * @param {string} sessionId - ID session
     * @param {string|Array} to - Nomor tujuan
     * @param {Object} message - Message yang akan diforward
     */
    async forwardMessage(sessionId, to, message) {
        try {
            const sock = sessionManager.getSession(sessionId);
            if (!sock) {
                throw new Error('Session not connected');
            }

            const config = sessionManager.getSessionConfig(sessionId);
            const recipients = Array.isArray(to) ? to : [to];
            const results = [];

            for (const recipient of recipients) {
                try {
                    const jid = formatToWhatsAppId(recipient, config.countryCode);

                    if (!jid) {
                        results.push({
                            to: recipient,
                            success: false,
                            error: 'Invalid phone number'
                        });
                        continue;
                    }

                    // Show typing if enabled
                    if (config.showTyping) {
                        await sock.sendPresenceUpdate('composing', jid);
                        await this.delay(config.typingDelay);
                    }

                    const forwardMessage = generateWAMessageFromContent(jid, message.message, {
                        userJid: sock.user.id
                    });

                    const sentMessage = await sock.relayMessage(jid, forwardMessage.message, {
                        messageId: forwardMessage.key.id
                    });

                    // Stop typing
                    if (config.showTyping) {
                        await sock.sendPresenceUpdate('paused', jid);
                        await this.delay(config.pauseDelay);
                    }

                    results.push({
                        to: recipient,
                        success: true,
                        messageId: sentMessage.key.id,
                        timestamp: sentMessage.messageTimestamp
                    });

                    logWhatsappEvent('message_forwarded', sessionId, {
                        to: jid,
                        originalMessageId: message.key.id,
                        newMessageId: sentMessage.key.id
                    });

                    // Delay before next message
                    if (recipients.length > 1) {
                        await this.delay(config.messageDelay);
                    }

                } catch (error) {
                    results.push({
                        to: recipient,
                        success: false,
                        error: error.message
                    });
                }
            }

            return {
                success: results.every(r => r.success),
                results: results
            };

        } catch (error) {
            logWithSession('error', 'Error in forwardMessage', sessionId, { error: error.message });
            throw error;
        }
    }

    /**
     * Delete message
     * @param {string} sessionId - ID session
     * @param {Object} messageKey - Key dari message yang akan dihapus
     * @param {boolean} forEveryone - Hapus untuk semua atau hanya untuk diri sendiri
     */
    async deleteMessage(sessionId, messageKey, forEveryone = false) {
        try {
            const sock = sessionManager.getSession(sessionId);
            if (!sock) {
                throw new Error('Session not connected');
            }

            if (forEveryone) {
                const deleteMessage = {
                    delete: messageKey
                };

                await sock.sendMessage(messageKey.remoteJid, deleteMessage);
            } else {
                await sock.chatModify({ delete: true, lastMessages: [{ key: messageKey, messageTimestamp: messageKey.messageTimestamp }] }, messageKey.remoteJid);
            }

            logWhatsappEvent('message_deleted', sessionId, {
                messageId: messageKey.id,
                forEveryone: forEveryone
            });

            return {
                success: true,
                messageId: messageKey.id,
                deletedForEveryone: forEveryone
            };

        } catch (error) {
            logWithSession('error', 'Error deleting message', sessionId, { error: error.message });
            throw error;
        }
    }

    /**
     * Edit message
     * @param {string} sessionId - ID session
     * @param {Object} messageKey - Key dari message yang akan diedit
     * @param {string} newText - Teks baru
     */
    async editMessage(sessionId, messageKey, newText) {
        try {
            const sock = sessionManager.getSession(sessionId);
            if (!sock) {
                throw new Error('Session not connected');
            }

            const editMessage = {
                edit: messageKey,
                text: newText
            };

            const sentMessage = await sock.sendMessage(messageKey.remoteJid, editMessage);

            logWhatsappEvent('message_edited', sessionId, {
                originalMessageId: messageKey.id,
                newMessageId: sentMessage.key.id,
                newText: newText
            });

            return {
                success: true,
                messageId: sentMessage.key.id,
                timestamp: sentMessage.messageTimestamp
            };

        } catch (error) {
            logWithSession('error', 'Error editing message', sessionId, { error: error.message });
            throw error;
        }
    }

    /**
     * Download media from message
     * @param {string} sessionId - ID session
     * @param {Object} message - Message object
     * @param {string} saveDir - Directory untuk menyimpan file
     */
    async downloadMedia(sessionId, message, saveDir = null) {
        try {
            const sock = sessionManager.getSession(sessionId);
            if (!sock) {
                throw new Error('Session not connected');
            }

            const buffer = await downloadMediaMessage(message, 'buffer', {});

            if (saveDir) {
                const messageType = Object.keys(message.message)[0];
                const mediaInfo = message.message[messageType];
                const fileName = mediaInfo.fileName || `media_${Date.now()}`;
                const filePath = path.join(saveDir, fileName);

                fs.writeFileSync(filePath, buffer);

                return {
                    success: true,
                    buffer: buffer,
                    filePath: filePath,
                    fileName: fileName,
                    size: buffer.length
                };
            }

            return {
                success: true,
                buffer: buffer,
                size: buffer.length
            };

        } catch (error) {
            logWithSession('error', 'Error downloading media', sessionId, { error: error.message });
            throw error;
        }
    }

    /**
     * Process message queue
     */
    processMessageQueue() {
        // Implementation untuk process message queue jika diperlukan
        // Untuk future enhancement
    }

    /**
     * Delay utility
     * @param {number} ms - Milliseconds
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Singleton instance
const messageService = new MessageService();

module.exports = messageService;