const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { logger, logWithSession } = require('../utils/logger');
const { defaultConfig, getSessionConfig } = require('../config/default');

class SessionManager {
    constructor() {
        this.sessions = new Map();
        this.sessionConfigs = new Map();
        this.sessionStates = new Map(); // CONNECTING, CONNECTED, DISCONNECTED, BANNED
        this.sessionPath = defaultConfig.session.path;
        this.ensureSessionDirectory();
    }

    /**
     * Pastikan direktori session ada
     */
    ensureSessionDirectory() {
        if (!fs.existsSync(this.sessionPath)) {
            fs.mkdirSync(this.sessionPath, { recursive: true });
            logWithSession('info', 'Session directory created', 'system');
        }
    }

    /**
     * Generate session ID unik
     * @returns {string} Session ID
     */
    generateSessionId() {
        return `session_${uuidv4().replace(/-/g, '').substring(0, 16)}`;
    }

    /**
     * Buat session baru
     * @param {string} sessionId - ID session (optional)
     * @param {Object} config - Konfigurasi custom (optional)
     * @returns {string} Session ID
     */
    createSession(sessionId = null, config = {}) {
        const id = sessionId || this.generateSessionId();

        if (this.sessions.has(id)) {
            throw new Error(`Session ${id} sudah ada`);
        }

        // Buat konfigurasi session
        const sessionConfig = getSessionConfig(id, config);
        this.sessionConfigs.set(id, sessionConfig);

        // Set status awal
        this.sessionStates.set(id, 'DISCONNECTED');

        // Buat direktori session
        const sessionDir = path.join(this.sessionPath, id);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        logWithSession('info', 'Session created', id, { config: sessionConfig });

        return id;
    }

    /**
     * Set session instance
     * @param {string} sessionId - ID session
     * @param {Object} instance - Instance WhatsApp
     */
    setSession(sessionId, instance) {
        this.sessions.set(sessionId, instance);
        logWithSession('info', 'Session instance set', sessionId);
    }

    /**
     * Get session instance
     * @param {string} sessionId - ID session
     * @returns {Object|null} Instance WhatsApp
     */
    getSession(sessionId) {
        return this.sessions.get(sessionId) || null;
    }

    /**
     * Get konfigurasi session
     * @param {string} sessionId - ID session
     * @returns {Object|null} Konfigurasi session
     */
    getSessionConfig(sessionId) {
        return this.sessionConfigs.get(sessionId) || null;
    }

    /**
     * Update konfigurasi session
     * @param {string} sessionId - ID session
     * @param {Object} newConfig - Konfigurasi baru
     */
    updateSessionConfig(sessionId, newConfig) {
        const currentConfig = this.sessionConfigs.get(sessionId) || {};
        const updatedConfig = { ...currentConfig, ...newConfig };
        this.sessionConfigs.set(sessionId, updatedConfig);

        logWithSession('info', 'Session config updated', sessionId, { newConfig });
    }

    /**
     * Set status session
     * @param {string} sessionId - ID session
     * @param {string} state - Status (CONNECTING, CONNECTED, DISCONNECTED, BANNED)
     */
    setSessionState(sessionId, state) {
        const oldState = this.sessionStates.get(sessionId);
        this.sessionStates.set(sessionId, state);

        logWithSession('info', `Session state changed: ${oldState} -> ${state}`, sessionId);
    }

    /**
     * Get status session
     * @param {string} sessionId - ID session
     * @returns {string} Status session
     */
    getSessionState(sessionId) {
        return this.sessionStates.get(sessionId) || 'UNKNOWN';
    }

    /**
     * Cek apakah session exist
     * @param {string} sessionId - ID session
     * @returns {boolean} True jika session ada
     */
    hasSession(sessionId) {
        return this.sessions.has(sessionId);
    }

    /**
     * Cek apakah session terhubung
     * @param {string} sessionId - ID session
     * @returns {boolean} True jika terhubung
     */
    isSessionConnected(sessionId) {
        return this.getSessionState(sessionId) === 'CONNECTED';
    }

    /**
     * Get semua session ID
     * @returns {Array} Array session ID
     */
    getAllSessionIds() {
        return Array.from(this.sessions.keys());
    }

    /**
     * Get semua session dengan status
     * @returns {Array} Array object session info
     */
    getAllSessionsInfo() {
        return this.getAllSessionIds().map(sessionId => ({
            sessionId,
            state: this.getSessionState(sessionId),
            config: this.getSessionConfig(sessionId),
            connected: this.isSessionConnected(sessionId)
        }));
    }

