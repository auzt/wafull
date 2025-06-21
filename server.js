/**
 * Wh32tsApp API Backend Server
 * Entry point untuk aplikasi
 */

// Load environment variables first
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Import internal modules
const { defaultConfig } = require('./config/default');
const { initializeDatabase, testConnection } = require('./config/database');
const { logger } = require('./utils/logger');
const sessionManager = require('./services/sessionManager');
const whatsappService = require('./services/whatsappService');

// Import middleware
const {
    corsMiddleware,
    logRequest,
    requestTimeout,
    errorHandler,
    notFoundHandler
} = require('./middleware/auth');

const {
    errorHandler: globalErrorHandler,
    handleUncaughtException,
    handleUnhandledRejection
} = require('./middleware/error');

// Import routes
const apiRoutes = require('./routes');

class WhatsAppAPIServer {
    constructor() {
        this.app = express();
        this.server = null;
        this.setupGlobalErrorHandlers();
    }

    /**
     * Setup global error handlers
     */
    setupGlobalErrorHandlers() {
        process.on('uncaughtException', handleUncaughtException);
        process.on('unhandledRejection', handleUnhandledRejection);

        process.on('SIGTERM', this.gracefulShutdown.bind(this));
        process.on('SIGINT', this.gracefulShutdown.bind(this));
    }

    /**
     * Initialize database
     */
    async initializeDatabase() {
        try {
            logger.info('Connecting to database...');

            const isConnected = await testConnection();
            if (!isConnected) {
                throw new Error('Failed to connect to database');
            }

            await initializeDatabase();
            logger.info('Database initialized successfully');
        } catch (error) {
            logger.error('Database initialization failed:', error);
            throw error;
        }
    }

    /**
     * Setup middleware
     */
    setupMiddleware() {
        // Trust proxy jika di belakang proxy (nginx, cloudflare, etc)
        if (defaultConfig.server.environment === 'production') {
            this.app.set('trust proxy', 1);
        }

        // Security middleware
        this.app.use(helmet({
            contentSecurityPolicy: false, // Disable for API
            crossOriginEmbedderPolicy: false
        }));

        // Compression
        this.app.use(compression());

        // CORS
        this.app.use(corsMiddleware);

        // Body parsing
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

        // Request logging
        this.app.use(logRequest);

        // Global rate limiting
        const limiter = rateLimit({
            windowMs: defaultConfig.security.rateLimitWindowMs,
            max: defaultConfig.security.rateLimitMaxRequests,
            message: {
                success: false,
                error: 'Too many requests, please try again later',
                retryAfter: Math.ceil(defaultConfig.security.rateLimitWindowMs / 1000)
            },
            standardHeaders: true,
            legacyHeaders: false
        });
        this.app.use(limiter);

        // Request timeout
        this.app.use(requestTimeout(30000)); // 30 detik

        // Static files untuk media
        this.app.use('/media', express.static(path.join(__dirname, 'data/uploads')));

        logger.info('Middleware setup completed');
    }

    /**
     * Setup routes
     */
    setupRoutes() {
        // Health check endpoint
        this.app.get('/health', (req, res) => {
            const utilityService = require('./services/utilityService');
            const health = utilityService.getSystemHealth();

            res.status(health.status === 'healthy' ? 200 : 503).json({
                success: true,
                message: 'Health check',
                data: health
            });
        });

        // Root endpoint
        this.app.get('/', (req, res) => {
            res.json({
                success: true,
                message: 'WhatsApp API Backend',
                version: '1.0.0',
                timestamp: new Date().toISOString(),
                documentation: '/api/docs',
                health: '/health'
            });
        });

        // API routes
        this.app.use('/api', apiRoutes);

        // 404 handler
        this.app.use(notFoundHandler);

        // Error handler
        this.app.use(globalErrorHandler);

        logger.info('Routes setup completed');
    }

    /**
     * Load existing sessions
     */
    async loadExistingSessions() {
        try {
            logger.info('Loading existing sessions...');

            // Load sessions dari disk
            sessionManager.loadExistingSessions();

            const sessionIds = sessionManager.getAllSessionIds();
            logger.info(`Found ${sessionIds.length} existing sessions`);

            // Auto-reconnect sessions yang sebelumnya connected (optional)
            if (process.env.AUTO_RECONNECT === 'true') {
                for (const sessionId of sessionIds) {
                    try {
                        await whatsappService.createConnection(sessionId);
                        logger.info(`Auto-reconnecting session: ${sessionId}`);

                        // Delay antar koneksi untuk menghindari rate limit
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    } catch (error) {
                        logger.warn(`Failed to auto-reconnect session ${sessionId}:`, error.message);
                    }
                }
            }

        } catch (error) {
            logger.error('Error loading existing sessions:', error);
        }
    }

