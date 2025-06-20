const { defaultConfig } = require('../config/default');
const { logger } = require('../utils/logger');
const { RateLimitError } = require('./error');

/**
 * In-memory rate limit store
 */
class RateLimitStore {
    constructor() {
        this.store = new Map();
        this.cleanup();
    }

    /**
     * Get rate limit data for a key
     */
    get(key) {
        return this.store.get(key);
    }

    /**
     * Set rate limit data for a key
     */
    set(key, data, ttl) {
        data.expires = Date.now() + ttl;
        this.store.set(key, data);
    }

    /**
     * Increment counter for a key
     */
    increment(key, windowMs, maxRequests) {
        const now = Date.now();
        const data = this.get(key);

        if (!data || now > data.expires) {
            // Create new window
            const newData = {
                count: 1,
                resetTime: now + windowMs,
                expires: now + windowMs
            };
            this.set(key, newData, windowMs);
            return newData;
        }

        // Increment existing window
        data.count++;
        this.store.set(key, data);
        return data;
    }

    /**
     * Reset counter for a key
     */
    reset(key) {
        this.store.delete(key);
    }

    /**
     * Clean up expired entries
     */
    cleanup() {
        setInterval(() => {
            const now = Date.now();
            for (const [key, data] of this.store.entries()) {
                if (data.expires && now > data.expires) {
                    this.store.delete(key);
                }
            }
        }, 60000); // Cleanup every minute
    }

    /**
     * Get current store size
     */
    size() {
        return this.store.size;
    }

    /**
     * Clear all entries
     */
    clear() {
        this.store.clear();
    }
}

// Global rate limit store
const store = new RateLimitStore();

/**
 * Create rate limiter middleware
 */
const createRateLimit = (options = {}) => {
    const {
        windowMs = defaultConfig.security.rateLimitWindowMs,
        max = defaultConfig.security.rateLimitMaxRequests,
        message = 'Too many requests',
        statusCode = 429,
        headers = true,
        skipSuccessfulRequests = false,
        skipFailedRequests = false,
        keyGenerator = (req) => req.ip,
        skip = () => false,
        onLimitReached = null
    } = options;

    return async (req, res, next) => {
        try {
            // Check if request should be skipped
            if (skip(req)) {
                return next();
            }

            const key = keyGenerator(req);
            if (!key) {
                return next();
            }

            // Get current rate limit data
            const data = store.increment(key, windowMs, max);

            // Add headers
            if (headers) {
                res.set({
                    'X-RateLimit-Limit': max,
                    'X-RateLimit-Remaining': Math.max(0, max - data.count),
                    'X-RateLimit-Reset': new Date(data.resetTime).toISOString(),
                    'X-RateLimit-Window': windowMs
                });
            }

            // Check if limit exceeded
            if (data.count > max) {
                // Add retry header
                res.set('Retry-After', Math.ceil((data.resetTime - Date.now()) / 1000));

                // Log rate limit exceeded
                logger.warn('Rate limit exceeded', {
                    key,
                    count: data.count,
                    limit: max,
                    windowMs,
                    ip: req.ip,
                    url: req.originalUrl,
                    userAgent: req.get('User-Agent')
                });

                // Call onLimitReached callback
                if (onLimitReached) {
                    onLimitReached(req, res, options);
                }

                return res.status(statusCode).json({
                    success: false,
                    error: message,
                    code: 'RATE_LIMIT_EXCEEDED',
                    retryAfter: Math.ceil((data.resetTime - Date.now()) / 1000),
                    limit: max,
                    window: windowMs,
                    timestamp: new Date().toISOString()
                });
            }

            // Track response to potentially skip counting
            const originalEnd = res.end;
            res.end = function (...args) {
                const shouldSkip = (
                    (skipSuccessfulRequests && res.statusCode < 400) ||
                    (skipFailedRequests && res.statusCode >= 400)
                );

                if (shouldSkip) {
                    // Decrement count if we should skip this request
                    const currentData = store.get(key);
                    if (currentData && currentData.count > 0) {
                        currentData.count--;
                        store.store.set(key, currentData);
                    }
                }

                originalEnd.apply(this, args);
            };

            next();
        } catch (error) {
            logger.error('Rate limit middleware error:', error);
            next(error);
        }
    };
};

/**
 * Session-specific rate limiter
 */
