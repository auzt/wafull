const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeInMemoryStore,
    jidNormalizedUser,
    areJidsSameUser,
    extractMessageContent,
    generateWAMessageFromContent,
    proto,
    getDevice
} = require('@whiskeysockets/baileys');

const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const QRCode = require('qrcode-terminal');
const { Boom } = require('@hapi/boom');

const sessionManager = require('./sessionManager');
const webhookService = require('./webhookService');
const { logger, logWithSession, logWhatsappEvent } = require('../utils/logger');
const { formatToWhatsAppId, isValidPhoneNumber, extractPhoneFromJid } = require('../utils/phoneFormatter');
const { defaultConfig } = require('../config/default');

class WhatsAppService {
    constructor() {
        this.stores = new Map(); // Store untuk setiap session
        this.reconnectAttempts = new Map(); // Track reconnect attempts
        this.setupGlobalErrorHandlers();
    }

    /**
     * Setup global error handlers
     */
    setupGlobalErrorHandlers() {
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught Exception:', error);
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
        });
    }

    /**
     * Buat koneksi WhatsApp baru
     * @param {string} sessionId - ID session
     * @param {Object} customConfig - Konfigurasi custom
     * @returns {Object} Socket instance
     */
    async createConnection(sessionId, customConfig = {}) {
        try {
            logWithSession('info', 'Creating new WhatsApp connection', sessionId);

            // Pastikan session sudah dibuat
            if (!sessionManager.hasSession(sessionId)) {
                sessionManager.createSession(sessionId, customConfig);
            } else {
                sessionManager.updateSessionConfig(sessionId, customConfig);
            }

            const sessionPath = sessionManager.getSessionPath(sessionId);
            const { version, isLatest } = await fetchLatestBaileysVersion();

            logWithSession('info', `Using WA v${version.join('.')}, isLatest: ${isLatest}`, sessionId);

            // Setup auth state
            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

            // Setup store untuk session
            const store = makeInMemoryStore({});
            store.readFromFile(path.join(sessionPath, 'store.json'));

            // Save store setiap 10 detik
            setInterval(() => {
                if (store) {
                    store.writeToFile(path.join(sessionPath, 'store.json'));
                }
            }, 10000);

            this.stores.set(sessionId, store);

            // Konfigurasi socket
            const socketConfig = {
                version,
                auth: state,
                printQRInTerminal: false,
                logger: require('pino')({ level: 'silent' }), // Disable baileys logging
                browser: ['WhatsApp API', 'Chrome', '10.15.7'],
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                markOnlineOnConnect: false,
                syncFullHistory: false,
                retryRequestDelayMs: 5000,
                maxMsgRetryCount: 3,
                connectTimeoutMs: 60000,
                generateHighQualityLinkPreview: true
            };

            const sock = makeWASocket(socketConfig);

            // Bind store ke socket
            store.bind(sock.ev);

            // Setup event handlers
            this.setupEventHandlers(sock, sessionId, saveCreds);

            // Set session instance
            sessionManager.setSession(sessionId, sock);
            sessionManager.setSessionState(sessionId, 'CONNECTING');

            return sock;

        } catch (error) {
            logWithSession('error', 'Error creating connection', sessionId, { error: error.message });
            sessionManager.setSessionState(sessionId, 'DISCONNECTED');
            throw error;
        }
    }

    /**
     * Setup event handlers untuk socket
     * @param {Object} sock - Socket instance
     * @param {string} sessionId - ID session
     * @param {Function} saveCreds - Function untuk save credentials
     */
    setupEventHandlers(sock, sessionId, saveCreds) {
        const config = sessionManager.getSessionConfig(sessionId);

        // Connection updates
        sock.ev.on('connection.update', async (update) => {
            await this.handleConnectionUpdate(update, sessionId, sock);
        });

        // Credentials update
        sock.ev.on('creds.update', saveCreds);

        // Messages
        sock.ev.on('messages.upsert', async (m) => {
            await this.handleIncomingMessages(m, sessionId, sock);
        });

        // Message updates (read, delivery, etc)
        sock.ev.on('messages.update', async (updates) => {
            await this.handleMessageUpdates(updates, sessionId);
        });

        // Presence updates
        sock.ev.on('presence.update', async (update) => {
            await this.handlePresenceUpdate(update, sessionId);
        });

        // Groups updates
        sock.ev.on('groups.update', async (updates) => {
            await this.handleGroupsUpdate(updates, sessionId);
        });

        // Group participants update
        sock.ev.on('group-participants.update', async (update) => {
            await this.handleGroupParticipantsUpdate(update, sessionId);
        });

        // Contacts update
        sock.ev.on('contacts.update', async (updates) => {
            await this.handleContactsUpdate(updates, sessionId);
        });

        // Chats update
        sock.ev.on('chats.update', async (updates) => {
            await this.handleChatsUpdate(updates, sessionId);
        });

        // Call events
        sock.ev.on('call', async (calls) => {
            await this.handleCallEvents(calls, sessionId);
        });

        logWithSession('info', 'Event handlers setup completed', sessionId);
    }

    /**
     * Handle connection updates
     */
    async handleConnectionUpdate(update, sessionId, sock) {
        const { connection, lastDisconnect, qr, receivedPendingNotifications } = update;

        if (qr) {
            logWithSession('info', 'QR Code generated', sessionId);
            sessionManager.setSessionState(sessionId, 'QR_GENERATED');

            // Generate QR code
            await this.generateQRCode(qr, sessionId);

            // Send QR to webhook
            await webhookService.sendWebhook(sessionId, {
                event: 'qr_generated',
                qr: qr,
                timestamp: new Date().toISOString()
            });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
            const reasonText = this.getDisconnectReason(reason);

            logWithSession('warn', `Connection closed: ${reasonText}`, sessionId, {
                shouldReconnect,
                reason
            });

            if (reason === DisconnectReason.badSession) {
                logWithSession('error', 'Bad session - deleting session files', sessionId);
                sessionManager.setSessionState(sessionId, 'BANNED');
                await this.deleteSessionFiles(sessionId);
            } else if (reason === DisconnectReason.restartRequired) {
                logWithSession('info', 'Restart required', sessionId);
                sessionManager.setSessionState(sessionId, 'RESTART_REQUIRED');
            } else if (shouldReconnect) {
                await this.handleReconnection(sessionId);
            } else {
                sessionManager.setSessionState(sessionId, 'DISCONNECTED');
            }

            // Send disconnect webhook
            await webhookService.sendWebhook(sessionId, {
                event: 'connection_closed',
                reason: reasonText,
                shouldReconnect,
                timestamp: new Date().toISOString()
            });

        } else if (connection === 'open') {
            logWithSession('info', 'Connection opened successfully', sessionId);
            sessionManager.setSessionState(sessionId, 'CONNECTED');
            this.reconnectAttempts.set(sessionId, 0);

            // Get user info
            const user = sock.user;
            logWithSession('info', 'Connected as', sessionId, {
                jid: user.id,
                name: user.name
            });

            // Save session stats
            sessionManager.saveSessionStats(sessionId, {
                connectedAt: new Date().toISOString(),
                user: user
            });

            // Send connected webhook
            await webhookService.sendWebhook(sessionId, {
                event: 'connected',
                user: user,
                timestamp: new Date().toISOString()
            });

        } else if (connection === 'connecting') {
            logWithSession('info', 'Connecting to WhatsApp...', sessionId);
            sessionManager.setSessionState(sessionId, 'CONNECTING');
        }

        if (receivedPendingNotifications) {
            logWithSession('info', 'Received pending notifications', sessionId);
        }
    }

    /**
     * Handle incoming messages
     */
    async handleIncomingMessages(m, sessionId, sock) {
        const config = sessionManager.getSessionConfig(sessionId);

        for (const message of m.messages) {
            if (!message.key.fromMe && config.autoRead) {
                // Auto read message
                setTimeout(async () => {
                    try {
                        await sock.readMessages([message.key]);
                        logWhatsappEvent('message_read', sessionId, { messageId: message.key.id });
                    } catch (error) {
                        logWithSession('error', 'Error reading message', sessionId, { error: error.message });
                    }
                }, config.readMessageDelay);
            }

            // Process message for webhook
            const processedMessage = await this.processIncomingMessage(message, sessionId);

            // Send to webhook with delay
            setTimeout(async () => {
                await webhookService.sendWebhook(sessionId, {
                    event: 'message_received',
                    message: processedMessage,
                    timestamp: new Date().toISOString()
                });
            }, config.webhookDelay);

            logWhatsappEvent('message_received', sessionId, {
                from: message.key.remoteJid,
                messageType: Object.keys(message.message || {})[0]
            });
        }
    }

    /**
     * Process incoming message
     */
    async processIncomingMessage(message, sessionId) {
        const sock = sessionManager.getSession(sessionId);

        return {
            key: message.key,
            messageTimestamp: message.messageTimestamp,
            pushName: message.pushName,
            message: message.message,
            participant: message.participant,
            messageStubType: message.messageStubType,
            messageStubParameters: message.messageStubParameters
        };
    }

    /**
     * Handle message updates
     */
    async handleMessageUpdates(updates, sessionId) {
        for (const update of updates) {
            logWhatsappEvent('message_updated', sessionId, {
                messageId: update.key.id,
                update: update.update
            });

            // Send to webhook
            await webhookService.sendWebhook(sessionId, {
                event: 'message_updated',
                update: update,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Handle presence updates
     */
    async handlePresenceUpdate(update, sessionId) {
        logWhatsappEvent('presence_update', sessionId, update);

        await webhookService.sendWebhook(sessionId, {
            event: 'presence_update',
            update: update,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Handle groups updates
     */
    async handleGroupsUpdate(updates, sessionId) {
        for (const update of updates) {
            logWhatsappEvent('group_updated', sessionId, { groupId: update.id });

            await webhookService.sendWebhook(sessionId, {
                event: 'group_updated',
                update: update,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Handle group participants updates
     */
    async handleGroupParticipantsUpdate(update, sessionId) {
        logWhatsappEvent('group_participants_update', sessionId, {
            groupId: update.id,
            action: update.action,
            participants: update.participants
        });

        await webhookService.sendWebhook(sessionId, {
            event: 'group_participants_update',
            update: update,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Handle contacts updates
     */
    async handleContactsUpdate(updates, sessionId) {
        for (const update of updates) {
            logWhatsappEvent('contact_updated', sessionId, { contactId: update.id });
        }

        await webhookService.sendWebhook(sessionId, {
            event: 'contacts_update',
            updates: updates,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Handle chats updates
     */
    async handleChatsUpdate(updates, sessionId) {
        for (const update of updates) {
            logWhatsappEvent('chat_updated', sessionId, { chatId: update.id });
        }

        await webhookService.sendWebhook(sessionId, {
            event: 'chats_update',
            updates: updates,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Handle call events
     */
    async handleCallEvents(calls, sessionId) {
        const sock = sessionManager.getSession(sessionId);

        for (const call of calls) {
            logWhatsappEvent('call_received', sessionId, {
                callId: call.id,
                from: call.from,
                status: call.status
            });

            // Auto reject calls (default behavior)
            if (call.status === 'offer') {
                try {
                    await sock.rejectCall(call.id, call.from);
                    logWhatsappEvent('call_rejected', sessionId, { callId: call.id });
                } catch (error) {
                    logWithSession('error', 'Error rejecting call', sessionId, { error: error.message });
                }
            }

            await webhookService.sendWebhook(sessionId, {
                event: 'call_received',
                call: call,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Handle reconnection
     */
    async handleReconnection(sessionId) {
        const maxAttempts = defaultConfig.session.maxReconnectAttempts;
        const currentAttempts = this.reconnectAttempts.get(sessionId) || 0;

        if (currentAttempts >= maxAttempts) {
            logWithSession('error', `Max reconnection attempts reached (${maxAttempts})`, sessionId);
            sessionManager.setSessionState(sessionId, 'BANNED');
            return;
        }

        this.reconnectAttempts.set(sessionId, currentAttempts + 1);

        const delay = defaultConfig.session.reconnectInterval * (currentAttempts + 1);
        logWithSession('info', `Reconnecting in ${delay}ms (attempt ${currentAttempts + 1}/${maxAttempts})`, sessionId);

        setTimeout(async () => {
            try {
                await this.createConnection(sessionId);
            } catch (error) {
                logWithSession('error', 'Reconnection failed', sessionId, { error: error.message });
            }
        }, delay);
    }

    /**
     * Generate QR Code
     */
    async generateQRCode(qr, sessionId) {
        try {
            // Generate QR untuk terminal
            QRCode.generate(qr, { small: true });

            // Generate QR sebagai base64
            const qrBase64 = await qrcode.toDataURL(qr);

            // Simpan QR ke file
            const qrPath = path.join(sessionManager.getSessionPath(sessionId), 'qr.png');
            const qrBuffer = Buffer.from(qrBase64.split(',')[1], 'base64');
            fs.writeFileSync(qrPath, qrBuffer);

            logWithSession('info', 'QR Code generated and saved', sessionId, { qrPath });

            return qrBase64;
        } catch (error) {
            logWithSession('error', 'Error generating QR code', sessionId, { error: error.message });
            throw error;
        }
    }

    /**
     * Get disconnect reason text
     */
    getDisconnectReason(reason) {
        const reasons = {
            [DisconnectReason.badSession]: 'Bad Session',
            [DisconnectReason.connectionClosed]: 'Connection Closed',
            [DisconnectReason.connectionLost]: 'Connection Lost',
            [DisconnectReason.connectionReplaced]: 'Connection Replaced',
            [DisconnectReason.loggedOut]: 'Logged Out',
            [DisconnectReason.restartRequired]: 'Restart Required',
            [DisconnectReason.timedOut]: 'Timed Out'
        };

        return reasons[reason] || `Unknown (${reason})`;
    }

    /**
     * Delete session files
     */
    async deleteSessionFiles(sessionId) {
        try {
            const sessionPath = sessionManager.getSessionPath(sessionId);
            if (fs.existsSync(sessionPath)) {
                fs.rmSync(sessionPath, { recursive: true, force: true });
                logWithSession('info', 'Session files deleted', sessionId);
            }
        } catch (error) {
            logWithSession('error', 'Error deleting session files', sessionId, { error: error.message });
        }
    }

    /**
     * Get session store
     */
    getStore(sessionId) {
        return this.stores.get(sessionId);
    }

    /**
     * Check if number exists on WhatsApp
     */
    async checkNumber(sessionId, phone) {
        try {
            const sock = sessionManager.getSession(sessionId);
            if (!sock) {
                throw new Error('Session not connected');
            }

            const jid = formatToWhatsAppId(phone);
            const [result] = await sock.onWhatsApp(jid);

            return {
                exists: !!result?.exists,
                jid: result?.jid || jid,
                businessAccount: result?.isBusiness || false
            };
        } catch (error) {
            logWithSession('error', 'Error checking number', sessionId, { phone, error: error.message });
            throw error;
        }
    }
}

// Singleton instance
const whatsappService = new WhatsAppService();

module.exports = whatsappService;