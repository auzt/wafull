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
    validateSessionConnected,
    upload,
    uploadRateLimit
} = require('../middleware/validation');

const { logWithSession } = require('../utils/logger');

/**
 * Apply middleware untuk semua status routes
 */
router.use(sanitizeInput);
router.use(sessionRateLimit);

/**
 * POST /api/status/update-presence
 * Update presence status (online, offline, unavailable)
 */
router.post('/update-presence',
    validateRequired(['sessionId', 'presence']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, presence } = req.body;
            const sessionManager = require('../services/sessionManager');

            const sock = sessionManager.getSession(sessionId);

            // Validate presence values
            const validPresences = ['unavailable', 'available', 'composing', 'recording', 'paused'];
            if (!validPresences.includes(presence)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid presence. Valid values: ${validPresences.join(', ')}`
                });
            }

            // Update presence
            await sock.sendPresenceUpdate(presence);

            logWithSession('info', 'Presence updated', sessionId, {
                presence: presence
            });

            res.json({
                success: true,
                message: 'Presence updated successfully',
                data: {
                    presence: presence,
                    timestamp: new Date().toISOString()
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
 * POST /api/status/update-profile-name
 * Update profile name
 */
router.post('/update-profile-name',
    validateRequired(['sessionId', 'name']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, name } = req.body;
            const sessionManager = require('../services/sessionManager');

            const sock = sessionManager.getSession(sessionId);

            // Validate name length
            if (name.length > 25) {
                return res.status(400).json({
                    success: false,
                    error: 'Profile name cannot exceed 25 characters'
                });
            }

            // Update profile name
            await sock.updateProfileName(name);

            logWithSession('info', 'Profile name updated', sessionId, {
                newName: name
            });

            res.json({
                success: true,
                message: 'Profile name updated successfully',
                data: {
                    name: name,
                    timestamp: new Date().toISOString()
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
 * POST /api/status/update-profile-status
 * Update profile status message
 */
router.post('/update-profile-status',
    validateRequired(['sessionId', 'status']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, status } = req.body;
            const sessionManager = require('../services/sessionManager');

            const sock = sessionManager.getSession(sessionId);

            // Validate status length
            if (status.length > 139) {
                return res.status(400).json({
                    success: false,
                    error: 'Status message cannot exceed 139 characters'
                });
            }

            // Update profile status
            await sock.updateProfileStatus(status);

            logWithSession('info', 'Profile status updated', sessionId, {
                newStatus: status
            });

            res.json({
                success: true,
                message: 'Profile status updated successfully',
                data: {
                    status: status,
                    timestamp: new Date().toISOString()
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
 * POST /api/status/update-profile-picture
 * Update profile picture
 */
router.post('/update-profile-picture',
    uploadRateLimit,
    upload.single('image'),
    validateRequired(['sessionId']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId } = req.body;
            const sessionManager = require('../services/sessionManager');

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'Image file is required'
                });
            }

            // Validate image type
            const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
            if (!allowedTypes.includes(req.file.mimetype)) {
                return res.status(400).json({
                    success: false,
                    error: 'Only JPEG and PNG images are allowed'
                });
            }

            // Validate file size (max 5MB)
            if (req.file.size > 5 * 1024 * 1024) {
                return res.status(400).json({
                    success: false,
                    error: 'Image file too large. Maximum 5MB allowed'
                });
            }

            const sock = sessionManager.getSession(sessionId);

            // Update profile picture
            await sock.updateProfilePicture(sock.user.id, req.file.buffer);

            logWithSession('info', 'Profile picture updated', sessionId, {
                fileName: req.file.originalname,
                size: req.file.size
            });

            res.json({
                success: true,
                message: 'Profile picture updated successfully',
                data: {
                    fileName: req.file.originalname,
                    size: req.file.size,
                    timestamp: new Date().toISOString()
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
 * POST /api/status/remove-profile-picture
 * Remove profile picture
 */
router.post('/remove-profile-picture',
    validateRequired(['sessionId']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId } = req.body;
            const sessionManager = require('../services/sessionManager');

            const sock = sessionManager.getSession(sessionId);

            // Remove profile picture
            await sock.removeProfilePicture(sock.user.id);

            logWithSession('info', 'Profile picture removed', sessionId);

            res.json({
                success: true,
                message: 'Profile picture removed successfully',
                data: {
                    timestamp: new Date().toISOString()
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
 * GET /api/status/profile/:sessionId
 * Get current profile information
 */
router.get('/profile/:sessionId',
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

            if (!sessionManager.isSessionConnected(sessionId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Session not connected'
                });
            }

            const sock = sessionManager.getSession(sessionId);

            if (!sock.user) {
                return res.status(400).json({
                    success: false,
                    error: 'User information not available'
                });
            }

            // Get profile picture URL
            let profilePictureUrl = null;
            try {
                profilePictureUrl = await sock.profilePictureUrl(sock.user.id, 'image');
            } catch (error) {
                // Profile picture might not be available
            }

            // Get profile status
            let profileStatus = null;
            try {
                const statusResult = await sock.fetchStatus(sock.user.id);
                profileStatus = statusResult?.status || null;
            } catch (error) {
                // Status might not be available
            }

            const profileData = {
                jid: sock.user.id,
                name: sock.user.name,
                profilePicture: profilePictureUrl,
                status: profileStatus,
                phone: sock.user.id.split('@')[0]
            };

            res.json({
                success: true,
                message: 'Profile information retrieved',
                data: profileData
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
 * GET /api/status/privacy/:sessionId
 * Get privacy settings
 */
router.get('/privacy/:sessionId',
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

            if (!sessionManager.isSessionConnected(sessionId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Session not connected'
                });
            }

            const sock = sessionManager.getSession(sessionId);

            // Get privacy settings
            const privacySettings = await sock.fetchPrivacySettings();

            res.json({
                success: true,
                message: 'Privacy settings retrieved',
                data: privacySettings
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
 * POST /api/status/update-privacy
 * Update privacy settings
 */
router.post('/update-privacy',
    validateRequired(['sessionId', 'setting', 'value']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, setting, value } = req.body;
            const sessionManager = require('../services/sessionManager');

            const sock = sessionManager.getSession(sessionId);

            // Validate privacy setting
            const validSettings = ['readreceipts', 'profile', 'status', 'online', 'last', 'groupadd'];
            if (!validSettings.includes(setting)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid privacy setting. Valid settings: ${validSettings.join(', ')}`
                });
            }

            // Validate privacy value
            const validValues = ['all', 'contacts', 'contact_blacklist', 'none'];
            if (!validValues.includes(value)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid privacy value. Valid values: ${validValues.join(', ')}`
                });
            }

            // Update privacy setting
            await sock.updateReadReceiptsPrivacy(value);

            logWithSession('info', 'Privacy setting updated', sessionId, {
                setting: setting,
                value: value
            });

            res.json({
                success: true,
                message: 'Privacy setting updated successfully',
                data: {
                    setting: setting,
                    value: value,
                    timestamp: new Date().toISOString()
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
 * POST /api/status/send-status
 * Send status update (story)
 */
router.post('/send-status',
    uploadRateLimit,
    upload.single('media'),
    validateRequired(['sessionId']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, caption = '', contacts } = req.body;
            const sessionManager = require('../services/sessionManager');

            const sock = sessionManager.getSession(sessionId);

            let messageContent = {};

            if (req.file) {
                // Media status
                const mediaType = req.file.mimetype.startsWith('image/') ? 'image' : 'video';

                messageContent = {
                    [mediaType]: req.file.buffer,
                    caption: caption,
                    mimetype: req.file.mimetype
                };
            } else if (caption) {
                // Text status
                messageContent = {
                    text: caption
                };
            } else {
                return res.status(400).json({
                    success: false,
                    error: 'Either media file or caption text is required'
                });
            }

            // Send status
            const statusMessage = await sock.sendMessage('status@broadcast', messageContent);

            logWithSession('info', 'Status sent', sessionId, {
                type: req.file ? 'media' : 'text',
                hasCaption: !!caption
            });

            res.json({
                success: true,
                message: 'Status sent successfully',
                data: {
                    messageId: statusMessage.key.id,
                    timestamp: statusMessage.messageTimestamp,
                    type: req.file ? 'media' : 'text'
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
 * GET /api/status/stories/:sessionId
 * Get status/stories from contacts
 */
router.get('/stories/:sessionId',
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

            if (!sessionManager.isSessionConnected(sessionId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Session not connected'
                });
            }

            const whatsappService = require('../services/whatsappService');
            const store = whatsappService.getStore(sessionId);

            if (!store) {
                return res.status(400).json({
                    success: false,
                    error: 'Store not available'
                });
            }

            // Get status messages from store
            const statusMessages = store.messages['status@broadcast'] || [];

            res.json({
                success: true,
                message: 'Status messages retrieved',
                data: {
                    stories: statusMessages,
                    total: statusMessages.length
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