    /**
     * Setup cleanup tasks
     */
    setupCleanupTasks() {
        const cron = require('node-cron');

        // Cleanup sessions tidak aktif setiap hari jam 2 pagi
        cron.schedule('0 2 * * *', () => {
            logger.info('Running daily cleanup tasks...');
            sessionManager.cleanupInactiveSessions();
        });

        // Cleanup old media files setiap minggu
        cron.schedule('0 3 * * 0', async () => {
            try {
                const mediaService = require('./services/mediaService');
                await mediaService.cleanupOldFiles(30); // 30 hari
                logger.info('Old media files cleanup completed');
            } catch (error) {
                logger.error('Error during media cleanup:', error);
            }
        });

        // Backup database setiap hari jam 1 pagi (jika enabled)
        if (process.env.BACKUP_ENABLED === 'true') {
            cron.schedule('0 1 * * *', async () => {
                try {
                    const { backupDatabase } = require('./config/database');
                    await backupDatabase();
                    logger.info('Daily database backup completed');
                } catch (error) {
                    logger.error('Error during database backup:', error);
                }
            });
        }

        logger.info('Cleanup tasks scheduled');
    }

    /**
     * Start server
     */
    async start() {
        try {
            logger.info('Starting WhatsApp API Backend...');
            logger.info(`Environment: ${defaultConfig.server.environment}`);
            logger.info(`Node version: ${process.version}`);

            // Initialize database
            await this.initializeDatabase();

            // Setup middleware
            this.setupMiddleware();

            // Setup routes
            this.setupRoutes();

            // Load existing sessions
            await this.loadExistingSessions();

            // Setup cleanup tasks
            this.setupCleanupTasks();

            // Start HTTP server
            const port = defaultConfig.server.port;
            this.server = this.app.listen(port, () => {
                logger.info(`🚀 Server running on port ${port}`);
                logger.info(`📚 API Documentation: http://localhost:${port}/api/docs`);
                logger.info(`❤️  Health Check: http://localhost:${port}/health`);

                if (defaultConfig.server.environment === 'development') {
                    logger.info(`🔧 Development mode enabled`);
                    logger.info(`📝 Logs directory: ./logs/`);
                    logger.info(`💾 Data directory: ./data/`);
                }
            });

            this.server.on('error', (error) => {
                if (error.syscall !== 'listen') {
                    throw error;
                }

                const bind = typeof port === 'string' ? 'Pipe ' + port : 'Port ' + port;

                switch (error.code) {
                    case 'EACCES':
                        logger.error(`${bind} requires elevated privileges`);
                        process.exit(1);
                        break;
                    case 'EADDRINUSE':
                        logger.error(`${bind} is already in use`);
                        process.exit(1);
                        break;
                    default:
                        throw error;
                }
            });

        } catch (error) {
            logger.error('Failed to start server:', error);
            process.exit(1);
        }
    }

    /**
     * Graceful shutdown
     */
    async gracefulShutdown(signal) {
        logger.info(`Received ${signal}. Starting graceful shutdown...`);

        try {
            // Stop accepting new connections
            if (this.server) {
                this.server.close(() => {
                    logger.info('HTTP server closed');
                });
            }

            // Close all active WhatsApp sessions
            const sessionIds = sessionManager.getAllSessionIds();
            logger.info(`Closing ${sessionIds.length} active sessions...`);

            for (const sessionId of sessionIds) {
                try {
                    const session = sessionManager.getSession(sessionId);
                    if (session && session.end) {
                        await session.end();
                    }
                } catch (error) {
                    logger.warn(`Error closing session ${sessionId}:`, error.message);
                }
            }

            // Close database connection
            const { closeConnection } = require('./config/database');
            await closeConnection();

            logger.info('Graceful shutdown completed');
            process.exit(0);

        } catch (error) {
            logger.error('Error during graceful shutdown:', error);
            process.exit(1);
        }
    }

    /**
     * Get application instance
     */
    getApp() {
        return this.app;
    }
}

// Start server jika file ini dijalankan langsung
if (require.main === module) {
    const server = new WhatsAppAPIServer();
    server.start().catch((error) => {
        logger.error('Failed to start application:', error);
        process.exit(1);
    });
}

module.exports = WhatsAppAPIServer;a