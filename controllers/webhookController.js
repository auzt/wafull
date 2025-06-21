const sessionManager = require('../services/sessionManager');
const webhookService = require('../services/webhookService');
const Webhook = require('../models/Webhook');
const { logger, logWithSession } = require('../utils/logger');
const { createError } = require('../middleware/error');

class WebhookController {

    /**
     * POST /api/webhook/test
     * Test webhook connectivity and response
     */
    async testWebhook(req, res) {
        try {
            const { sessionId, webhookUrl, customData } = req.body;

            if (!sessionManager.hasSession(sessionId)) {
                throw createError.notFound('Session');
            }

            // Test webhook
            const testData = {
                event: 'webhook_test',
                sessionId,
                message: 'This is a test webhook from WhatsApp API',
                timestamp: new Date().toISOString(),
                ...customData
            };

            const result = await webhookService.testWebhook(sessionId, webhookUrl, testData);

            logWithSession('info', 'Webhook test performed', sessionId, {
                url: webhookUrl || 'configured_url',
                success: result.success,
                responseTime: result.responseTime
            });

            res.json({
                success: result.success,
                message: result.success ? 'Webhook test successful' : 'Webhook test failed',
                data: {
                    url: webhookUrl || sessionManager.getSessionConfig(sessionId)?.webhookUrl,
                    responseTime: result.responseTime,
                    statusCode: result.statusCode,
                    testData,
                    testedAt: new Date().toISOString(),
                    ...result
                }
            });

        } catch (error) {
            logger.error('Error in testWebhook:', error);
            throw error;
        }
    }

    /**
     * GET /api/webhook/stats/:sessionId
     * Get webhook statistics for a specific session
     */
    async getSessionStats(req, res) {
        try {
            const { sessionId } = req.params;
            const { timeRange } = req.query;

            if (!sessionManager.hasSession(sessionId)) {
                throw createError.notFound('Session');
            }

            // Get stats from webhook service
            const serviceStats = webhookService.getWebhookStats(sessionId);
            const pendingCount = webhookService.getPendingWebhooksCount(sessionId);

            // Get stats from database
            const dbStats = await Webhook.getSessionStats(sessionId, timeRange);
            const eventStats = await Webhook.getEventStats(sessionId);

            // Get session config
            const config = sessionManager.getSessionConfig(sessionId);

            const combinedStats = {
                sessionId,
                webhookUrl: config?.webhookUrl || null,
                webhookDelay: config?.webhookDelay || 1000,

                // Current service stats (in-memory)
                service: {
                    ...serviceStats,
                    pending: pendingCount,
                    successRate: serviceStats.total > 0 ?
                        ((serviceStats.success / serviceStats.total) * 100).toFixed(2) + '%' : '0%'
                },

                // Database stats (persistent)
                database: dbStats,

                // Event breakdown
                events: eventStats,

                // Summary
                isActive: !!config?.webhookUrl,
                lastActivity: serviceStats.lastSuccess || serviceStats.lastError,
                retrievedAt: new Date().toISOString()
            };

            res.json({
                success: true,
                message: 'Webhook statistics retrieved',
                data: combinedStats
            });

        } catch (error) {
            logger.error('Error in getSessionStats:', error);
            throw error;
        }
    }

