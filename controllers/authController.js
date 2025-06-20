const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');

const sessionManager = require('../services/sessionManager');
const whatsappService = require('../services/whatsappService');
const { logger, logWithSession } = require('../utils/logger');
const { validateConfig } = require('../config/default');

class AuthController {

    /**
     * Create new session
     * POST /api/auth/create-session
     */
    async createSession(req, res) {
        try {
            const { sessionId, config = {} } = req.body;

            // Validasi konfigurasi jika ada
            if (Object.keys(config).length > 0) {
                const configErrors = validateConfig(config);
                if (configErrors.length > 0) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid configuration',
                        details: configErrors
                    });
                }
            }

            // Buat session
            const newSessionId = sessionManager.createSession(sessionId, config);

            logWithSession('info', 'Session created via API', newSessionId);

            res.json({
                success: true,
                message: 'Session created successfully',
                data: {
                    sessionId: newSessionId,
                    config: sessionManager.getSessionConfig(newSessionId),
                    state: sessionManager.getSessionState(newSessionId)
                }
            });

        } catch (error) {
            if (error.message.includes('sudah ada')) {
                return res.status(409).json({
                    success: false,
                    error: error.message
                });
            }

            logger.error('Error in createSession:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Connect session (start WhatsApp connection)
     * POST /api/auth/connect
     */
    async connect(req, res) {
        try {
            const { sessionId, config = {} } = req.body;

            if (!sessionId) {
                return res.status(400).json({
                    success: false,
                    error: 'sessionId is required'
                });
            }

            // Cek apakah session sudah ada
            if (!sessionManager.hasSession(sessionId)) {
                // Buat session baru jika belum ada
                sessionManager.createSession(sessionId, config);
            } else {
                // Update config jika session sudah ada
                if (Object.keys(config).length > 0) {
                    sessionManager.updateSessionConfig(sessionId, config);
                }
            }

            // Cek apakah sudah terhubung
            if (sessionManager.isSessionConnected(sessionId)) {
                return res.json({
                    success: true,
                    message: 'Session already connected',
                    data: {
                        sessionId: sessionId,
                        state: 'CONNECTED',
                        user: sessionManager.getSession(sessionId).user
                    }
                });
            }

            // Start connection
            await whatsappService.createConnection(sessionId, config);

            logWithSession('info', 'Connection started via API', sessionId);

            res.json({
                success: true,
                message: 'Connection started successfully',
                data: {
                    sessionId: sessionId,
                    state: sessionManager.getSessionState(sessionId),
                    message: 'Please scan QR code or wait for pairing code'
                }
            });

        } catch (error) {
            logger.error('Error in connect:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Get QR Code untuk login
     * GET /api/auth/qr/:sessionId
     */
    async getQRCode(req, res) {
        try {
            const { sessionId } = req.params;
            const { format = 'base64' } = req.query;

            if (!sessionManager.hasSession(sessionId)) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            const state = sessionManager.getSessionState(sessionId);

            if (state === 'CONNECTED') {
                return res.json({
                    success: false,
                    error: 'Session already connected',
                    data: {
                        sessionId: sessionId,
                        state: state
                    }
                });
            }

            // Cek apakah QR code file sudah ada
            const qrPath = path.join(sessionManager.getSessionPath(sessionId), 'qr.png');

            if (!fs.existsSync(qrPath)) {
                return res.status(404).json({
                    success: false,
                    error: 'QR code not generated yet. Please start connection first.',
                    data: {
                        sessionId: sessionId,
                        state: state
                    }
                });
            }

            if (format === 'image') {
                // Return QR sebagai image
                res.setHeader('Content-Type', 'image/png');
                res.sendFile(path.resolve(qrPath));
            } else {
                // Return QR sebagai base64
                const qrBuffer = fs.readFileSync(qrPath);
                const qrBase64 = qrBuffer.toString('base64');

                res.json({
                    success: true,
                    message: 'QR code retrieved',
                    data: {
                        sessionId: sessionId,
                        qr: `data:image/png;base64,${qrBase64}`,
                        state: state,
                        expiresIn: '60 seconds'
                    }
                });
            }

        } catch (error) {
            logger.error('Error in getQRCode:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Get session status
     * GET /api/auth/status/:sessionId
     */
    async getSessionStatus(req, res) {
        try {
            const { sessionId } = req.params;

            if (!sessionManager.hasSession(sessionId)) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            const state = sessionManager.getSessionState(sessionId);
            const config = sessionManager.getSessionConfig(sessionId);
            const sock = sessionManager.getSession(sessionId);

            const responseData = {
                sessionId: sessionId,
                state: state,
                connected: sessionManager.isSessionConnected(sessionId),
                config: config
            };

            // Tambahkan user info jika terhubung
            if (sock && sock.user) {
                responseData.user = {
                    jid: sock.user.id,
                    name: sock.user.name,
                    phone: sock.user.id.split('@')[0]
                };
            }

            // Tambahkan QR info jika sedang generate QR
            if (state === 'QR_GENERATED') {
                const qrPath = path.join(sessionManager.getSessionPath(sessionId), 'qr.png');
                responseData.qrAvailable = fs.existsSync(qrPath);
            }

            res.json({
                success: true,
                message: 'Session status retrieved',
                data: responseData
            });

        } catch (error) {
            logger.error('Error in getSessionStatus:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Disconnect session
     * POST /api/auth/disconnect
     */
    async disconnect(req, res) {
        try {
            const { sessionId } = req.body;

            if (!sessionId) {
                return res.status(400).json({
                    success: false,
                    error: 'sessionId is required'
                });
            }

            if (!sessionManager.hasSession(sessionId)) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            const sock = sessionManager.getSession(sessionId);

            if (sock && sock.end) {
                await sock.end();
            }

            sessionManager.setSessionState(sessionId, 'DISCONNECTED');

            logWithSession('info', 'Session disconnected via API', sessionId);

            res.json({
                success: true,
                message: 'Session disconnected successfully',
                data: {
                    sessionId: sessionId,
                    state: 'DISCONNECTED'
                }
            });

        } catch (error) {
            logger.error('Error in disconnect:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Logout session (disconnect + delete session data)
     * POST /api/auth/logout
     */
    async logout(req, res) {
        try {
            const { sessionId, deleteFiles = false } = req.body;

            if (!sessionId) {
                return res.status(400).json({
                    success: false,
                    error: 'sessionId is required'
                });
            }

            if (!sessionManager.hasSession(sessionId)) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            const sock = sessionManager.getSession(sessionId);

            // Logout dari WhatsApp
            if (sock && sock.logout) {
                await sock.logout();
            } else if (sock && sock.end) {
                await sock.end();
            }

            // Delete session
            await sessionManager.deleteSession(sessionId, deleteFiles);

            logWithSession('info', 'Session logged out via API', sessionId, { deleteFiles });

            res.json({
                success: true,
                message: 'Session logged out successfully',
                data: {
                    sessionId: sessionId,
                    filesDeleted: deleteFiles
                }
            });

        } catch (error) {
            logger.error('Error in logout:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Get all sessions
     * GET /api/auth/sessions
     */
    async getAllSessions(req, res) {
        try {
            const sessions = sessionManager.getAllSessionsInfo();

            res.json({
                success: true,
                message: 'Sessions retrieved',
                data: {
                    total: sessions.length,
                    connected: sessions.filter(s => s.connected).length,
                    sessions: sessions
                }
            });

        } catch (error) {
            logger.error('Error in getAllSessions:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Update session config
     * PUT /api/auth/config
     */
    async updateSessionConfig(req, res) {
        try {
            const { sessionId, config } = req.body;

            if (!sessionId || !config) {
                return res.status(400).json({
                    success: false,
                    error: 'sessionId and config are required'
                });
            }

            if (!sessionManager.hasSession(sessionId)) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            // Validasi konfigurasi
            const configErrors = validateConfig(config);
            if (configErrors.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid configuration',
                    details: configErrors
                });
            }

            // Update config
            sessionManager.updateSessionConfig(sessionId, config);

            logWithSession('info', 'Session config updated via API', sessionId, { config });

            res.json({
                success: true,
                message: 'Session config updated successfully',
                data: {
                    sessionId: sessionId,
                    config: sessionManager.getSessionConfig(sessionId)
                }
            });

        } catch (error) {
            logger.error('Error in updateSessionConfig:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Get pairing code
     * POST /api/auth/pairing-code
     */
    async getPairingCode(req, res) {
        try {
            const { sessionId, phoneNumber } = req.body;

            if (!sessionId || !phoneNumber) {
                return res.status(400).json({
                    success: false,
                    error: 'sessionId and phoneNumber are required'
                });
            }

            if (!sessionManager.hasSession(sessionId)) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            const sock = sessionManager.getSession(sessionId);
            if (!sock) {
                return res.status(400).json({
                    success: false,
                    error: 'Session not connected'
                });
            }

            // Request pairing code
            const pairingCode = await sock.requestPairingCode(phoneNumber);

            logWithSession('info', 'Pairing code requested via API', sessionId, { phoneNumber });

            res.json({
                success: true,
                message: 'Pairing code generated',
                data: {
                    sessionId: sessionId,
                    phoneNumber: phoneNumber,
                    pairingCode: pairingCode,
                    expiresIn: '60 seconds'
                }
            });

        } catch (error) {
            logger.error('Error in getPairingCode:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Check if number exists on WhatsApp
     * POST /api/auth/check-number
     */
    async checkNumber(req, res) {
        try {
            const { sessionId, phone } = req.body;

            if (!sessionId || !phone) {
                return res.status(400).json({
                    success: false,
                    error: 'sessionId and phone are required'
                });
            }

            if (!sessionManager.hasSession(sessionId)) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            if (!sessionManager.isSessionConnected(sessionId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Session not connected'
                });
            }

            // Check number
            const result = await whatsappService.checkNumber(sessionId, phone);

            logWithSession('info', 'Number checked via API', sessionId, { phone, exists: result.exists });

            res.json({
                success: true,
                message: 'Number check completed',
                data: {
                    phone: phone,
                    ...result
                }
            });

        } catch (error) {
            logger.error('Error in checkNumber:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Restart session
     * POST /api/auth/restart
     */
    async restartSession(req, res) {
        try {
            const { sessionId } = req.body;

            if (!sessionId) {
                return res.status(400).json({
                    success: false,
                    error: 'sessionId is required'
                });
            }

            if (!sessionManager.hasSession(sessionId)) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            const config = sessionManager.getSessionConfig(sessionId);

            // Disconnect current session
            const sock = sessionManager.getSession(sessionId);
            if (sock && sock.end) {
                await sock.end();
            }

            // Wait a moment before reconnecting
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Reconnect
            await whatsappService.createConnection(sessionId, config);

            logWithSession('info', 'Session restarted via API', sessionId);

            res.json({
                success: true,
                message: 'Session restarted successfully',
                data: {
                    sessionId: sessionId,
                    state: sessionManager.getSessionState(sessionId)
                }
            });

        } catch (error) {
            logger.error('Error in restartSession:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
}

module.exports = new AuthController();