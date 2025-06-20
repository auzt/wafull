const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./auth');
const messageRoutes = require('./message');
const groupRoutes = require('./group');
const contactRoutes = require('./contact');
const statusRoutes = require('./status');
const webhookRoutes = require('./webhook');

// Import middleware
const { validateApiKey, logRequest } = require('../middleware/auth');
const { defaultConfig } = require('../config/default');

/**
 * Health check endpoint
 */
router.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'WhatsApp API is running',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        environment: defaultConfig.server.environment
    });
});

/**
 * API Information endpoint
 */
router.get('/info', (req, res) => {
    const sessionManager = require('../services/sessionManager');
    const sessions = sessionManager.getAllSessionsInfo();

    res.json({
        success: true,
        message: 'WhatsApp API Information',
        data: {
            version: '1.0.0',
            environment: defaultConfig.server.environment,
            timestamp: new Date().toISOString(),
            sessions: {
                total: sessions.length,
                connected: sessions.filter(s => s.connected).length,
                disconnected: sessions.filter(s => !s.connected).length
            },
            features: [
                'Multiple Sessions',
                'Send Text Messages',
                'Send Media Messages',
                'Send Location',
                'Send Contact',
                'Send Reactions',
                'Forward Messages',
                'Delete Messages',
                'Edit Messages',
                'Download Media',
                'Group Management',
                'Contact Management',
                'Status Updates',
                'Webhook Integration',
                'QR Code Generation',
                'Pairing Code',
                'Number Validation',
                'Auto Read Messages',
                'Typing Indicators',
                'Custom Delays',
                'Rate Limiting'
            ],
            endpoints: {
                auth: '/api/auth/*',
                message: '/api/message/*',
                group: '/api/group/*',
                contact: '/api/contact/*',
                status: '/api/status/*',
                webhook: '/api/webhook/*'
            }
        }
    });
});

/**
 * API documentation endpoint
 */
router.get('/docs', (req, res) => {
    res.json({
        success: true,
        message: 'WhatsApp API Documentation',
        data: {
            baseUrl: `http://localhost:${defaultConfig.server.port}/api`,
            authentication: {
                type: 'API Key',
                header: 'x-api-key',
                alternative: 'Authorization: Bearer <api-key>'
            },
            endpoints: {
                authentication: {
                    'POST /auth/create-session': 'Create new WhatsApp session',
                    'POST /auth/connect': 'Connect session to WhatsApp',
                    'GET /auth/qr/:sessionId': 'Get QR code for scanning',
                    'GET /auth/status/:sessionId': 'Get session status',
                    'POST /auth/disconnect': 'Disconnect session',
                    'POST /auth/logout': 'Logout and delete session',
                    'GET /auth/sessions': 'Get all sessions',
                    'PUT /auth/config': 'Update session configuration',
                    'POST /auth/pairing-code': 'Get pairing code',
                    'POST /auth/check-number': 'Check if number exists on WhatsApp',
                    'POST /auth/restart': 'Restart session'
                },
                messaging: {
                    'POST /message/send-text': 'Send text message',
                    'POST /message/send-media': 'Send media message (image, video, audio, document)',
                    'POST /message/send-location': 'Send location message',
                    'POST /message/send-contact': 'Send contact message',
                    'POST /message/send-reaction': 'Send reaction to message',
                    'POST /message/forward': 'Forward message',
                    'POST /message/delete': 'Delete message',
                    'POST /message/edit': 'Edit message',
                    'POST /message/download-media': 'Download media from message',
                    'GET /message/history/:sessionId/:jid': 'Get message history'
                },
                groups: {
                    'POST /group/create': 'Create group',
                    'POST /group/add-participant': 'Add participant to group',
                    'POST /group/remove-participant': 'Remove participant from group',
                    'POST /group/promote-admin': 'Promote participant to admin',
                    'POST /group/demote-admin': 'Demote admin to participant',
                    'POST /group/update-subject': 'Update group subject',
                    'POST /group/update-description': 'Update group description',
                    'POST /group/leave': 'Leave group',
                    'GET /group/info/:sessionId/:groupId': 'Get group info',
                    'GET /group/participants/:sessionId/:groupId': 'Get group participants',
                    'POST /group/invite-code': 'Get group invite code',
                    'POST /group/revoke-invite': 'Revoke group invite code'
                },
                contacts: {
                    'GET /contact/list/:sessionId': 'Get contact list',
                    'GET /contact/profile/:sessionId/:jid': 'Get contact profile',
                    'POST /contact/block': 'Block contact',
                    'POST /contact/unblock': 'Unblock contact',
                    'GET /contact/blocked/:sessionId': 'Get blocked contacts'
                },
                status: {
                    'POST /status/update-presence': 'Update presence (online/offline)',
                    'POST /status/update-profile-name': 'Update profile name',
                    'POST /status/update-profile-status': 'Update profile status',
                    'POST /status/update-profile-picture': 'Update profile picture'
                },
                webhook: {
                    'POST /webhook/test': 'Test webhook connectivity',
                    'GET /webhook/stats/:sessionId': 'Get webhook statistics',
                    'POST /webhook/clear-pending': 'Clear pending webhooks'
                }
            },
            examples: {
                'Send Text Message': {
                    url: 'POST /api/message/send-text',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': 'your-api-key'
                    },
                    body: {
                        sessionId: 'session_123',
                        to: '628123456789',
                        text: 'Hello World!'
                    }
                },
                'Send to Multiple Numbers': {
                    url: 'POST /api/message/send-text',
                    body: {
                        sessionId: 'session_123',
                        to: ['628123456789', '628987654321'],
                        text: 'Hello to multiple recipients!'
                    }
                },
                'Create Session': {
                    url: 'POST /api/auth/create-session',
                    body: {
                        sessionId: 'my_session',
                        config: {
                            countryCode: '62',
                            webhookUrl: 'https://yourwebsite.com/webhook',
                            autoRead: true,
                            showTyping: true
                        }
                    }
                }
            },
            configuration: {
                countryCode: 'Default country code (e.g., 62 for Indonesia)',
                webhookUrl: 'URL to receive webhook notifications',
                webhookDelay: 'Delay before sending webhook (ms)',
                messageDelay: 'Delay between messages (ms)',
                typingDelay: 'Typing indicator duration (ms)',
                pauseDelay: 'Pause after typing (ms)',
                readMessageDelay: 'Delay before marking message as read (ms)',
                showTyping: 'Show typing indicator (boolean)',
                autoRead: 'Auto read incoming messages (boolean)',
                checkNumber: 'Check if number exists before sending (boolean)'
            }
        }
    });
});

/**
 * Apply global middleware untuk semua API routes
 */
router.use(validateApiKey);
router.use(logRequest);

/**
 * Mount route modules
 */
router.use('/auth', authRoutes);
router.use('/message', messageRoutes);
router.use('/group', groupRoutes);
router.use('/contact', contactRoutes);
router.use('/status', statusRoutes);
router.use('/webhook', webhookRoutes);

/**
 * Catch-all untuk endpoint yang tidak ditemukan
 */
router.all('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'API endpoint not found',
        path: req.originalUrl,
        method: req.method,
        availableEndpoints: [
            'GET /api/health',
            'GET /api/info',
            'GET /api/docs',
            'POST /api/auth/*',
            'POST /api/message/*',
            'POST /api/group/*',
            'GET /api/contact/*',
            'POST /api/status/*',
            'POST /api/webhook/*'
        ]
    });
});

module.exports = router;