    /**
     * GET /api/webhook/stats
     * Get webhook statistics for all sessions
     */
    async getAllStats(req, res) {
        try {
            const { timeRange } = req.query;

            // Get stats from webhook service
            const allServiceStats = webhookService.getAllWebhookStats();

            // Get global database stats
            const globalDbStats = await Webhook.getGlobalStats();

            // Enrich with session info
            const enrichedStats = {};
            for (const [sessionId, stats] of Object.entries(allServiceStats)) {
                const config = sessionManager.getSessionConfig(sessionId);
                const dbStats = await Webhook.getSessionStats(sessionId, timeRange);

                enrichedStats[sessionId] = {
                    sessionId,
                    webhookUrl: config?.webhookUrl || null,
                    isActive: !!config?.webhookUrl,
                    service: {
                        ...stats,
                        successRate: stats.total > 0 ?
                            ((stats.success / stats.total) * 100).toFixed(2) + '%' : '0%'
                    },
                    database: dbStats
                };
            }

            // Calculate totals from service stats
            const serviceTotals = Object.values(allServiceStats).reduce((acc, curr) => {
                acc.total += curr.total;
                acc.success += curr.success;
                acc.error += curr.error;
                acc.pending += curr.pendingCount || 0;
                return acc;
            }, { total: 0, success: 0, error: 0, pending: 0 });

            const responseData = {
                sessions: enrichedStats,
                totals: {
                    service: {
                        ...serviceTotals,
                        successRate: serviceTotals.total > 0 ?
                            ((serviceTotals.success / serviceTotals.total) * 100).toFixed(2) + '%' : '0%'
                    },
                    database: globalDbStats
                },
                summary: {
                    totalSessions: Object.keys(enrichedStats).length,
                    activeSessions: Object.values(enrichedStats).filter(s => s.isActive).length,
                    inactiveSessions: Object.values(enrichedStats).filter(s => !s.isActive).length
                },
                retrievedAt: new Date().toISOString()
            };

            res.json({
                success: true,
                message: 'All webhook statistics retrieved',
                data: responseData
            });

        } catch (error) {
            logger.error('Error in getAllStats:', error);
            throw error;
        }
    }

