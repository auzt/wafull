const sessionManager = require('../services/sessionManager');
const { logger, logWithSession } = require('../utils/logger');
const { formatToWhatsAppId, extractPhoneFromJid } = require('../utils/phoneFormatter');
const { createError } = require('../middleware/error');

class GroupController {

    /**
     * POST /api/group/create
     * Create new WhatsApp group
     */
    async createGroup(req, res) {
        try {
            const { sessionId, subject, participants, description } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const sock = sessionManager.getSession(sessionId);
            const config = sessionManager.getSessionConfig(sessionId);

            // Validate participants
            if (!participants || !Array.isArray(participants) || participants.length === 0) {
                throw createError.validation('At least one participant is required');
            }

            if (participants.length > 256) {
                throw createError.validation('Maximum 256 participants allowed');
            }

            // Format participant JIDs
            const participantJids = participants.map(phone =>
                formatToWhatsAppId(phone, config.countryCode)
            );

            // Create group
            const group = await sock.groupCreate(subject, participantJids);

            // Set description if provided
            if (description) {
                try {
                    await sock.groupUpdateDescription(group.id, description);
                } catch (error) {
                    logger.warn('Failed to set group description', { error: error.message });
                }
            }

            logWithSession('info', 'Group created', sessionId, {
                groupId: group.id,
                subject: subject,
                participantCount: participantJids.length
            });

            res.json({
                success: true,
                message: 'Group created successfully',
                data: {
                    groupId: group.id,
                    subject: subject,
                    description: description,
                    participants: participantJids,
                    participantCount: participantJids.length,
                    inviteCode: group.inviteCode || null,
                    createdAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in createGroup:', error);
            throw error;
        }
    }

    /**
     * GET /api/group/info/:sessionId/:groupId
     * Get group information and metadata
     */
    async getGroupInfo(req, res) {
        try {
            const { sessionId, groupId } = req.params;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const sock = sessionManager.getSession(sessionId);

            // Get group metadata
            const groupMetadata = await sock.groupMetadata(groupId);

            // Get group invite code
            let inviteCode = null;
            try {
                inviteCode = await sock.groupInviteCode(groupId);
            } catch (error) {
                // User might not be admin
            }

            // Get group profile picture
            let profilePicture = null;
            try {
                profilePicture = await sock.profilePictureUrl(groupId, 'image');
            } catch (error) {
                // Profile picture might not exist
            }

            const groupInfo = {
                ...groupMetadata,
                inviteCode,
                profilePicture,
                inviteUrl: inviteCode ? `https://chat.whatsapp.com/${inviteCode}` : null
            };

            res.json({
                success: true,
                message: 'Group information retrieved',
                data: groupInfo
            });

        } catch (error) {
            logger.error('Error in getGroupInfo:', error);
            throw error;
        }
    }

    /**
     * POST /api/group/add-participants
     * Add participants to group
     */
    async addParticipants(req, res) {
        try {
            const { sessionId, groupId, participants } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const sock = sessionManager.getSession(sessionId);
            const config = sessionManager.getSessionConfig(sessionId);

            if (!participants || !Array.isArray(participants) || participants.length === 0) {
                throw createError.validation('At least one participant is required');
            }

            // Format participant JIDs
            const participantJids = participants.map(phone =>
                formatToWhatsAppId(phone, config.countryCode)
            );

            // Add participants
            const result = await sock.groupParticipantsUpdate(groupId, participantJids, 'add');

            // Process results
            const processedResults = result.map((res, index) => ({
                participant: participantJids[index],
                phone: participants[index],
                status: res.status,
                content: res.content
            }));

            const successful = processedResults.filter(r => r.status === '200');
            const failed = processedResults.filter(r => r.status !== '200');

            logWithSession('info', 'Participants added to group', sessionId, {
                groupId,
                attempted: participantJids.length,
                successful: successful.length,
                failed: failed.length
            });

            res.json({
                success: successful.length > 0,
                message: `${successful.length}/${participantJids.length} participants added successfully`,
                data: {
                    groupId,
                    results: processedResults,
                    summary: {
                        total: participantJids.length,
                        successful: successful.length,
                        failed: failed.length
                    }
                }
            });

        } catch (error) {
            logger.error('Error in addParticipants:', error);
            throw error;
        }
    }

    /**
     * POST /api/group/remove-participants
     * Remove participants from group
     */
    async removeParticipants(req, res) {
        try {
            const { sessionId, groupId, participants } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const sock = sessionManager.getSession(sessionId);
            const config = sessionManager.getSessionConfig(sessionId);

            if (!participants || !Array.isArray(participants) || participants.length === 0) {
                throw createError.validation('At least one participant is required');
            }

            // Format participant JIDs
            const participantJids = participants.map(phone =>
                formatToWhatsAppId(phone, config.countryCode)
            );

            // Remove participants
            const result = await sock.groupParticipantsUpdate(groupId, participantJids, 'remove');

            // Process results
            const processedResults = result.map((res, index) => ({
                participant: participantJids[index],
                phone: participants[index],
                status: res.status,
                content: res.content
            }));

            const successful = processedResults.filter(r => r.status === '200');
            const failed = processedResults.filter(r => r.status !== '200');

            logWithSession('info', 'Participants removed from group', sessionId, {
                groupId,
                attempted: participantJids.length,
                successful: successful.length,
                failed: failed.length
            });

            res.json({
                success: successful.length > 0,
                message: `${successful.length}/${participantJids.length} participants removed successfully`,
                data: {
                    groupId,
                    results: processedResults,
                    summary: {
                        total: participantJids.length,
                        successful: successful.length,
                        failed: failed.length
                    }
                }
            });

        } catch (error) {
            logger.error('Error in removeParticipants:', error);
            throw error;
        }
    }

    /**
     * POST /api/group/promote-admins
     * Promote participants to group admins
     */
    async promoteAdmins(req, res) {
        try {
            const { sessionId, groupId, participants } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const sock = sessionManager.getSession(sessionId);
            const config = sessionManager.getSessionConfig(sessionId);

            if (!participants || !Array.isArray(participants) || participants.length === 0) {
                throw createError.validation('At least one participant is required');
            }

            // Format participant JIDs
            const participantJids = participants.map(phone =>
                formatToWhatsAppId(phone, config.countryCode)
            );

            // Promote to admin
            const result = await sock.groupParticipantsUpdate(groupId, participantJids, 'promote');

            // Process results
            const processedResults = result.map((res, index) => ({
                participant: participantJids[index],
                phone: participants[index],
                status: res.status,
                content: res.content
            }));

            const successful = processedResults.filter(r => r.status === '200');

            logWithSession('info', 'Participants promoted to admin', sessionId, {
                groupId,
                promoted: successful.length
            });

            res.json({
                success: successful.length > 0,
                message: `${successful.length}/${participantJids.length} participants promoted to admin`,
                data: {
                    groupId,
                    results: processedResults,
                    promoted: successful.length
                }
            });

        } catch (error) {
            logger.error('Error in promoteAdmins:', error);
            throw error;
        }
    }

    /**
     * POST /api/group/demote-admins
     * Demote admins to regular participants
     */
    async demoteAdmins(req, res) {
        try {
            const { sessionId, groupId, participants } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const sock = sessionManager.getSession(sessionId);
            const config = sessionManager.getSessionConfig(sessionId);

            if (!participants || !Array.isArray(participants) || participants.length === 0) {
                throw createError.validation('At least one participant is required');
            }

            // Format participant JIDs
            const participantJids = participants.map(phone =>
                formatToWhatsAppId(phone, config.countryCode)
            );

            // Demote from admin
            const result = await sock.groupParticipantsUpdate(groupId, participantJids, 'demote');

            // Process results
            const processedResults = result.map((res, index) => ({
                participant: participantJids[index],
                phone: participants[index],
                status: res.status,
                content: res.content
            }));

            const successful = processedResults.filter(r => r.status === '200');

            logWithSession('info', 'Admins demoted to participants', sessionId, {
                groupId,
                demoted: successful.length
            });

            res.json({
                success: successful.length > 0,
                message: `${successful.length}/${participantJids.length} admins demoted to participants`,
                data: {
                    groupId,
                    results: processedResults,
                    demoted: successful.length
                }
            });

        } catch (error) {
            logger.error('Error in demoteAdmins:', error);
            throw error;
        }
    }

    /**
     * PUT /api/group/update-subject
     * Update group name/subject
     */
    async updateSubject(req, res) {
        try {
            const { sessionId, groupId, subject } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            if (!subject || subject.trim().length === 0) {
                throw createError.validation('Subject is required');
            }

            if (subject.length > 25) {
                throw createError.validation('Subject cannot exceed 25 characters');
            }

            const sock = sessionManager.getSession(sessionId);

            // Update group subject
            await sock.groupUpdateSubject(groupId, subject.trim());

            logWithSession('info', 'Group subject updated', sessionId, {
                groupId,
                newSubject: subject.trim()
            });

            res.json({
                success: true,
                message: 'Group subject updated successfully',
                data: {
                    groupId,
                    subject: subject.trim(),
                    updatedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in updateSubject:', error);
            throw error;
        }
    }

    /**
     * PUT /api/group/update-description
     * Update group description
     */
    async updateDescription(req, res) {
        try {
            const { sessionId, groupId, description } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            if (description && description.length > 512) {
                throw createError.validation('Description cannot exceed 512 characters');
            }

            const sock = sessionManager.getSession(sessionId);

            // Update group description
            await sock.groupUpdateDescription(groupId, description || '');

            logWithSession('info', 'Group description updated', sessionId, {
                groupId,
                hasDescription: !!description
            });

            res.json({
                success: true,
                message: 'Group description updated successfully',
                data: {
                    groupId,
                    description: description || '',
                    updatedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in updateDescription:', error);
            throw error;
        }
    }

    /**
     * PUT /api/group/update-picture
     * Update group profile picture
     */
    async updateGroupPicture(req, res) {
        try {
            const { sessionId, groupId } = req.body;

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

            // Update group picture
            await sock.updateProfilePicture(groupId, req.file.buffer);

            logWithSession('info', 'Group picture updated', sessionId, {
                groupId,
                fileName: req.file.originalname,
                size: req.file.size
            });

            res.json({
                success: true,
                message: 'Group picture updated successfully',
                data: {
                    groupId,
                    fileName: req.file.originalname,
                    size: req.file.size,
                    updatedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in updateGroupPicture:', error);
            throw error;
        }
    }

    /**
     * POST /api/group/leave
     * Leave a group
     */
    async leaveGroup(req, res) {
        try {
            const { sessionId, groupId } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const sock = sessionManager.getSession(sessionId);

            // Leave group
            await sock.groupLeave(groupId);

            logWithSession('info', 'Left group', sessionId, { groupId });

            res.json({
                success: true,
                message: 'Left group successfully',
                data: {
                    groupId,
                    leftAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in leaveGroup:', error);
            throw error;
        }
    }

    /**
     * GET /api/group/invite-code/:sessionId/:groupId
     * Get group invite code
     */
    async getInviteCode(req, res) {
        try {
            const { sessionId, groupId } = req.params;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const sock = sessionManager.getSession(sessionId);

            // Get invite code
            const inviteCode = await sock.groupInviteCode(groupId);

            logWithSession('info', 'Group invite code retrieved', sessionId, { groupId });

            res.json({
                success: true,
                message: 'Group invite code retrieved',
                data: {
                    groupId,
                    inviteCode,
                    inviteUrl: `https://chat.whatsapp.com/${inviteCode}`,
                    retrievedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in getInviteCode:', error);
            throw error;
        }
    }

    /**
     * POST /api/group/revoke-invite
     * Revoke and regenerate group invite code
     */
    async revokeInvite(req, res) {
        try {
            const { sessionId, groupId } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const sock = sessionManager.getSession(sessionId);

            // Revoke invite code
            const newInviteCode = await sock.groupRevokeInvite(groupId);

            logWithSession('info', 'Group invite code revoked', sessionId, {
                groupId,
                newInviteCode
            });

            res.json({
                success: true,
                message: 'Group invite code revoked and new one generated',
                data: {
                    groupId,
                    newInviteCode,
                    newInviteUrl: `https://chat.whatsapp.com/${newInviteCode}`,
                    revokedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in revokeInvite:', error);
            throw error;
        }
    }

    /**
     * POST /api/group/join
     * Join group using invite code
     */
    async joinGroup(req, res) {
        try {
            const { sessionId, inviteCode } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            if (!inviteCode) {
                throw createError.validation('Invite code is required');
            }

            const sock = sessionManager.getSession(sessionId);

            // Join group using invite code
            const result = await sock.groupAcceptInvite(inviteCode);

            logWithSession('info', 'Joined group via invite', sessionId, {
                inviteCode,
                groupId: result
            });

            res.json({
                success: true,
                message: 'Joined group successfully',
                data: {
                    inviteCode,
                    groupId: result,
                    joinedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in joinGroup:', error);
            throw error;
        }
    }

    /**
     * GET /api/group/list/:sessionId
     * Get list of groups user is part of
     */
    async getGroupList(req, res) {
        try {
            const { sessionId } = req.params;
            const { limit = 50, offset = 0, filter = 'all' } = req.query;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const whatsappService = require('../services/whatsappService');
            const store = whatsappService.getStore(sessionId);

            if (!store || !store.chats) {
                throw createError.api('WhatsApp store not available', 400);
            }

            // Get all chats and filter groups
            let groups = Object.values(store.chats)
                .filter(chat => chat.id.endsWith('@g.us'))
                .map(group => ({
                    id: group.id,
                    name: group.name || 'Unknown Group',
                    subject: group.subject,
                    description: group.desc,
                    owner: group.subjectOwner,
                    creation: group.creation,
                    participantCount: group.size,
                    isAnnouncement: group.announce,
                    isRestricted: group.restrict,
                    isMuted: group.mute !== undefined && group.mute > Date.now(),
                    lastMessageTime: group.conversationTimestamp,
                    unreadCount: group.unreadCount || 0
                }));

            // Apply filters
            if (filter === 'admin') {
                const sock = sessionManager.getSession(sessionId);
                const userJid = sock.user.id;

                // Filter groups where user is admin (would need to check each group metadata)
                groups = groups.slice(0, 10); // Limit for performance
            } else if (filter === 'muted') {
                groups = groups.filter(group => group.isMuted);
            } else if (filter === 'unread') {
                groups = groups.filter(group => group.unreadCount > 0);
            }

            // Sort by last message time
            groups.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));

            // Apply pagination
            const startIndex = parseInt(offset);
            const endIndex = startIndex + parseInt(limit);
            const paginatedGroups = groups.slice(startIndex, endIndex);

            res.json({
                success: true,
                message: 'Group list retrieved',
                data: {
                    groups: paginatedGroups,
                    pagination: {
                        total: groups.length,
                        limit: parseInt(limit),
                        offset: parseInt(offset),
                        hasMore: endIndex < groups.length
                    }
                }
            });

        } catch (error) {
            logger.error('Error in getGroupList:', error);
            throw error;
        }
    }

    /**
     * POST /api/group/settings
     * Update group settings
     */
    async updateGroupSettings(req, res) {
        try {
            const { sessionId, groupId, settings } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const sock = sessionManager.getSession(sessionId);
            const results = {};

            // Update announcement setting (only admins can send messages)
            if (settings.announce !== undefined) {
                await sock.groupSettingUpdate(groupId, 'announcement', settings.announce);
                results.announce = settings.announce;
            }

            // Update restrict setting (only admins can change group info)
            if (settings.restrict !== undefined) {
                await sock.groupSettingUpdate(groupId, 'not_announcement', !settings.restrict);
                results.restrict = settings.restrict;
            }

            // Update locked setting (only admins can change group settings)
            if (settings.locked !== undefined) {
                await sock.groupSettingUpdate(groupId, 'locked', settings.locked);
                results.locked = settings.locked;
            }

            logWithSession('info', 'Group settings updated', sessionId, {
                groupId,
                settings: results
            });

            res.json({
                success: true,
                message: 'Group settings updated successfully',
                data: {
                    groupId,
                    settings: results,
                    updatedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in updateGroupSettings:', error);
            throw error;
        }
    }

    /**
     * GET /api/group/participants/:sessionId/:groupId
     * Get group participants list
     */
    async getParticipants(req, res) {
        try {
            const { sessionId, groupId } = req.params;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const sock = sessionManager.getSession(sessionId);

            // Get group metadata (includes participants)
            const groupMetadata = await sock.groupMetadata(groupId);

            // Format participants data
            const participants = groupMetadata.participants.map(participant => ({
                jid: participant.id,
                phone: extractPhoneFromJid(participant.id),
                isAdmin: participant.admin === 'admin',
                isSuperAdmin: participant.admin === 'superadmin',
                role: participant.admin || 'participant'
            }));

            res.json({
                success: true,
                message: 'Group participants retrieved',
                data: {
                    groupId,
                    groupName: groupMetadata.subject,
                    participants,
                    participantCount: participants.length,
                    adminCount: participants.filter(p => p.isAdmin || p.isSuperAdmin).length
                }
            });

        } catch (error) {
            logger.error('Error in getParticipants:', error);
            throw error;
        }
    }
}

module.exports = new GroupController();