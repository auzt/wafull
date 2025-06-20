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
    validateWebhookUrl
} = require('../middleware/validation');

const webhookService = require('../services/webhookService');
const { logWithSession } = require('../utils/logger');

/**
 * Apply middleware untuk semua webhook routes
 */
router.use(sanitizeInput);
router.use(sessionRateLimit);

/**
 * POST /api/webhook/test
 * Test webhook connectivity
 */
router.post('/test',
    validateRequired(['sessionId']),
    validateSessionExists,
    async (req, res) => {
        try {
            const { sessionId, webhookUrl } = req.body;

            // Test webhook
            const result = await webhookService.testWebhook(sessionId, webhookUrl);

            logWithSession('info', 'Webhook test performed', sessionId, {
                url: webhookUrl || 'configured_url',
                success: result.success
            });

            res.json({
                success: result.success,
                message: result.success ? 'Webhook test successful' : 'Webhook test failed',
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
 * GET /api/webhook/stats/:sessionId
 * Get webhook statistics for a session
 */
router.get('/stats/:sessionId',
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

            const stats = webhookService.getWebhookStats(sessionId);
            const pendingCount = webhookService.getPendingWebhooksCount(sessionId);
            const config = sessionManager.getSessionConfig(sessionId);

            res.json({
                success: true,
                message: 'Webhook statistics retrieved',
                data: {
                    sessionId: sessionId,
                    webhookUrl: config.webhookUrl || null,
                    statistics: {
                        ...stats,
                        pending: pendingCount,
                        successRate: stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(2) + '%' : '0%'
                    }
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
 * GET /api/webhook/stats
 * Get webhook statistics for all sessions
 */
router.get('/stats',
    async (req, res) => {
        try {
            const allStats = webhookService.getAllWebhookStats();
            const sessionManager = require('../services/sessionManager');

            // Enrich with session info
            const enrichedStats = {};
            for (const [sessionId, stats] of Object.entries(allStats)) {
                const config = sessionManager.getSessionConfig(sessionId);
                enrichedStats[sessionId] = {
                    ...stats,
                    webhookUrl: config?.webhookUrl || null,
                    successRate: stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(2) + '%' : '0%'
                };
            }

            // Calculate totals
            const totalStats = Object.values(allStats).reduce((acc, curr) => {
                acc.total += curr.total;
                acc.success += curr.success;
                acc.error += curr.error;
                acc.pending += curr.pendingCount || 0;
                return acc;
            }, { total: 0, success: 0, error: 0, pending: 0 });

            res.json({
                success: true,
                message: 'All webhook statistics retrieved',
                data: {
                    sessions: enrichedStats,
                    totals: {
                        ...totalStats,
                        successRate: totalStats.total > 0 ? ((totalStats.success / totalStats.total) * 100).toFixed(2) + '%' : '0%'
                    }
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
 * POST /api/webhook/clear-pending
 * Clear pending webhooks for a session
 */
router.post('/clear-pending',
    validateRequired(['sessionId']),
    validateSessionExists,
    async (req, res) => {
        try {
            const { sessionId } = req.body;

            const pendingCount = webhookService.getPendingWebhooksCount(sessionId);
            webhookService.clearPendingWebhooks(sessionId);

            logWithSession('info', 'Pending webhooks cleared', sessionId, {
                clearedCount: pendingCount
            });

            res.json({
                success: true,
                message: 'Pending webhooks cleared successfully',
                data: {
                    sessionId: sessionId,
                    clearedCount: pendingCount
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
 * POST /api/webhook/send-custom
 * Send custom webhook event
 */
router.post('/send-custom',
    validateRequired(['sessionId', 'eventName']),
    validateSessionExists,
    async (req, res) => {
        try {
            const { sessionId, eventName, data = {} } = req.body;

            // Send custom webhook
            const result = await webhookService.sendCustomWebhook(sessionId, eventName, data);

            logWithSession('info', 'Custom webhook sent', sessionId, {
                eventName: eventName,
                success: result.success
            });

            res.json({
                success: result.success,
                message: result.success ? 'Custom webhook sent successfully' : 'Custom webhook failed',
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
 * POST /api/webhook/batch-send
 * Send multiple webhooks at once
 */
router.post('/batch-send',
    validateRequired(['sessionId', 'webhooks']),
    validateSessionExists,
    async (req, res) => {
        try {
            const { sessionId, webhooks } = req.body;

            if (!Array.isArray(webhooks) || webhooks.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'webhooks must be a non-empty array'
                });
            }

            if (webhooks.length > 50) {
                return res.status(400).json({
                    success: false,
                    error: 'Maximum 50 webhooks can be sent at once'
                });
            }

            // Send batch webhooks
            const results = await webhookService.sendBatchWebhooks(sessionId, webhooks);

            const successCount = results.filter(r => r.success).length;

            logWithSession('info', 'Batch webhooks sent', sessionId, {
                total: webhooks.length,
                successful: successCount,
                failed: webhooks.length - successCount
            });

            res.json({
                success: successCount > 0,
                message: `${successCount}/${webhooks.length} webhooks sent successfully`,
                data: {
                    total: webhooks.length,
                    successful: successCount,
                    failed: webhooks.length - successCount,
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

/**
 * POST /api/webhook/reset-stats
 * Reset webhook statistics for a session
 */
router.post('/reset-stats',
    validateRequired(['sessionId']),
    validateSessionExists,
    async (req, res) => {
        try {
            const { sessionId } = req.body;

            webhookService.resetWebhookStats(sessionId);

            logWithSession('info', 'Webhook statistics reset', sessionId);

            res.json({
                success: true,
                message: 'Webhook statistics reset successfully',
                data: {
                    sessionId: sessionId,
                    resetAt: new Date().toISOString()
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
 * PUT /api/webhook/config
 * Update webhook configuration for a session
 */
router.put('/config',
    validateRequired(['sessionId']),
    validateSessionExists,
    validateWebhookUrl,
    async (req, res) => {
        try {
            const { sessionId, webhookUrl, webhookDelay } = req.body;
            const sessionManager = require('../services/sessionManager');

            const currentConfig = sessionManager.getSessionConfig(sessionId);
            const newConfig = {};

            if (webhookUrl !== undefined) {
                newConfig.webhookUrl = webhookUrl;
            }

            if (webhookDelay !== undefined) {
                if (typeof webhookDelay !== 'number' || webhookDelay < 500) {
                    return res.status(400).json({
                        success: false,
                        error: 'webhookDelay must be a number >= 500'
                    });
                }
                newConfig.webhookDelay = webhookDelay;
            }

            // Update configuration
            sessionManager.updateSessionConfig(sessionId, newConfig);

            logWithSession('info', 'Webhook configuration updated', sessionId, newConfig);

            res.json({
                success: true,
                message: 'Webhook configuration updated successfully',
                data: {
                    sessionId: sessionId,
                    config: sessionManager.getSessionConfig(sessionId)
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
 * GET /api/webhook/events
 * Get list of webhook events that can be sent
 */
router.get('/events',
    async (req, res) => {
        try {
            const events = {
                connection: [
                    'qr_generated',
                    'connected',
                    'connection_closed'
                ],
                messages: [
                    'message_received',
                    'message_updated',
                    'message_sent',
                    'message_deleted',
                    'message_edited',
                    'message_forwarded',
                    'reaction_sent'
                ],
                groups: [
                    'group_updated',
                    'group_participants_update'
                ],
                contacts: [
                    'contacts_update',
                    'presence_update'
                ],
                chats: [
                    'chats_update'
                ],
                calls: [
                    'call_received',
                    'call_rejected'
                ],
                custom: [
                    'webhook_test',
                    'custom_event'
                ]
            };

            res.json({
                success: true,
                message: 'Webhook events list retrieved',
                data: {
                    events: events,
                    totalEvents: Object.values(events).flat().length,
                    categories: Object.keys(events)
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
 * GET /api/webhook/logs/:sessionId
 * Get webhook logs for debugging (if implemented)
 */
router.get('/logs/:sessionId',
    async (req, res) => {
        try {
            const { sessionId } = req.params;
            const { limit = 50, offset = 0 } = req.query;

            // This is a placeholder for webhook logging feature
            // In a real implementation, you might store webhook logs in a database

            res.json({
                success: true,
                message: 'Webhook logs feature not implemented yet',
                data: {
                    sessionId: sessionId,
                    logs: [],
                    total: 0,
                    note: 'Webhook logs can be implemented by storing webhook events in a database'
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