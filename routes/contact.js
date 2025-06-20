const express = require('express');
const router = express.Router();

// Import middleware
const {
    sanitizeInput,
    sessionRateLimit,
    validateRequired
} = require('../middleware/auth');

const {
    validateSessionExists,
    validateSessionConnected
} = require('../middleware/validation');

const { formatToWhatsAppId } = require('../utils/phoneFormatter');
const { logWithSession } = require('../utils/logger');

/**
 * Apply middleware untuk semua contact routes
 */
router.use(sanitizeInput);
router.use(sessionRateLimit);

/**
 * GET /api/contact/list/:sessionId
 * Get contact list
 */
router.get('/list/:sessionId',
    async (req, res) => {
        try {
            const { sessionId } = req.params;
            const { limit = 100, offset = 0 } = req.query;
            const sessionManager = require('../services/sessionManager');

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

            const whatsappService = require('../services/whatsappService');
            const store = whatsappService.getStore(sessionId);

            if (!store) {
                return res.status(400).json({
                    success: false,
                    error: 'Store not available'
                });
            }

            // Get contacts from store
            const contacts = Object.values(store.contacts || {});

            // Apply pagination
            const startIndex = parseInt(offset);
            const endIndex = startIndex + parseInt(limit);
            const paginatedContacts = contacts.slice(startIndex, endIndex);

            res.json({
                success: true,
                message: 'Contact list retrieved',
                data: {
                    contacts: paginatedContacts,
                    total: contacts.length,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    hasMore: endIndex < contacts.length
                }
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
 * GET /api/contact/profile/:sessionId/:jid
 * Get contact profile information
 */
router.get('/profile/:sessionId/:jid',
    async (req, res) => {
        try {
            const { sessionId, jid } = req.params;
            const sessionManager = require('../services/sessionManager');

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

            const sock = sessionManager.getSession(sessionId);

            // Get profile picture
            let profilePicture = null;
            try {
                profilePicture = await sock.profilePictureUrl(jid, 'image');
            } catch (error) {
                // Profile picture might not be available
            }

            // Get status
            let status = null;
            try {
                const statusResult = await sock.fetchStatus(jid);
                status = statusResult?.status || null;
            } catch (error) {
                // Status might not be available
            }

            // Get business profile if applicable
            let businessProfile = null;
            try {
                businessProfile = await sock.getBusinessProfile(jid);
            } catch (error) {
                // Not a business account
            }

            const profileData = {
                jid: jid,
                profilePicture: profilePicture,
                status: status,
                businessProfile: businessProfile
            };

            logWithSession('info', 'Contact profile retrieved', sessionId, {
                jid: jid
            });

            res.json({
                success: true,
                message: 'Contact profile retrieved',
                data: profileData
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
 * POST /api/contact/block
 * Block contact
 */
router.post('/block',
    validateRequired(['sessionId', 'jid']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, jid } = req.body;
            const sessionManager = require('../services/sessionManager');
            const config = sessionManager.getSessionConfig(sessionId);

            const sock = sessionManager.getSession(sessionId);

            // Format JID if it's a phone number
            const targetJid = jid.includes('@') ? jid : formatToWhatsAppId(jid, config.countryCode);

            // Block contact
            await sock.updateBlockStatus(targetJid, 'block');

            logWithSession('info', 'Contact blocked', sessionId, {
                jid: targetJid
            });

            res.json({
                success: true,
                message: 'Contact blocked successfully',
                data: {
                    jid: targetJid,
                    blocked: true
                }
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
 * POST /api/contact/unblock
 * Unblock contact
 */
router.post('/unblock',
    validateRequired(['sessionId', 'jid']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, jid } = req.body;
            const sessionManager = require('../services/sessionManager');
            const config = sessionManager.getSessionConfig(sessionId);

            const sock = sessionManager.getSession(sessionId);

            // Format JID if it's a phone number
            const targetJid = jid.includes('@') ? jid : formatToWhatsAppId(jid, config.countryCode);

            // Unblock contact
            await sock.updateBlockStatus(targetJid, 'unblock');

            logWithSession('info', 'Contact unblocked', sessionId, {
                jid: targetJid
            });

            res.json({
                success: true,
                message: 'Contact unblocked successfully',
                data: {
                    jid: targetJid,
                    blocked: false
                }
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
 * GET /api/contact/blocked/:sessionId
 * Get blocked contacts list
 */
router.get('/blocked/:sessionId',
    async (req, res) => {
        try {
            const { sessionId } = req.params;
            const sessionManager = require('../services/sessionManager');

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

            const sock = sessionManager.getSession(sessionId);

            // Get blocked contacts
            const blockedContacts = await sock.fetchBlocklist();

            res.json({
                success: true,
                message: 'Blocked contacts retrieved',
                data: {
                    blockedContacts: blockedContacts,
                    total: blockedContacts.length
                }
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
 * POST /api/contact/presence
 * Get contact presence (online status)
 */
router.post('/presence',
    validateRequired(['sessionId', 'jid']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, jid } = req.body;
            const sessionManager = require('../services/sessionManager');
            const config = sessionManager.getSessionConfig(sessionId);

            const sock = sessionManager.getSession(sessionId);

            // Format JID if it's a phone number
            const targetJid = jid.includes('@') ? jid : formatToWhatsAppId(jid, config.countryCode);

            // Subscribe to presence updates
            await sock.presenceSubscribe(targetJid);

            // Get current presence from store
            const whatsappService = require('../services/whatsappService');
            const store = whatsappService.getStore(sessionId);
            const presence = store?.presences?.[targetJid] || null;

            res.json({
                success: true,
                message: 'Presence information retrieved',
                data: {
                    jid: targetJid,
                    presence: presence,
                    subscribed: true
                }
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
 * POST /api/contact/check-exists
 * Check if contact exists on WhatsApp
 */
router.post('/check-exists',
    validateRequired(['sessionId', 'phone']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, phone } = req.body;
            const whatsappService = require('../services/whatsappService');

            // Check if number exists
            const result = await whatsappService.checkNumber(sessionId, phone);

            logWithSession('info', 'Contact existence checked', sessionId, {
                phone: phone,
                exists: result.exists
            });

            res.json({
                success: true,
                message: 'Contact existence checked',
                data: result
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
 * GET /api/contact/chats/:sessionId
 * Get chat list
 */
router.get('/chats/:sessionId',
    async (req, res) => {
        try {
            const { sessionId } = req.params;
            const { limit = 50, offset = 0 } = req.query;
            const sessionManager = require('../services/sessionManager');

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

            const whatsappService = require('../services/whatsappService');
            const store = whatsappService.getStore(sessionId);

            if (!store) {
                return res.status(400).json({
                    success: false,
                    error: 'Store not available'
                });
            }

            // Get chats from store
            const chats = Object.values(store.chats || {});

            // Sort by last message timestamp
            chats.sort((a, b) => (b.conversationTimestamp || 0) - (a.conversationTimestamp || 0));

            // Apply pagination
            const startIndex = parseInt(offset);
            const endIndex = startIndex + parseInt(limit);
            const paginatedChats = chats.slice(startIndex, endIndex);

            res.json({
                success: true,
                message: 'Chat list retrieved',
                data: {
                    chats: paginatedChats,
                    total: chats.length,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    hasMore: endIndex < chats.length
                }
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
 * POST /api/contact/archive-chat
 * Archive/Unarchive chat
 */
router.post('/archive-chat',
    validateRequired(['sessionId', 'jid', 'archive']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, jid, archive } = req.body;
            const sessionManager = require('../services/sessionManager');
            const config = sessionManager.getSessionConfig(sessionId);

            const sock = sessionManager.getSession(sessionId);

            // Format JID if it's a phone number
            const targetJid = jid.includes('@') ? jid : formatToWhatsAppId(jid, config.countryCode);

            // Archive/unarchive chat
            await sock.chatModify({ archive: archive }, targetJid);

            logWithSession('info', `Chat ${archive ? 'archived' : 'unarchived'}`, sessionId, {
                jid: targetJid
            });

            res.json({
                success: true,
                message: `Chat ${archive ? 'archived' : 'unarchived'} successfully`,
                data: {
                    jid: targetJid,
                    archived: archive
                }
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
 * POST /api/contact/mark-read
 * Mark chat as read
 */
router.post('/mark-read',
    validateRequired(['sessionId', 'jid']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, jid } = req.body;
            const sessionManager = require('../services/sessionManager');
            const config = sessionManager.getSessionConfig(sessionId);

            const sock = sessionManager.getSession(sessionId);

            // Format JID if it's a phone number
            const targetJid = jid.includes('@') ? jid : formatToWhatsAppId(jid, config.countryCode);

            // Mark chat as read
            await sock.chatModify({ markRead: true }, targetJid);

            logWithSession('info', 'Chat marked as read', sessionId, {
                jid: targetJid
            });

            res.json({
                success: true,
                message: 'Chat marked as read successfully',
                data: {
                    jid: targetJid,
                    read: true
                }
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
 * POST /api/contact/delete-chat
 * Delete chat
 */
router.post('/delete-chat',
    validateRequired(['sessionId', 'jid']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, jid } = req.body;
            const sessionManager = require('../services/sessionManager');
            const config = sessionManager.getSessionConfig(sessionId);

            const sock = sessionManager.getSession(sessionId);

            // Format JID if it's a phone number
            const targetJid = jid.includes('@') ? jid : formatToWhatsAppId(jid, config.countryCode);

            // Delete chat
            await sock.chatModify({ delete: true }, targetJid);

            logWithSession('info', 'Chat deleted', sessionId, {
                jid: targetJid
            });

            res.json({
                success: true,
                message: 'Chat deleted successfully',
                data: {
                    jid: targetJid,
                    deleted: true
                }
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