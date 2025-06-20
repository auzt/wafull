const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

// Import konfigurasi dan utils
const { defaultConfig } = require('./config/default');
const { logger } = require('./utils/logger');

// Import middleware
const {
    corsMiddleware,
    validateContentType,
    errorHandler,
    notFoundHandler
} = require('./middleware/auth');

// Import routes
const apiRoutes = require('./routes/index');

// Import services
const sessionManager = require('./services/sessionManager');

class WhatsAppAPIServer {
    constructor() {
        this.app = express();
        this.server = null;
        this.setupDirectories();
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
        this.setupGracefulShutdown();
    }

    /**
     * Setup direktori yang diperlukan
     */
    setupDirectories() {
        const dirs = [
            defaultConfig.session.path,
            defaultConfig.media.uploadPath,
            './logs',
            './data'
        ];

        dirs.forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                logger.info(`Directory created: ${dir}`);
            }
        });
    }

    /**
     * Setup middleware
     */
    setupMiddleware() {
        // Trust proxy (untuk load balancer/reverse proxy)
        this.app.set('trust proxy', true);

        // Security middleware
        this.app.use(helmet({
            contentSecurityPolicy: false,
            crossOriginEmbedderPolicy: false
        }));

        // CORS
        this.app.use(cors({
            origin: true,
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
        }));

        // Rate limiting global
        const limiter = rateLimit({
            windowMs: defaultConfig.security.rateLimitWindowMs,
            max: defaultConfig.security.rateLimitMaxRequests,
            message: {
                success: false,
                error: 'Too many requests, please try again later',
                retryAfter: Math.ceil(defaultConfig.security.rateLimitWindowMs / 1000)
            },
            standardHeaders: true,
            legacyHeaders: false,
            skip: (req) => {
                // Skip rate limiting untuk health check
                return req.path === '/health' || req.path === '/api/health';
            }
        });
        this.app.use(limiter);

        // Body parsing
        this.app.use(express.json({
            limit: '10mb',
            strict: true
        }));
        this.app.use(express.urlencoded({
            extended: true,
            limit: '10mb'
        }));

        // Content type validation
        this.app.use(validateContentType);

        // Request logging
        this.app.use((req, res, next) => {
            const start = Date.now();

            res.on('finish', () => {
                const duration = Date.now() - start;
                const logData = {
                    method: req.method,
                    url: req.originalUrl,
                    status: res.statusCode,
                    duration: `${duration}ms`,
                    ip: req.ip,
                    userAgent: req.get('User-Agent')
                };

                if (res.statusCode >= 400) {
                    logger.warn('HTTP Request', logData);
                } else {
                    logger.info('HTTP Request', logData);
                }
            });

            next();
        });
    }

    /**
     * Setup routes
     */
    setupRoutes() {
        // Health check endpoint (tanpa auth)
        this.app.get('/health', (req, res) => {
            const uptime = process.uptime();
            const memoryUsage = process.memoryUsage();
            const sessions = sessionManager.getAllSessionsInfo();

            res.json({
                success: true,
                message: 'WhatsApp API is running',
                data: {
                    status: 'healthy',
                    uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
                    memory: {
                        used: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
                        total: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`
                    },
                    sessions: {
                        total: sessions.length,
                        connected: sessions.filter(s => s.connected).length
                    },
                    environment: defaultConfig.server.environment,
                    version: '1.0.0',
                    timestamp: new Date().toISOString()
                }
            });
        });

        // Static files untuk QR codes dan media
        this.app.use('/qr', express.static(path.join(__dirname, 'data/sessions')));
        this.app.use('/media', express.static(path.join(__dirname, 'data/uploads')));

        // API routes
        this.app.use('/api', apiRoutes);

        // Root endpoint
        this.app.get('/', (req, res) => {
            res.json({
                success: true,
                message: 'Welcome to WhatsApp API',
                data: {
                    version: '1.0.0',
                    environment: defaultConfig.server.environment,
                    documentation: '/api/docs',
                    health: '/health',
                    endpoints: {
                        api: '/api',
                        auth: '/api/auth',
                        message: '/api/message',
                        group: '/api/group',
                        contact: '/api/contact',
                        status: '/api/status',
                        webhook: '/api/webhook'
                    },
                    timestamp: new Date().toISOString()
                }
            });
        });
    }

    /**
     * Setup error handling
     */
    setupErrorHandling() {
        // 404 handler
        this.app.use(notFoundHandler);

        // Global error handler
        this.app.use(errorHandler);

        // Unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled Rejection at:', { promise, reason });
        });

        // Uncaught exceptions
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught Exception:', error);

            // Graceful shutdown on critical errors
            if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
                logger.error('Critical error, shutting down...');
                this.shutdown();
            }
        });
    }

    /**
     * Setup graceful shutdown
     */
    setupGracefulShutdown() {
        const shutdown = async (signal) => {
            logger.info(`Received ${signal}, starting graceful shutdown...`);

            try {
                // Stop accepting new connections
                if (this.server) {
                    this.server.close((err) => {
                        if (err) {
                            logger.error('Error closing server:', err);
                        } else {
                            logger.info('HTTP server closed');
                        }
                    });
                }

                // Disconnect all WhatsApp sessions
                const sessionIds = sessionManager.getAllSessionIds();
                logger.info(`Disconnecting ${sessionIds.length} sessions...`);

                for (const sessionId of sessionIds) {
                    try {
                        const sock = sessionManager.getSession(sessionId);
                        if (sock && sock.end) {
                            await sock.end();
                            logger.info(`Session ${sessionId} disconnected`);
                        }
                    } catch (error) {
                        logger.error(`Error disconnecting session ${sessionId}:`, error);
                    }
                }

                logger.info('Graceful shutdown completed');
                process.exit(0);

            } catch (error) {
                logger.error('Error during shutdown:', error);
                process.exit(1);
            }
        };

        // Handle shutdown signals
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGUSR2', () => shutdown('SIGUSR2')); // nodemon restart
    }

    /**
     * Start server
     */
    async start() {
        try {
            const port = defaultConfig.server.port;

            // Load existing sessions
            logger.info('Loading existing sessions...');
            sessionManager.loadExistingSessions();

            // Start HTTP server
            this.server = this.app.listen(port, () => {
                logger.info(`WhatsApp API Server started on port ${port}`);
                logger.info(`Environment: ${defaultConfig.server.environment}`);
                logger.info(`Health check: http://localhost:${port}/health`);
                logger.info(`API Documentation: http://localhost:${port}/api/docs`);
                logger.info(`Server ready to accept connections`);
            });

            // Handle server errors
            this.server.on('error', (error) => {
                if (error.code === 'EADDRINUSE') {
                    logger.error(`Port ${port} is already in use`);
                } else if (error.code === 'EACCES') {
                    logger.error(`Permission denied to bind to port ${port}`);
                } else {
                    logger.error('Server error:', error);
                }
                process.exit(1);
            });

            // Setup cleanup for inactive sessions (every hour)
            setInterval(() => {
                logger.info('Running session cleanup...');
                sessionManager.cleanupInactiveSessions();
            }, 60 * 60 * 1000);

            // Memory monitoring
            setInterval(() => {
                const memoryUsage = process.memoryUsage();
                const memoryMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);

                if (memoryMB > 500) { // Alert if memory usage > 500MB
                    logger.warn('High memory usage detected', {
                        heapUsed: `${memoryMB}MB`,
                        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`
                    });
                }
            }, 5 * 60 * 1000); // Check every 5 minutes

        } catch (error) {
            logger.error('Failed to start server:', error);
            process.exit(1);
        }
    }

    /**
     * Manual shutdown
     */
    async shutdown() {
        logger.info('Manual shutdown initiated...');
        process.emit('SIGTERM');
    }

    /**
     * Get Express app instance
     */
    getApp() {
        return this.app;
    }

    /**
     * Get server instance
     */
    getServer() {
        return this.server;
    }
}

// Create and start server
const whatsappAPIServer = new WhatsAppAPIServer();

// Start server if this file is run directly
if (require.main === module) {
    whatsappAPIServer.start().catch(error => {
        logger.error('Failed to start WhatsApp API Server:', error);
        process.exit(1);
    });
}

// Export untuk testing atau external use
module.exports = whatsappAPIServer;