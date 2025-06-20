const { logger } = require('../utils/logger');
const { defaultConfig } = require('../config/default');

/**
 * Custom error classes
 */
class APIError extends Error {
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
        super(message);
        this.name = 'APIError';
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

class ValidationError extends APIError {
    constructor(message, details = null) {
        super(message, 400, 'VALIDATION_ERROR', details);
        this.name = 'ValidationError';
    }
}

class AuthenticationError extends APIError {
    constructor(message = 'Authentication failed') {
        super(message, 401, 'AUTHENTICATION_ERROR');
        this.name = 'AuthenticationError';
    }
}

class AuthorizationError extends APIError {
    constructor(message = 'Access denied') {
        super(message, 403, 'AUTHORIZATION_ERROR');
        this.name = 'AuthorizationError';
    }
}

class NotFoundError extends APIError {
    constructor(resource = 'Resource') {
        super(`${resource} not found`, 404, 'NOT_FOUND');
        this.name = 'NotFoundError';
    }
}

class ConflictError extends APIError {
    constructor(message = 'Resource conflict') {
        super(message, 409, 'CONFLICT_ERROR');
        this.name = 'ConflictError';
    }
}

class RateLimitError extends APIError {
    constructor(message = 'Rate limit exceeded') {
        super(message, 429, 'RATE_LIMIT_ERROR');
        this.name = 'RateLimitError';
    }
}

class SessionError extends APIError {
    constructor(message = 'Session error', sessionId = null) {
        super(message, 400, 'SESSION_ERROR');
        this.name = 'SessionError';
        this.sessionId = sessionId;
    }
}

class WhatsAppError extends APIError {
    constructor(message = 'WhatsApp service error', sessionId = null) {
        super(message, 500, 'WHATSAPP_ERROR');
        this.name = 'WhatsAppError';
        this.sessionId = sessionId;
    }
}

class WebhookError extends APIError {
    constructor(message = 'Webhook error', url = null) {
        super(message, 500, 'WEBHOOK_ERROR');
        this.name = 'WebhookError';
        this.webhookUrl = url;
    }
}

/**
 * Error handler middleware
 */
const errorHandler = (err, req, res, next) => {
    // Log error
    const errorInfo = {
        error: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        sessionId: req.body?.sessionId || req.params?.sessionId,
        timestamp: new Date().toISOString()
    };

    if (err.isOperational) {
        logger.warn('Operational error:', errorInfo);
    } else {
        logger.error('Unexpected error:', errorInfo);
    }

    // Default error response
    let response = {
        success: false,
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString()
    };

    // Handle specific error types
    if (err instanceof APIError) {
        response.error = err.message;
        response.code = err.code;

        if (err.details) {
            response.details = err.details;
        }

        if (err.sessionId) {
            response.sessionId = err.sessionId;
        }

        if (err.webhookUrl) {
            response.webhookUrl = err.webhookUrl;
        }

        return res.status(err.statusCode).json(response);
    }

    // Handle Sequelize errors
    if (err.name === 'SequelizeValidationError') {
        response.error = 'Validation error';
        response.code = 'VALIDATION_ERROR';
        response.details = err.errors.map(e => ({
            field: e.path,
            message: e.message,
            value: e.value
        }));
        return res.status(400).json(response);
    }

    if (err.name === 'SequelizeUniqueConstraintError') {
        response.error = 'Duplicate entry';
        response.code = 'DUPLICATE_ERROR';
        response.details = err.errors.map(e => ({
            field: e.path,
            message: e.message
        }));
        return res.status(409).json(response);
    }

    if (err.name === 'SequelizeForeignKeyConstraintError') {
        response.error = 'Foreign key constraint error';
        response.code = 'CONSTRAINT_ERROR';
        return res.status(400).json(response);
    }

    if (err.name === 'SequelizeDatabaseError') {
        response.error = 'Database error';
        response.code = 'DATABASE_ERROR';
        return res.status(500).json(response);
    }

    // Handle Joi validation errors
    if (err.isJoi) {
        response.error = 'Validation error';
        response.code = 'VALIDATION_ERROR';
        response.details = err.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message,
            value: detail.context?.value
        }));
        return res.status(400).json(response);
    }

    // Handle Multer errors (file upload)
    if (err.code === 'LIMIT_FILE_SIZE') {
        response.error = 'File too large';
        response.code = 'FILE_TOO_LARGE';
        return res.status(400).json(response);
    }

    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        response.error = 'Unexpected file field';
        response.code = 'UNEXPECTED_FILE';
        return res.status(400).json(response);
    }

    if (err.code === 'LIMIT_FILE_COUNT') {
        response.error = 'Too many files';
        response.code = 'TOO_MANY_FILES';
        return res.status(400).json(response);
    }

    // Handle JSON parsing errors
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        response.error = 'Invalid JSON format';
        response.code = 'INVALID_JSON';
        return res.status(400).json(response);
    }

    // Handle axios/HTTP errors
    if (err.isAxiosError) {
        response.error = 'External service error';
        response.code = 'EXTERNAL_SERVICE_ERROR';
        response.details = {
            url: err.config?.url,
            method: err.config?.method,
            status: err.response?.status,
            statusText: err.response?.statusText
        };
        return res.status(502).json(response);
    }

    // Handle timeout errors
    if (err.code === 'ETIMEDOUT' || err.timeout) {
        response.error = 'Request timeout';
        response.code = 'TIMEOUT_ERROR';
        return res.status(408).json(response);
    }

    // Handle connection errors
    if (err.code === 'ECONNREFUSED') {
        response.error = 'Connection refused';
        response.code = 'CONNECTION_ERROR';
        return res.status(503).json(response);
    }

    if (err.code === 'ENOTFOUND') {
        response.error = 'Service not found';
        response.code = 'SERVICE_NOT_FOUND';
        return res.status(503).json(response);
    }

    // Include stack trace in development
    if (defaultConfig.server.environment === 'development') {
        response.stack = err.stack;
    }

    // Default 500 error
    res.status(500).json(response);
};