    /**
     * Get session terhubung
     * @returns {Array} Array session ID yang terhubung
     */
    getConnectedSessions() {
        return this.getAllSessionIds().filter(sessionId =>
            this.isSessionConnected(sessionId)
        );
    }

    /**
     * Hapus session
     * @param {string} sessionId - ID session
     * @param {boolean} deleteFiles - Hapus file session juga
     */
    async deleteSession(sessionId, deleteFiles = false) {
        if (!this.sessions.has(sessionId)) {
            throw new Error(`Session ${sessionId} tidak ditemukan`);
        }

        // Close connection jika ada
        const session = this.getSession(sessionId);
        if (session && session.end) {
            try {
                await session.end();
            } catch (error) {
                logWithSession('error', 'Error closing session', sessionId, { error: error.message });
            }
        }

        // Hapus dari memory
        this.sessions.delete(sessionId);
        this.sessionConfigs.delete(sessionId);
        this.sessionStates.delete(sessionId);

        // Hapus file jika diminta
        if (deleteFiles) {
            const sessionDir = path.join(this.sessionPath, sessionId);
            if (fs.existsSync(sessionDir)) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
            }
        }

        logWithSession('info', 'Session deleted', sessionId, { deleteFiles });
    }

    /**
     * Get path session
     * @param {string} sessionId - ID session
     * @returns {string} Path direktori session
     */
    getSessionPath(sessionId) {
        return path.join(this.sessionPath, sessionId);
    }

    /**
     * Load session yang tersimpan dari disk
     */
    loadExistingSessions() {
        try {
            const sessionDirs = fs.readdirSync(this.sessionPath);

            sessionDirs.forEach(sessionId => {
                const sessionDir = path.join(this.sessionPath, sessionId);
                const statsPath = path.join(sessionDir, 'stats.json');

                if (fs.statSync(sessionDir).isDirectory()) {
                    // Load konfigurasi jika ada
                    let config = {};
                    if (fs.existsSync(statsPath)) {
                        try {
                            const statsData = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
                            config = statsData.config || {};
                        } catch (error) {
                            logWithSession('warn', 'Failed to load session config', sessionId, { error: error.message });
                        }
                    }

                    // Recreate session
                    this.sessionConfigs.set(sessionId, getSessionConfig(sessionId, config));
                    this.sessionStates.set(sessionId, 'DISCONNECTED');

                    logWithSession('info', 'Session loaded from disk', sessionId);
                }
            });

            logger.info(`Loaded ${sessionDirs.length} existing sessions`);
        } catch (error) {
            logger.error('Error loading existing sessions:', error);
        }
    }

    /**
     * Save session stats
     * @param {string} sessionId - ID session
     * @param {Object} stats - Stats data
     */
    saveSessionStats(sessionId, stats) {
        try {
            const sessionDir = this.getSessionPath(sessionId);
            const statsPath = path.join(sessionDir, 'stats.json');

            const data = {
                sessionId,
                lastUpdate: new Date().toISOString(),
                config: this.getSessionConfig(sessionId),
                state: this.getSessionState(sessionId),
                ...stats
            };

            fs.writeFileSync(statsPath, JSON.stringify(data, null, 2));
        } catch (error) {
            logWithSession('error', 'Failed to save session stats', sessionId, { error: error.message });
        }
    }

    /**
     * Cleanup session yang tidak aktif
     */
    cleanupInactiveSessions() {
        const inactiveThreshold = Date.now() - (24 * 60 * 60 * 1000); // 24 jam

        this.getAllSessionIds().forEach(sessionId => {
            const state = this.getSessionState(sessionId);
            if (state === 'DISCONNECTED' || state === 'BANNED') {
                const sessionDir = this.getSessionPath(sessionId);
                const statsPath = path.join(sessionDir, 'stats.json');

                if (fs.existsSync(statsPath)) {
                    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
                    const lastUpdate = new Date(stats.lastUpdate).getTime();

                    if (lastUpdate < inactiveThreshold) {
                        logWithSession('info', 'Cleaning up inactive session', sessionId);
                        this.deleteSession(sessionId, true).catch(error => {
                            logWithSession('error', 'Error cleaning up session', sessionId, { error: error.message });
                        });
                    }
                }
            }
        });
    }
}

// Singleton instance
const sessionManager = new SessionManager();

module.exports = sessionManager;