    /**
     * POST /api/webhook/clear-pending
     * Clear pending webhooks for a session
     */
    async clearPending(req, res) {
        try {
            const { sessionId } = req.body;

            if (!sessionManager.hasSession(sessionId)) {
                throw createError.notFound('Session');
            }

            const pendingCount = webhookService.getPendingWebhooksCount(sessionId);

            // Clear from service
            webhookService.clearPendingWebhooks(sessionId);

            // Clear from database
            const dbCleared = await Webhook.destroy({
                where: {
                    sessionId,
                    status: ['PENDING', 'RETRYING']
                }
            });

            logWithSession('info', 'Pending webhooks cleared', sessionId, {
                serviceCleared: pendingCount,
                dbCleared
            });

            res.json({
                success: true,
                message: 'Pending webhooks cleared successfully',
                data: {
                    sessionId,
                    clearedFromService: pendingCount,
                    clearedFromDatabase: dbCleared,
                    totalCleared: pendingCount + dbCleared,
                    clearedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in clearPending:', error);
            throw error;
        }
    }

    /**
     * POST /api/webhook/send-custom
     * Send custom webhook event
     */
    async sendCustom(req, res) {
        try {
            const { sessionId, eventName, data = {}, saveToDb = false } = req.body;

            if (!sessionManager.hasSession(sessionId)) {
                throw createError.notFound('Session');
            }

            if (!eventName) {
                throw createError.validation('eventName is required');
            }

            const webhookData = {
                event: eventName,
                sessionId,
                timestamp: new Date().toISOString(),
                customData: data
            };

            // Send webhook
            const result = await webhookService.sendCustomWebhook(sessionId, eventName, data);

            // Save to database if requested
            let dbRecord = null;
            if (saveToDb) {
                const config = sessionManager.getSessionConfig(sessionId);

                dbRecord = await Webhook.create({
                    sessionId,
                    url: config.webhookUrl,
                    event: eventName,
                    payload: webhookData,
                    status: result.success ? 'SUCCESS' : 'FAILED',
                    statusCode: result.status,
                    responseBody: result.data ? JSON.stringify(result.data) : null,
                    errorMessage: result.success ? null : result.error,
                    sentAt: new Date(),
                    completedAt: new Date()
                });
            }

            logWithSession('info', 'Custom webhook sent', sessionId, {
                eventName,
                success: result.success,
                savedToDb: !!dbRecord
            });

            res.json({
                success: result.success,
                message: result.success ? 'Custom webhook sent successfully' : 'Custom webhook failed',
                data: {
                    eventName,
                    webhookData,
                    result,
                    databaseRecord: dbRecord ? {
                        id: dbRecord.id,
                        status: dbRecord.status
                    } : null,
                    sentAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in sendCustom:', error);
            throw error;
        }
    }

    /**
     * POST /api/webhook/batch-send
     * Send multiple webhooks at once
     */
    async batchSend(req, res) {
        try {
            const { sessionId, webhooks, saveToDb = false } = req.body;

            if (!sessionManager.hasSession(sessionId)) {
                throw createError.notFound('Session');
            }

            if (!Array.isArray(webhooks) || webhooks.length === 0) {
                throw createError.validation('webhooks must be a non-empty array');
            }

            if (webhooks.length > 50) {
                throw createError.validation('Maximum 50 webhooks can be sent at once');
            }

            // Validate webhook structure
            for (const webhook of webhooks) {
                if (!webhook.event) {
                    throw createError.validation('Each webhook must have an event property');
                }
            }

            // Send batch webhooks
            const results = await webhookService.sendBatchWebhooks(sessionId, webhooks);

            // Save to database if requested
            let dbRecords = [];
            if (saveToDb) {
                const config = sessionManager.getSessionConfig(sessionId);

                for (let i = 0; i < webhooks.length; i++) {
                    const webhook = webhooks[i];
                    const result = results[i];

                    try {
                        const dbRecord = await Webhook.create({
                            sessionId,
                            url: config.webhookUrl,
                            event: webhook.event,
                            payload: webhook,
                            status: result.success ? 'SUCCESS' : 'FAILED',
                            statusCode: result.status,
                            errorMessage: result.success ? null : result.error,
                            sentAt: new Date(),
                            completedAt: new Date()
                        });

                        dbRecords.push(dbRecord);
                    } catch (dbError) {
                        logger.warn('Failed to save webhook to database', { error: dbError.message });
                    }
                }
            }

            const successCount = results.filter(r => r.success).length;

            logWithSession('info', 'Batch webhooks sent', sessionId, {
                total: webhooks.length,
                successful: successCount,
                failed: webhooks.length - successCount,
                savedToDb: dbRecords.length
            });

            res.json({
                success: successCount > 0,
                message: `${successCount}/${webhooks.length} webhooks sent successfully`,
                data: {
                    sessionId,
                    summary: {
                        total: webhooks.length,
                        successful: successCount,
                        failed: webhooks.length - successCount,
                        savedToDatabase: dbRecords.length
                    },
                    results,
                    databaseRecords: dbRecords.map(r => ({
                        id: r.id,
                        event: r.event,
                        status: r.status
                    })),
                    sentAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in batchSend:', error);
            throw error;
        }
    }

    /**
     * PUT /api/webhook/config
     * Update webhook configuration
     */
    async updateConfig(req, res) {
        try {
            const { sessionId, webhookUrl, webhookDelay, enabled = true } = req.body;

            if (!sessionManager.hasSession(sessionId)) {
                throw createError.notFound('Session');
            }

            const newConfig = {};

            if (webhookUrl !== undefined) {
                if (webhookUrl && enabled) {
                    try {
                        new URL(webhookUrl);
                    } catch (error) {
                        throw createError.validation('Invalid webhook URL format');
                    }
                }
                newConfig.webhookUrl = enabled ? webhookUrl : '';
            }

            if (webhookDelay !== undefined) {
                if (typeof webhookDelay !== 'number' || webhookDelay < 500 || webhookDelay > 30000) {
                    throw createError.validation('webhookDelay must be a number between 500 and 30000 milliseconds');
                }
                newConfig.webhookDelay = webhookDelay;
            }

            // Update configuration
            sessionManager.updateSessionConfig(sessionId, newConfig);

            const updatedConfig = sessionManager.getSessionConfig(sessionId);

            logWithSession('info', 'Webhook configuration updated', sessionId, {
                webhookUrl: newConfig.webhookUrl,
                webhookDelay: newConfig.webhookDelay,
                enabled
            });

            res.json({
                success: true,
                message: 'Webhook configuration updated successfully',
                data: {
                    sessionId,
                    webhookUrl: updatedConfig.webhookUrl,
                    webhookDelay: updatedConfig.webhookDelay,
                    enabled: !!updatedConfig.webhookUrl,
                    updatedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in updateConfig:', error);
            throw error;
        }
    }

    /**
     * GET /api/webhook/events
     * Get list of available webhook events
     */
    async getEvents(req, res) {
        try {
            const events = {
                connection: {
                    description: 'Connection and authentication events',
                    events: [
                        { name: 'qr_generated', description: 'QR code generated for authentication' },
                        { name: 'connected', description: 'Session successfully connected' },
                        { name: 'connection_closed', description: 'Connection was closed' },
                        { name: 'connection_lost', description: 'Connection lost unexpectedly' },
                        { name: 'reconnecting', description: 'Attempting to reconnect' }
                    ]
                },
                messages: {
                    description: 'Message related events',
                    events: [
                        { name: 'message_received', description: 'New message received' },
                        { name: 'message_sent', description: 'Message sent successfully' },
                        { name: 'message_updated', description: 'Message status updated (delivered/read)' },
                        { name: 'message_deleted', description: 'Message was deleted' },
                        { name: 'message_edited', description: 'Message was edited' },
                        { name: 'message_forwarded', description: 'Message was forwarded' },
                        { name: 'reaction_sent', description: 'Reaction added to message' }
                    ]
                },
                groups: {
                    description: 'Group management events',
                    events: [
                        { name: 'group_created', description: 'New group created' },
                        { name: 'group_updated', description: 'Group information updated' },
                        { name: 'group_participants_update', description: 'Group participants changed' },
                        { name: 'group_invite_sent', description: 'Group invitation sent' }
                    ]
                },
                contacts: {
                    description: 'Contact and presence events',
                    events: [
                        { name: 'contacts_update', description: 'Contact information updated' },
                        { name: 'presence_update', description: 'Contact presence changed' },
                        { name: 'contact_blocked', description: 'Contact was blocked' },
                        { name: 'contact_unblocked', description: 'Contact was unblocked' }
                    ]
                },
                chats: {
                    description: 'Chat management events',
                    events: [
                        { name: 'chats_update', description: 'Chat information updated' },
                        { name: 'chat_archived', description: 'Chat was archived' },
                        { name: 'chat_unarchived', description: 'Chat was unarchived' }
                    ]
                },
                calls: {
                    description: 'Call events',
                    events: [
                        { name: 'call_received', description: 'Incoming call received' },
                        { name: 'call_rejected', description: 'Call was rejected' },
                        { name: 'call_accepted', description: 'Call was accepted' }
                    ]
                },
                custom: {
                    description: 'Custom and system events',
                    events: [
                        { name: 'webhook_test', description: 'Webhook connectivity test' },
                        { name: 'custom_event', description: 'User-defined custom event' },
                        { name: 'system_notification', description: 'System notification' }
                    ]
                }
            };

            const totalEvents = Object.values(events).reduce((sum, category) => sum + category.events.length, 0);

            res.json({
                success: true,
                message: 'Webhook events list retrieved',
                data: {
                    events,
                    summary: {
                        totalEvents,
                        categories: Object.keys(events).length,
                        categoriesDetails: Object.keys(events).map(key => ({
                            name: key,
                            description: events[key].description,
                            eventCount: events[key].events.length
                        }))
                    }
                }
            });

        } catch (error) {
            logger.error('Error in getEvents:', error);
            throw error;
        }
    }

    /**
     * GET /api/webhook/logs/:sessionId
     * Get webhook execution logs
     */
    async getLogs(req, res) {
        try {
            const { sessionId } = req.params;
            const {
                limit = 50,
                offset = 0,
                status,
                event,
                startDate,
                endDate
            } = req.query;

            if (!sessionManager.hasSession(sessionId)) {
                throw createError.notFound('Session');
            }

            // Build query conditions
            const where = { sessionId };

            if (status) {
                where.status = status;
            }

            if (event) {
                where.event = event;
            }

            if (startDate || endDate) {
                where.createdAt = {};
                if (startDate) {
                    where.createdAt[Op.gte] = new Date(startDate);
                }
                if (endDate) {
                    where.createdAt[Op.lte] = new Date(endDate);
                }
            }

            // Get logs from database
            const logs = await Webhook.findAndCountAll({
                where,
                limit: parseInt(limit),
                offset: parseInt(offset),
                order: [['createdAt', 'DESC']],
                attributes: { exclude: ['payload', 'responseBody'] } // Exclude large fields
            });

            res.json({
                success: true,
                message: 'Webhook logs retrieved',
                data: {
                    logs: logs.rows,
                    pagination: {
                        total: logs.count,
                        limit: parseInt(limit),
                        offset: parseInt(offset),
                        hasMore: (parseInt(offset) + parseInt(limit)) < logs.count
                    },
                    filters: {
                        status,
                        event,
                        startDate,
                        endDate
                    }
                }
            });

        } catch (error) {
            logger.error('Error in getLogs:', error);
            throw error;
        }
    }

    /**
     * POST /api/webhook/retry-failed
     * Retry failed webhooks
     */
    async retryFailed(req, res) {
        try {
            const { sessionId, webhookIds } = req.body;

            if (!sessionManager.hasSession(sessionId)) {
                throw createError.notFound('Session');
            }

            let retriedCount = 0;

            if (webhookIds && Array.isArray(webhookIds)) {
                // Retry specific webhooks
                for (const webhookId of webhookIds) {
                    const webhook = await Webhook.findByPk(webhookId);
                    if (webhook && webhook.sessionId === sessionId && webhook.canRetry()) {
                        webhook.status = 'RETRYING';
                        webhook.nextRetryAt = new Date(Date.now() + 5000); // Retry in 5 seconds
                        await webhook.save();
                        retriedCount++;
                    }
                }
            } else {
                // Retry all failed webhooks for session
                retriedCount = await Webhook.retryFailedWebhooks(sessionId);
            }

            logWithSession('info', 'Failed webhooks queued for retry', sessionId, {
                retriedCount,
                specific: !!webhookIds
            });

            res.json({
                success: true,
                message: `${retriedCount} failed webhooks queued for retry`,
                data: {
                    sessionId,
                    retriedCount,
                    queuedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in retryFailed:', error);
            throw error;
        }
    }

    /**
     * DELETE /api/webhook/cleanup
     * Cleanup old webhook logs
     */
    async cleanup(req, res) {
        try {
            const { sessionId, olderThanDays = 30 } = req.body;

            if (sessionId && !sessionManager.hasSession(sessionId)) {
                throw createError.notFound('Session');
            }

            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - parseInt(olderThanDays));

            const where = {
                status: ['SUCCESS', 'FAILED'],
                completedAt: {
                    [Op.lt]: cutoffDate
                }
            };

            if (sessionId) {
                where.sessionId = sessionId;
            }

            const deletedCount = await Webhook.destroy({ where });

            logWithSession('info', 'Webhook logs cleaned up', sessionId || 'global', {
                deletedCount,
                olderThanDays: parseInt(olderThanDays)
            });

            res.json({
                success: true,
                message: `${deletedCount} old webhook logs cleaned up`,
                data: {
                    sessionId: sessionId || null,
                    deletedCount,
                    olderThanDays: parseInt(olderThanDays),
                    cleanedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in cleanup:', error);
            throw error;
        }
    }
}

module.exports = new WebhookController();