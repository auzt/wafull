const { defaultConfig } = require('../config/default');
const { logger } = require('../utils/logger');

/**
 * Middleware untuk validasi API Key
 */
const validateApiKey = (req, res, next) => {
    try {
        const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

        if (!apiKey) {
            return res.status(401).json({
                success: false,
                error: 'API Key is required'
            });
        }

        if (apiKey !== defaultConfig.server.apiKey) {
            logger.warn('Invalid API key attempt', {
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                providedKey: apiKey.substring(0, 8) + '...'
            });

            return res.status(401).json({
                success: false,
                error: 'Invalid API Key'
            });
        }

        next();
    } catch (error) {
        logger.error('Error in validateApiKey middleware:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
};

/**
 * Middleware untuk log request
 */
const logRequest = (req, res, next) => {
    const start = Date.now();

    // Log request
    logger.info(`${req.method} ${req.originalUrl}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        sessionId: req.body?.sessionId || req.params?.sessionId,
        contentLength: req.get('Content-Length')
    });

    // Log response when finished
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info(`${req.method} ${req.originalUrl} - ${res.statusCode}`, {
            duration: `${duration}ms`,
            contentLength: res.get('Content-Length')
        });
    });

    next();
};

/**
 * Middleware untuk CORS
 */
const corsMiddleware = (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-api-key');
    res.header('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
};

/**
 * Middleware untuk validasi content type
 */
const validateContentType = (req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT') {
        const contentType = req.get('Content-Type');

        if (!contentType) {
            return res.status(400).json({
                success: false,
                error: 'Content-Type header is required'
            });
        }

        if (!contentType.includes('application/json') && !contentType.includes('multipart/form-data')) {
            return res.status(400).json({
                success: false,
                error: 'Content-Type must be application/json or multipart/form-data'
            });
        }
    }

    next();
};

/**
 * Middleware untuk sanitasi input
 */
const sanitizeInput = (req, res, next) => {
    // Sanitasi body
    if (req.body) {
        req.body = sanitizeObject(req.body);
    }

    // Sanitasi query
    if (req.query) {
        req.query = sanitizeObject(req.query);
    }

    // Sanitasi params
    if (req.params) {
        req.params = sanitizeObject(req.params);
    }

    next();
};

/**
 * Fungsi helper untuk sanitasi object
 */
const sanitizeObject = (obj) => {
    if (typeof obj !== 'object' || obj === null) {
        return obj;
    }

    const sanitized = {};

    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
            // Remove HTML tags and dangerous characters
            sanitized[key] = value
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/<[^>]*>?/gm, '')
                .trim();
        } else if (typeof value === 'object' && value !== null) {
            sanitized[key] = sanitizeObject(value);
        } else {
            sanitized[key] = value;
        }
    }

    return sanitized;
};

/**
 * Middleware untuk rate limiting per session
 */
const sessionRateLimit = (req, res, next) => {
    const sessionId = req.body?.sessionId || req.params?.sessionId;

    if (!sessionId) {
        return next();
    }

    const now = Date.now();
    const windowMs = 60000; // 1 menit
    const maxRequests = 30; // maksimal 30 request per menit per session

    if (!sessionRateLimit.requests) {
        sessionRateLimit.requests = new Map();
    }

    const sessionRequests = sessionRateLimit.requests.get(sessionId) || [];

    // Remove old requests
    const validRequests = sessionRequests.filter(time => now - time < windowMs);

    if (validRequests.length >= maxRequests) {
        return res.status(429).json({
            success: false,
            error: `Rate limit exceeded for session ${sessionId}. Max ${maxRequests} requests per minute.`,
            retryAfter: Math.ceil(windowMs / 1000)
        });
    }

    // Add current request
    validRequests.push(now);
    sessionRateLimit.requests.set(sessionId, validRequests);

    next();
};

/**
 * Middleware untuk validasi required fields
 */
const validateRequired = (fields) => {
    return (req, res, next) => {
        const missing = [];

        fields.forEach(field => {
            if (field.includes('.')) {
                // Nested field validation
                const keys = field.split('.');
                let current = req.body;

                for (const key of keys) {
                    if (!current || current[key] === undefined || current[key] === null) {
                        missing.push(field);
                        break;
                    }
                    current = current[key];
                }
            } else {
                // Simple field validation
                if (req.body[field] === undefined || req.body[field] === null || req.body[field] === '') {
                    missing.push(field);
                }
            }
        });

        if (missing.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                missingFields: missing
            });
        }

        next();
    };
};

/**
 * Middleware untuk timeout request
 */
const requestTimeout = (timeoutMs = 30000) => {
    return (req, res, next) => {
        const timeout = setTimeout(() => {
            if (!res.headersSent) {
                res.status(408).json({
                    success: false,
                    error: 'Request timeout'
                });
            }
        }, timeoutMs);

        res.on('finish', () => {
            clearTimeout(timeout);
        });

        next();
    };
};

/**
 * Error handling middleware
 */
const errorHandler = (err, req, res, next) => {
    logger.error('Request error:', {
        error: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        sessionId: req.body?.sessionId || req.params?.sessionId
    });

    // Multer error (file upload)
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
            success: false,
            error: 'File too large'
        });
    }

    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
            success: false,
            error: 'Unexpected file field'
        });
    }

    // JSON parsing error
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({
            success: false,
            error: 'Invalid JSON format'
        });
    }

    // Default error
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
};

/**
 * 404 handler
 */
const notFoundHandler = (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.originalUrl,
        method: req.method
    });
};

module.exports = {
    validateApiKey,
    logRequest,
    corsMiddleware,
    validateContentType,
    sanitizeInput,
    sessionRateLimit,
    validateRequired,
    requestTimeout,
    errorHandler,
    notFoundHandler
};