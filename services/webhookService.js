const axios = require('axios');
const sessionManager = require('./sessionManager');
const { logWebhook, logWithSession } = require('../utils/logger');
const { defaultConfig } = require('../config/default');

class WebhookService {
    constructor() {
        this.pendingWebhooks = new Map(); // Queue webhook yang belum terkirim
        this.webhookStats = new Map(); // Statistics per session
        this.setupWebhookQueue();
    }

    /**
     * Setup webhook queue processor
     */
    setupWebhookQueue() {
        // Process pending webhooks setiap 5 detik
        setInterval(() => {
            this.processPendingWebhooks();
        }, 5000);
    }

    /**
     * Send webhook dengan retry mechanism
     * @param {string} sessionId - ID session
     * @param {Object} data - Data yang akan dikirim
     * @param {Object} options - Opsi tambahan
     */
    async sendWebhook(sessionId, data, options = {}) {
        try {
            const config = sessionManager.getSessionConfig(sessionId);
            if (!config || !config.webhookUrl) {
                return; // Tidak ada webhook URL yang dikonfigurasi
            }

            const webhookData = {
                sessionId,
                timestamp: new Date().toISOString(),
                ...data
            };

            const webhookOptions = {
                url: config.webhookUrl,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'WhatsApp-API-Webhook/1.0',
                    ...options.headers
                },
                data: webhookData,
                timeout: defaultConfig.webhook.timeout,
                maxRedirects: 3,
                validateStatus: (status) => status >= 200 && status < 300
            };

            logWebhook(config.webhookUrl, 'POST', 'SENDING', sessionId, { event: data.event });

            const response = await axios(webhookOptions);

            logWebhook(config.webhookUrl, 'POST', `SUCCESS-${response.status}`, sessionId, {
                event: data.event,
                responseTime: response.headers['x-response-time']
            });

            this.updateWebhookStats(sessionId, 'success');

            return {
                success: true,
                status: response.status,
                data: response.data
            };

        } catch (error) {
            return await this.handleWebhookError(sessionId, data, error, options);
        }
    }

    /**
     * Handle webhook error dengan retry
     */
    async handleWebhookError(sessionId, data, error, options = {}) {
        const config = sessionManager.getSessionConfig(sessionId);
        const retryCount = options.retryCount || 0;
        const maxRetries = defaultConfig.webhook.retryAttempts;

        logWebhook(config.webhookUrl, 'POST', `ERROR-${error.response?.status || 'TIMEOUT'}`, sessionId, {
            event: data.event,
            error: error.message,
            retryCount
        });

        this.updateWebhookStats(sessionId, 'error');

        // Jika masih bisa retry
        if (retryCount < maxRetries) {
            const delay = defaultConfig.webhook.retryDelay * Math.pow(2, retryCount); // Exponential backoff

            logWithSession('warn', `Webhook failed, retrying in ${delay}ms (${retryCount + 1}/${maxRetries})`, sessionId, {
                error: error.message,
                url: config.webhookUrl
            });

            // Add to pending queue untuk retry
            setTimeout(() => {
                this.sendWebhook(sessionId, data, {
                    ...options,
                    retryCount: retryCount + 1
                });
            }, delay);

            return {
                success: false,
                error: error.message,
                willRetry: true,
                retryCount: retryCount + 1
            };
        }

        // Max retry tercapai
        logWithSession('error', `Webhook failed after ${maxRetries} attempts`, sessionId, {
            error: error.message,
            url: config.webhookUrl,
            event: data.event
        });

        // Simpan ke pending queue untuk manual retry nanti
        this.addToPendingQueue(sessionId, data, error);

        return {
            success: false,
            error: error.message,
            willRetry: false,
            maxRetriesReached: true
        };
    }

    /**
     * Add webhook ke pending queue
     */
    addToPendingQueue(sessionId, data, error) {
        if (!this.pendingWebhooks.has(sessionId)) {
            this.pendingWebhooks.set(sessionId, []);
        }

        const pendingQueue = this.pendingWebhooks.get(sessionId);
        pendingQueue.push({
            data,
            error: error.message,
            timestamp: new Date().toISOString(),
            attempts: 0
        });

        // Batasi jumlah pending webhooks per session (max 100)
        if (pendingQueue.length > 100) {
            pendingQueue.shift(); // Hapus yang paling lama
        }

        logWithSession('info', `Added webhook to pending queue`, sessionId, {
            queueSize: pendingQueue.length,
            event: data.event
        });
    }

    /**
     * Process pending webhooks
     */
    async processPendingWebhooks() {
        for (const [sessionId, pendingQueue] of this.pendingWebhooks.entries()) {
            if (pendingQueue.length === 0) continue;

            // Cek apakah session masih connected
            const isConnected = sessionManager.isSessionConnected(sessionId);
            if (!isConnected) continue;

            // Process max 5 pending webhooks per session per cycle
            const toProcess = pendingQueue.splice(0, 5);

            for (const pending of toProcess) {
                try {
                    pending.attempts++;
                    const result = await this.sendWebhook(sessionId, pending.data, {
                        retryCount: 0 // Reset retry count untuk pending webhooks
                    });

                    if (!result.success && pending.attempts < 3) {
                        // Gagal lagi, masukkan kembali ke queue
                        pendingQueue.push(pending);
                    }
                } catch (error) {
                    logWithSession('error', 'Error processing pending webhook', sessionId, {
                        error: error.message,
                        event: pending.data.event
                    });
                }
            }
        }
    }

    /**
     * Update webhook statistics
     */
    updateWebhookStats(sessionId, type) {
        if (!this.webhookStats.has(sessionId)) {
            this.webhookStats.set(sessionId, {
                total: 0,
                success: 0,
                error: 0,
                lastSuccess: null,
                lastError: null
            });
        }

        const stats = this.webhookStats.get(sessionId);
        stats.total++;
        stats[type]++;
        stats[`last${type.charAt(0).toUpperCase() + type.slice(1)}`] = new Date().toISOString();

        this.webhookStats.set(sessionId, stats);
    }

    /**
     * Get webhook statistics
     */
    getWebhookStats(sessionId) {
        return this.webhookStats.get(sessionId) || {
            total: 0,
            success: 0,
            error: 0,
            lastSuccess: null,
            lastError: null
        };
    }

    /**
     * Get pending webhooks count
     */
    getPendingWebhooksCount(sessionId) {
        const pending = this.pendingWebhooks.get(sessionId) || [];
        return pending.length;
    }

    /**
     * Clear pending webhooks
     */
    clearPendingWebhooks(sessionId) {
        this.pendingWebhooks.set(sessionId, []);
        logWithSession('info', 'Pending webhooks cleared', sessionId);
    }

    /**
     * Test webhook connectivity
     */
    async testWebhook(sessionId, webhookUrl = null) {
        try {
            const config = sessionManager.getSessionConfig(sessionId);
            const url = webhookUrl || config.webhookUrl;

            if (!url) {
                throw new Error('No webhook URL configured');
            }

            const testData = {
                sessionId,
                event: 'webhook_test',
                message: 'This is a test webhook from WhatsApp API',
                timestamp: new Date().toISOString()
            };

            logWebhook(url, 'POST', 'TESTING', sessionId);

            const response = await axios.post(url, testData, {
                timeout: defaultConfig.webhook.timeout,
                validateStatus: (status) => status >= 200 && status < 300
            });

            logWebhook(url, 'POST', `TEST-SUCCESS-${response.status}`, sessionId);

            return {
                success: true,
                status: response.status,
                responseTime: response.headers['x-response-time'],
                data: response.data
            };

        } catch (error) {
            logWebhook(webhookUrl, 'POST', `TEST-ERROR-${error.response?.status || 'TIMEOUT'}`, sessionId, {
                error: error.message
            });

            return {
                success: false,
                error: error.message,
                status: error.response?.status || null
            };
        }
    }

    /**
     * Send custom webhook
     */
    async sendCustomWebhook(sessionId, eventName, customData = {}) {
        const data = {
            event: eventName,
            ...customData
        };

        return await this.sendWebhook(sessionId, data);
    }

    /**
     * Batch send webhooks
     */
    async sendBatchWebhooks(sessionId, webhooksData = []) {
        const results = [];
        const config = sessionManager.getSessionConfig(sessionId);

        for (let i = 0; i < webhooksData.length; i++) {
            const webhook = webhooksData[i];

            try {
                const result = await this.sendWebhook(sessionId, webhook);
                results.push({ index: i, ...result });

                // Delay antar webhook untuk menghindari rate limiting
                if (i < webhooksData.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, config.webhookDelay || 1000));
                }
            } catch (error) {
                results.push({
                    index: i,
                    success: false,
                    error: error.message
                });
            }
        }

        return results;
    }

    /**
     * Get all webhook statistics
     */
    getAllWebhookStats() {
        const allStats = {};

        for (const [sessionId, stats] of this.webhookStats.entries()) {
            allStats[sessionId] = {
                ...stats,
                pendingCount: this.getPendingWebhooksCount(sessionId)
            };
        }

        return allStats;
    }

    /**
     * Reset webhook statistics
     */
    resetWebhookStats(sessionId) {
        this.webhookStats.delete(sessionId);
        this.clearPendingWebhooks(sessionId);
        logWithSession('info', 'Webhook statistics reset', sessionId);
    }
}

// Singleton instance
const webhookService = new WebhookService();

module.exports = webhookService;