/**
 * Async error wrapper
 */
const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

/**
 * Not found handler
 */
const notFoundHandler = (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        code: 'NOT_FOUND',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString(),
        availableEndpoints: [
            'GET /health',
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
};

/**
 * Global error handler for uncaught exceptions
 */
const handleUncaughtException = (error) => {
    logger.error('Uncaught Exception:', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
    });

    // Graceful shutdown
    process.exit(1);
};

/**
 * Global error handler for unhandled promise rejections
 */
const handleUnhandledRejection = (reason, promise) => {
    logger.error('Unhandled Promise Rejection:', {
        reason: reason,
        promise: promise,
        timestamp: new Date().toISOString()
    });

    // Graceful shutdown
    process.exit(1);
};

/**
 * Error factory functions
 */
const createError = {
    validation: (message, details) => new ValidationError(message, details),
    authentication: (message) => new AuthenticationError(message),
    authorization: (message) => new AuthorizationError(message),
    notFound: (resource) => new NotFoundError(resource),
    conflict: (message) => new ConflictError(message),
    rateLimit: (message) => new RateLimitError(message),
    session: (message, sessionId) => new SessionError(message, sessionId),
    whatsapp: (message, sessionId) => new WhatsAppError(message, sessionId),
    webhook: (message, url) => new WebhookError(message, url),
    api: (message, statusCode, code, details) => new APIError(message, statusCode, code, details)
};

/**
 * Error response helper
 */
const sendError = (res, error, statusCode = 500) => {
    const response = {
        success: false,
        error: error instanceof Error ? error.message : error,
        code: error.code || 'UNKNOWN_ERROR',
        timestamp: new Date().toISOString()
    };

    if (error.details) {
        response.details = error.details;
    }

    res.status(statusCode).json(response);
};

module.exports = {
    // Error classes
    APIError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    ConflictError,
    RateLimitError,
    SessionError,
    WhatsAppError,
    WebhookError,

    // Middleware
    errorHandler,
    asyncHandler,
    notFoundHandler,

    // Global handlers
    handleUncaughtException,
    handleUnhandledRejection,

    // Utilities
    createError,
    sendError
};