const sessionRateLimit = createRateLimit({
    windowMs: 60000, // 1 minute
    max: 30, // 30 requests per minute per session
    keyGenerator: (req) => {
        const sessionId = req.body?.sessionId || req.params?.sessionId || req.query?.sessionId;
        return sessionId ? `session:${sessionId}:${req.ip}` : req.ip;
    },
    message: 'Too many requests for this session',
    skip: (req) => {
        // Skip rate limiting for health checks
        return req.path === '/health' || req.path === '/api/health';
    }
});

/**
 * IP-based rate limiter
 */
const ipRateLimit = createRateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per 15 minutes per IP
    message: 'Too many requests from this IP',
    keyGenerator: (req) => req.ip
});

/**
 * Auth endpoint rate limiter (stricter)
 */
const authRateLimit = createRateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 auth attempts per 15 minutes
    message: 'Too many authentication attempts',
    keyGenerator: (req) => `auth:${req.ip}`
});

/**
 * File upload rate limiter
 */
const uploadRateLimit = createRateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 uploads per minute
    message: 'Too many file uploads',
    keyGenerator: (req) => `upload:${req.ip}`
});

/**
 * Message sending rate limiter
 */
const messageRateLimit = createRateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 messages per minute
    message: 'Too many messages sent',
    keyGenerator: (req) => {
        const sessionId = req.body?.sessionId || req.params?.sessionId;
        return sessionId ? `message:${sessionId}` : `message:${req.ip}`;
    }
});

/**
 * Webhook rate limiter
 */
const webhookRateLimit = createRateLimit({
    windowMs: 10 * 1000, // 10 seconds
    max: 10, // 10 webhook calls per 10 seconds
    message: 'Too many webhook requests',
    keyGenerator: (req) => {
        const sessionId = req.body?.sessionId || req.params?.sessionId;
        return sessionId ? `webhook:${sessionId}` : `webhook:${req.ip}`;
    }
});

/**
 * Dynamic rate limiter based on user type
 */
const dynamicRateLimit = (options = {}) => {
    return (req, res, next) => {
        // Default limits
        let windowMs = 60000; // 1 minute
        let max = 30; // 30 requests

        // Adjust based on endpoint
        const endpoint = req.route?.path || req.path;

        if (endpoint.includes('/auth/')) {
            max = 10; // Stricter for auth
        } else if (endpoint.includes('/message/')) {
            max = 60; // More lenient for messaging
        } else if (endpoint.includes('/upload')) {
            max = 5; // Very strict for uploads
        }

        // Create dynamic rate limiter
        const rateLimiter = createRateLimit({
            windowMs,
            max,
            ...options
        });

        rateLimiter(req, res, next);
    };
};

/**
 * Get rate limit status for a key
 */
const getRateLimitStatus = (key) => {
    const data = store.get(key);
    if (!data) {
        return null;
    }

    const now = Date.now();
    if (now > data.expires) {
        return null;
    }

    return {
        count: data.count,
        resetTime: data.resetTime,
        remaining: Math.max(0, data.resetTime - now),
        isLimited: data.count > 0
    };
};

/**
 * Reset rate limit for a key
 */
const resetRateLimit = (key) => {
    store.reset(key);
};

/**
 * Get all rate limit stats
 */
const getRateLimitStats = () => {
    const stats = {
        totalKeys: store.size(),
        activeWindows: 0,
        topConsumers: []
    };

    const consumers = [];
    const now = Date.now();

    for (const [key, data] of store.store.entries()) {
        if (data.expires && now <= data.expires) {
            stats.activeWindows++;
            consumers.push({
                key,
                count: data.count,
                resetTime: data.resetTime
            });
        }
    }

    // Sort by count descending and take top 10
    stats.topConsumers = consumers
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    return stats;
};

/**
 * Cleanup expired entries manually
 */
const cleanupRateLimits = () => {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, data] of store.store.entries()) {
        if (data.expires && now > data.expires) {
            store.store.delete(key);
            cleaned++;
        }
    }

    return cleaned;
};

/**
 * Rate limit bypass for testing
 */
const bypassRateLimit = (req, res, next) => {
    if (defaultConfig.server.environment === 'test') {
        return next();
    }

    // Check for bypass header (only in development)
    if (defaultConfig.server.environment === 'development' && req.get('X-Bypass-Rate-Limit')) {
        return next();
    }

    next();
};

module.exports = {
    createRateLimit,
    sessionRateLimit,
    ipRateLimit,
    authRateLimit,
    uploadRateLimit,
    messageRateLimit,
    webhookRateLimit,
    dynamicRateLimit,
    getRateLimitStatus,
    resetRateLimit,
    getRateLimitStats,
    cleanupRateLimits,
    bypassRateLimit,
    store
};