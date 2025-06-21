const sessionManager = require('../services/sessionManager');
const { logger, logWithSession } = require('../utils/logger');
const { createError } = require('../middleware/error');

class StatusController {

    /**
     * POST /api/status/update-presence
     * Update presence status (online, offline, typing, etc.)
     */
    async updatePresence(req, res) {
        try {
            const { sessionId, presence, jid } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const validPresences = ['unavailable', 'available', 'composing', 'recording', 'paused'];
            if (!validPresences.includes(presence)) {
                throw createError.validation(`Invalid presence. Valid values: ${validPresences.join(', ')}`);
            }

            const sock = sessionManager.getSession(sessionId);

            // Update presence
            if (jid) {
                // Update presence for specific chat
                await sock.sendPresenceUpdate(presence, jid);
            } else {
                // Update global presence
                await sock.sendPresenceUpdate(presence);
            }

            logWithSession('info', 'Presence updated', sessionId, {
                presence,
                jid: jid || 'global'
            });

            res.json({
                success: true,
                message: 'Presence updated successfully',
                data: {
                    presence,
                    jid: jid || null,
                    timestamp: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in updatePresence:', error);
            throw error;
        }
    }

    /**
     * PUT /api/status/profile-name
     * Update profile name
     */
    async updateProfileName(req, res) {
        try {
            const { sessionId, name } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            if (!name || name.trim().length === 0) {
                throw createError.validation('Name is required');
            }

            if (name.length > 25) {
                throw createError.validation('Profile name cannot exceed 25 characters');
            }

            const sock = sessionManager.getSession(sessionId);

            // Update profile name
            await sock.updateProfileName(name.trim());

            logWithSession('info', 'Profile name updated', sessionId, {
                newName: name.trim()
            });

            res.json({
                success: true,
                message: 'Profile name updated successfully',
                data: {
                    name: name.trim(),
                    updatedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in updateProfileName:', error);
            throw error;
        }
    }

    /**
     * PUT /api/status/profile-status
     * Update profile status message
     */
    async updateProfileStatus(req, res) {
        try {
            const { sessionId, status } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            if (status && status.length > 139) {
                throw createError.validation('Status message cannot exceed 139 characters');
            }

            const sock = sessionManager.getSession(sessionId);

            // Update profile status
            await sock.updateProfileStatus(status || '');

            logWithSession('info', 'Profile status updated', sessionId, {
                hasStatus: !!status
            });

            res.json({
                success: true,
                message: 'Profile status updated successfully',
                data: {
                    status: status || '',
                    updatedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in updateProfileStatus:', error);
            throw error;
        }
    }

    /**
     * PUT /api/status/profile-picture
     * Update profile picture
     */
    async updateProfilePicture(req, res) {
        try {
            const { sessionId } = req.body;

            if (!req.file) {
                throw createError.validation('Image file is required');
            }

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            // Validate image
            const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
            if (!allowedTypes.includes(req.file.mimetype)) {
                throw createError.validation('Only JPEG and PNG images are allowed');
            }

            if (req.file.size > 5 * 1024 * 1024) {
                throw createError.validation('Image file too large. Maximum 5MB allowed');
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
                    updatedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in updateProfilePicture:', error);
            throw error;
        }
    }

    /**
     * DELETE /api/status/profile-picture
     * Remove profile picture
     */
    async removeProfilePicture(req, res) {
        try {
            const { sessionId } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const sock = sessionManager.getSession(sessionId);

            // Remove profile picture
            await sock.removeProfilePicture(sock.user.id);

            logWithSession('info', 'Profile picture removed', sessionId);

            res.json({
                success: true,
                message: 'Profile picture removed successfully',
                data: {
                    removedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in removeProfilePicture:', error);
            throw error;
        }
    }

    /**
     * GET /api/status/profile/:sessionId
     * Get current profile information
     */
    async getProfile(req, res) {
        try {
            const { sessionId } = req.params;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const sock = sessionManager.getSession(sessionId);

            if (!sock.user) {
                throw createError.api('User information not available', 400);
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
                phone: sock.user.id.split('@')[0],
                profilePicture: profilePictureUrl,
                status: profileStatus,
                isConnected: true,
                connectedAt: sock.connectedAt || null
            };

            res.json({
                success: true,
                message: 'Profile information retrieved',
                data: profileData
            });

        } catch (error) {
            logger.error('Error in getProfile:', error);
            throw error;
        }
    }

    /**
     * GET /api/status/privacy/:sessionId
     * Get privacy settings
     */
    async getPrivacySettings(req, res) {
        try {
            const { sessionId } = req.params;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
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
            logger.error('Error in getPrivacySettings:', error);
            throw error;
        }
    }

    /**
     * PUT /api/status/privacy
     * Update privacy settings
     */
    async updatePrivacySettings(req, res) {
        try {
            const { sessionId, setting, value } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const validSettings = ['readreceipts', 'profile', 'status', 'online', 'last', 'groupadd'];
            if (!validSettings.includes(setting)) {
                throw createError.validation(`Invalid privacy setting. Valid settings: ${validSettings.join(', ')}`);
            }

            const validValues = ['all', 'contacts', 'contact_blacklist', 'none'];
            if (!validValues.includes(value)) {
                throw createError.validation(`Invalid privacy value. Valid values: ${validValues.join(', ')}`);
            }

            const sock = sessionManager.getSession(sessionId);

            // Update specific privacy setting
            switch (setting) {
                case 'readreceipts':
                    await sock.updateReadReceiptsPrivacy(value);
                    break;
                case 'profile':
                    await sock.updateProfilePicturePrivacy(value);
                    break;
                case 'status':
                    await sock.updateStatusPrivacy(value);
                    break;
                case 'online':
                    await sock.updateOnlinePrivacy(value);
                    break;
                case 'last':
                    await sock.updateLastSeenPrivacy(value);
                    break;
                case 'groupadd':
                    await sock.updateGroupsAddPrivacy(value);
                    break;
            }

            logWithSession('info', 'Privacy setting updated', sessionId, {
                setting,
                value
            });

            res.json({
                success: true,
                message: 'Privacy setting updated successfully',
                data: {
                    setting,
                    value,
                    updatedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in updatePrivacySettings:', error);
            throw error;
        }
    }

    /**
     * POST /api/status/send-story
     * Send status update (story)
     */
    async sendStory(req, res) {
        try {
            const { sessionId, caption, contacts, type = 'text' } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const sock = sessionManager.getSession(sessionId);
            let messageContent = {};

            if (req.file) {
                // Media story
                const mediaType = req.file.mimetype.startsWith('image/') ? 'image' : 'video';

                if (mediaType === 'video' && req.file.size > 64 * 1024 * 1024) {
                    throw createError.validation('Video file too large. Maximum 64MB allowed for stories');
                }

                if (mediaType === 'image' && req.file.size > 10 * 1024 * 1024) {
                    throw createError.validation('Image file too large. Maximum 10MB allowed for stories');
                }

                messageContent = {
                    [mediaType]: req.file.buffer,
                    caption: caption || '',
                    mimetype: req.file.mimetype
                };
            } else if (caption) {
                // Text story
                if (caption.length > 700) {
                    throw createError.validation('Text story cannot exceed 700 characters');
                }

                messageContent = {
                    text: caption
                };
            } else {
                throw createError.validation('Either media file or caption text is required');
            }

            // Send to status broadcast
            const statusMessage = await sock.sendMessage('status@broadcast', messageContent);

            // Send to specific contacts if provided
            let sentToContacts = [];
            if (contacts && Array.isArray(contacts) && contacts.length > 0) {
                const config = sessionManager.getSessionConfig(sessionId);

                for (const contact of contacts.slice(0, 50)) { // Limit to 50 contacts
                    try {
                        const jid = contact.includes('@') ? contact : `${contact}@s.whatsapp.net`;
                        await sock.sendMessage(jid, messageContent);
                        sentToContacts.push(contact);
                    } catch (error) {
                        // Continue with other contacts
                    }
                }
            }

            logWithSession('info', 'Story sent', sessionId, {
                type: req.file ? 'media' : 'text',
                hasCaption: !!caption,
                contactCount: sentToContacts.length
            });

            res.json({
                success: true,
                message: 'Story sent successfully',
                data: {
                    messageId: statusMessage.key.id,
                    timestamp: statusMessage.messageTimestamp,
                    type: req.file ? 'media' : 'text',
                    sentToContacts: sentToContacts.length,
                    isPublic: !contacts || contacts.length === 0
                }
            });

        } catch (error) {
            logger.error('Error in sendStory:', error);
            throw error;
        }
    }

    /**
     * GET /api/status/stories/:sessionId
     * Get status/stories from contacts
     */
    async getStories(req, res) {
        try {
            const { sessionId } = req.params;
            const { limit = 50, includeViewed = false } = req.query;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const whatsappService = require('../services/whatsappService');
            const store = whatsappService.getStore(sessionId);

            if (!store) {
                throw createError.api('WhatsApp store not available', 400);
            }

            // Get status messages from store
            const statusMessages = store.messages['status@broadcast'] || [];

            // Filter and format stories
            let stories = statusMessages
                .filter(msg => {
                    if (!includeViewed && msg.messageStubType === 'STATUS_VIEWED') {
                        return false;
                    }
                    return true;
                })
                .slice(0, parseInt(limit))
                .map(story => ({
                    id: story.key.id,
                    from: story.key.participant || story.pushName,
                    timestamp: story.messageTimestamp,
                    type: Object.keys(story.message || {})[0],
                    caption: story.message?.imageMessage?.caption ||
                        story.message?.videoMessage?.caption ||
                        story.message?.conversation || null,
                    isViewed: story.messageStubType === 'STATUS_VIEWED'
                }));

            res.json({
                success: true,
                message: 'Stories retrieved',
                data: {
                    stories,
                    total: stories.length,
                    hasMore: statusMessages.length > parseInt(limit)
                }
            });

        } catch (error) {
            logger.error('Error in getStories:', error);
            throw error;
        }
    }

    /**
     * GET /api/status/business-profile/:sessionId/:jid
     * Get business profile information
     */
    async getBusinessProfile(req, res) {
        try {
            const { sessionId, jid } = req.params;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const sock = sessionManager.getSession(sessionId);

            // Get business profile
            const businessProfile = await sock.getBusinessProfile(jid);

            res.json({
                success: true,
                message: 'Business profile retrieved',
                data: businessProfile
            });

        } catch (error) {
            if (error.message.includes('not a business')) {
                res.json({
                    success: false,
                    message: 'Not a business account',
                    data: null
                });
            } else {
                logger.error('Error in getBusinessProfile:', error);
                throw error;
            }
        }
    }

    /**
     * POST /api/status/view-story
     * Mark story as viewed
     */
    async viewStory(req, res) {
        try {
            const { sessionId, messageKey } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            if (!messageKey || !messageKey.id || !messageKey.remoteJid) {
                throw createError.validation('Valid messageKey is required');
            }

            const sock = sessionManager.getSession(sessionId);

            // Mark story as viewed
            await sock.readMessages([messageKey]);

            logWithSession('info', 'Story marked as viewed', sessionId, {
                messageId: messageKey.id,
                from: messageKey.remoteJid
            });

            res.json({
                success: true,
                message: 'Story marked as viewed',
                data: {
                    messageId: messageKey.id,
                    viewedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in viewStory:', error);
            throw error;
        }
    }

    /**
     * POST /api/status/set-disappearing-messages
     * Set disappearing messages for a chat
     */
    async setDisappearingMessages(req, res) {
        try {
            const { sessionId, jid, duration } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            // Valid durations in seconds
            const validDurations = [0, 86400, 604800, 7776000]; // 0=off, 1day, 7days, 90days
            if (!validDurations.includes(duration)) {
                throw createError.validation('Invalid duration. Valid values: 0 (off), 86400 (1 day), 604800 (7 days), 7776000 (90 days)');
            }

            const sock = sessionManager.getSession(sessionId);

            // Set disappearing messages
            await sock.sendMessage(jid, {
                disappearingMessagesInChat: duration
            });

            logWithSession('info', 'Disappearing messages setting updated', sessionId, {
                jid,
                duration
            });

            res.json({
                success: true,
                message: 'Disappearing messages setting updated',
                data: {
                    jid,
                    duration,
                    enabled: duration > 0,
                    updatedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in setDisappearingMessages:', error);
            throw error;
        }
    }

    /**
     * GET /api/status/blocked-contacts/:sessionId
     * Get list of blocked contacts
     */
    async getBlockedContacts(req, res) {
        try {
            const { sessionId } = req.params;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const sock = sessionManager.getSession(sessionId);

            // Get blocked contacts
            const blockedContacts = await sock.fetchBlocklist();

            res.json({
                success: true,
                message: 'Blocked contacts retrieved',
                data: {
                    blockedContacts,
                    total: blockedContacts.length
                }
            });

        } catch (error) {
            logger.error('Error in getBlockedContacts:', error);
            throw error;
        }
    }
}

module.exports = new StatusController();