const express = require('express');
const router = express.Router();

// Import controllers
const authController = require('../controllers/authController');

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
    validateSessionExists,
    validateWebhookUrl
} = require('../middleware/validation');

/**
 * Apply middleware untuk semua auth routes
 */
router.use(sanitizeInput);
router.use(sessionRateLimit);
router.use(requestTimeout(30000)); // 30 detik timeout

/**
 * POST /api/auth/create-session
 * Create new WhatsApp session
 */
router.post('/create-session',
    validate(schemas.createSession),
    validateWebhookUrl,
    authController.createSession
);

/**
 * POST /api/auth/connect
 * Connect session to WhatsApp
 */
router.post('/connect',
    validate(schemas.connect),
    validateWebhookUrl,
    authController.connect
);

/**
 * GET /api/auth/qr/:sessionId
 * Get QR code for scanning
 * Query params: format=base64|image (default: base64)
 */
router.get('/qr/:sessionId',
    (req, res, next) => {
        // Validate sessionId parameter
        if (!req.params.sessionId) {
            return res.status(400).json({
                success: false,
                error: 'sessionId parameter is required'
            });
        }
        next();
    },
    authController.getQRCode
);

/**
 * GET /api/auth/status/:sessionId
 * Get session status and information
 */
router.get('/status/:sessionId',
    (req, res, next) => {
        if (!req.params.sessionId) {
            return res.status(400).json({
                success: false,
                error: 'sessionId parameter is required'
            });
        }
        next();
    },
    authController.getSessionStatus
);

/**
 * POST /api/auth/disconnect
 * Disconnect session from WhatsApp
 */
router.post('/disconnect',
    validateRequired(['sessionId']),
    validateSessionExists,
    authController.disconnect
);

/**
 * POST /api/auth/logout  
 * Logout session and optionally delete session files
 */
router.post('/logout',
    validateRequired(['sessionId']),
    validateSessionExists,
    authController.logout
);

/**
 * GET /api/auth/sessions
 * Get all sessions with their status
 */
router.get('/sessions', authController.getAllSessions);

/**
 * PUT /api/auth/config
 * Update session configuration
 */
router.put('/config',
    validateRequired(['sessionId', 'config']),
    validateSessionExists,
    validate(schemas.createSession),
    validateWebhookUrl,
    authController.updateSessionConfig
);

/**
 * POST /api/auth/pairing-code
 * Get pairing code for connection without QR
 */
router.post('/pairing-code',
    validate(schemas.pairingCode),
    validateSessionExists,
    authController.getPairingCode
);

/**
 * POST /api/auth/check-number
 * Check if phone number is registered on WhatsApp
 */
router.post('/check-number',
    validate(schemas.checkNumber),
    validateSessionExists,
    authController.checkNumber
);

/**
 * POST /api/auth/restart
 * Restart session connection
 */
router.post('/restart',
    validateRequired(['sessionId']),
    validateSessionExists,
    authController.restartSession
);

/**
 * GET /api/auth/session-info/:sessionId
 * Get detailed session information
 */
router.get('/session-info/:sessionId',
    (req, res, next) => {
        if (!req.params.sessionId) {
            return res.status(400).json({
                success: false,
                error: 'sessionId parameter is required'
            });
        }
        next();
    },
    (req, res) => {
        try {
            const { sessionId } = req.params;
            const sessionManager = require('../services/sessionManager');
            const whatsappService = require('../services/whatsappService');
            const webhookService = require('../services/webhookService');

            if (!sessionManager.hasSession(sessionId)) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            const state = sessionManager.getSessionState(sessionId);
            const config = sessionManager.getSessionConfig(sessionId);
            const sock = sessionManager.getSession(sessionId);
            const store = whatsappService.getStore(sessionId);
            const webhookStats = webhookService.getWebhookStats(sessionId);
            const pendingWebhooks = webhookService.getPendingWebhooksCount(sessionId);

            const sessionInfo = {
                sessionId: sessionId,
                state: state,
                connected: sessionManager.isSessionConnected(sessionId),
                config: config,
                user: sock?.user || null,
                chats: store ? Object.keys(store.chats).length : 0,
                contacts: store ? Object.keys(store.contacts).length : 0,
                messages: store ? Object.keys(store.messages).reduce((total, jid) => total + store.messages[jid].length, 0) : 0,
                webhooks: {
                    ...webhookStats,
                    pending: pendingWebhooks
                },
                timestamps: {
                    created: config.createdAt || null,
                    lastConnected: null, // TODO: track this
                    lastDisconnected: null // TODO: track this
                }
            };

            res.json({
                success: true,
                message: 'Session information retrieved',
                data: sessionInfo
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
 * DELETE /api/auth/session/:sessionId
 * Delete session completely
 */
router.delete('/session/:sessionId',
    (req, res, next) => {
        if (!req.params.sessionId) {
            return res.status(400).json({
                success: false,
                error: 'sessionId parameter is required'
            });
        }
        next();
    },
    async (req, res) => {
        try {
            const { sessionId } = req.params;
            const { deleteFiles = true } = req.query;
            const sessionManager = require('../services/sessionManager');

            if (!sessionManager.hasSession(sessionId)) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            await sessionManager.deleteSession(sessionId, deleteFiles === 'true');

            res.json({
                success: true,
                message: 'Session deleted successfully',
                data: {
                    sessionId: sessionId,
                    filesDeleted: deleteFiles === 'true'
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
 * POST /api/auth/bulk-create
 * Create multiple sessions at once
 */
router.post('/bulk-create',
    (req, res, next) => {
        const { sessions } = req.body;

        if (!sessions || !Array.isArray(sessions) || sessions.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'sessions array is required'
            });
        }

        if (sessions.length > 10) {
            return res.status(400).json({
                success: false,
                error: 'Maximum 10 sessions can be created at once'
            });
        }

        next();
    },
    async (req, res) => {
        try {
            const { sessions } = req.body;
            const sessionManager = require('../services/sessionManager');
            const results = [];

            for (const sessionData of sessions) {
                try {
                    const { sessionId, config = {} } = sessionData;
                    const newSessionId = sessionManager.createSession(sessionId, config);

                    results.push({
                        sessionId: newSessionId,
                        success: true,
                        config: sessionManager.getSessionConfig(newSessionId)
                    });
                } catch (error) {
                    results.push({
                        sessionId: sessionData.sessionId || 'unknown',
                        success: false,
                        error: error.message
                    });
                }
            }

            const successCount = results.filter(r => r.success).length;

            res.json({
                success: successCount > 0,
                message: `${successCount}/${sessions.length} sessions created successfully`,
                data: {
                    total: sessions.length,
                    successful: successCount,
                    failed: sessions.length - successCount,
                    results: results
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