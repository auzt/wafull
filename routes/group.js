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
    validateSessionConnected
} = require('../middleware/validation');

const { formatToWhatsAppId } = require('../utils/phoneFormatter');
const { logWithSession } = require('../utils/logger');

/**
 * Apply middleware untuk semua group routes
 */
router.use(sanitizeInput);
router.use(sessionRateLimit);

/**
 * POST /api/group/create
 * Create new group
 */
router.post('/create',
    validateRequired(['sessionId', 'subject', 'participants']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, subject, participants } = req.body;
            const sessionManager = require('../services/sessionManager');

            const sock = sessionManager.getSession(sessionId);
            const config = sessionManager.getSessionConfig(sessionId);

            // Format participants
            const participantJids = participants.map(phone =>
                formatToWhatsAppId(phone, config.countryCode)
            );

            // Create group
            const group = await sock.groupCreate(subject, participantJids);

            logWithSession('info', 'Group created', sessionId, {
                groupId: group.id,
                subject: subject,
                participants: participantJids.length
            });

            res.json({
                success: true,
                message: 'Group created successfully',
                data: {
                    groupId: group.id,
                    subject: subject,
                    participants: participantJids,
                    inviteCode: group.inviteCode || null
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
 * POST /api/group/add-participant
 * Add participant to group
 */
router.post('/add-participant',
    validateRequired(['sessionId', 'groupId', 'participants']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, groupId, participants } = req.body;
            const sessionManager = require('../services/sessionManager');

            const sock = sessionManager.getSession(sessionId);
            const config = sessionManager.getSessionConfig(sessionId);

            // Format participants
            const participantJids = Array.isArray(participants)
                ? participants.map(phone => formatToWhatsAppId(phone, config.countryCode))
                : [formatToWhatsAppId(participants, config.countryCode)];

            // Add participants
            const result = await sock.groupParticipantsUpdate(groupId, participantJids, 'add');

            logWithSession('info', 'Participants added to group', sessionId, {
                groupId: groupId,
                participants: participantJids
            });

            res.json({
                success: true,
                message: 'Participants added successfully',
                data: result
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
 * POST /api/group/remove-participant
 * Remove participant from group
 */
router.post('/remove-participant',
    validateRequired(['sessionId', 'groupId', 'participants']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, groupId, participants } = req.body;
            const sessionManager = require('../services/sessionManager');

            const sock = sessionManager.getSession(sessionId);
            const config = sessionManager.getSessionConfig(sessionId);

            // Format participants
            const participantJids = Array.isArray(participants)
                ? participants.map(phone => formatToWhatsAppId(phone, config.countryCode))
                : [formatToWhatsAppId(participants, config.countryCode)];

            // Remove participants
            const result = await sock.groupParticipantsUpdate(groupId, participantJids, 'remove');

            logWithSession('info', 'Participants removed from group', sessionId, {
                groupId: groupId,
                participants: participantJids
            });

            res.json({
                success: true,
                message: 'Participants removed successfully',
                data: result
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
 * POST /api/group/promote-admin
 * Promote participant to admin
 */
router.post('/promote-admin',
    validateRequired(['sessionId', 'groupId', 'participants']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, groupId, participants } = req.body;
            const sessionManager = require('../services/sessionManager');

            const sock = sessionManager.getSession(sessionId);
            const config = sessionManager.getSessionConfig(sessionId);

            // Format participants
            const participantJids = Array.isArray(participants)
                ? participants.map(phone => formatToWhatsAppId(phone, config.countryCode))
                : [formatToWhatsAppId(participants, config.countryCode)];

            // Promote to admin
            const result = await sock.groupParticipantsUpdate(groupId, participantJids, 'promote');

            logWithSession('info', 'Participants promoted to admin', sessionId, {
                groupId: groupId,
                participants: participantJids
            });

            res.json({
                success: true,
                message: 'Participants promoted to admin successfully',
                data: result
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
 * POST /api/group/demote-admin
 * Demote admin to participant
 */
router.post('/demote-admin',
    validateRequired(['sessionId', 'groupId', 'participants']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, groupId, participants } = req.body;
            const sessionManager = require('../services/sessionManager');

            const sock = sessionManager.getSession(sessionId);
            const config = sessionManager.getSessionConfig(sessionId);

            // Format participants
            const participantJids = Array.isArray(participants)
                ? participants.map(phone => formatToWhatsAppId(phone, config.countryCode))
                : [formatToWhatsAppId(participants, config.countryCode)];

            // Demote from admin
            const result = await sock.groupParticipantsUpdate(groupId, participantJids, 'demote');

            logWithSession('info', 'Admins demoted to participants', sessionId, {
                groupId: groupId,
                participants: participantJids
            });

            res.json({
                success: true,
                message: 'Admins demoted to participants successfully',
                data: result
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
 * POST /api/group/update-subject
 * Update group subject (name)
 */
router.post('/update-subject',
    validateRequired(['sessionId', 'groupId', 'subject']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, groupId, subject } = req.body;
            const sessionManager = require('../services/sessionManager');

            const sock = sessionManager.getSession(sessionId);

            // Update group subject
            await sock.groupUpdateSubject(groupId, subject);

            logWithSession('info', 'Group subject updated', sessionId, {
                groupId: groupId,
                newSubject: subject
            });

            res.json({
                success: true,
                message: 'Group subject updated successfully',
                data: {
                    groupId: groupId,
                    subject: subject
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
 * POST /api/group/update-description
 * Update group description
 */
router.post('/update-description',
    validateRequired(['sessionId', 'groupId', 'description']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, groupId, description } = req.body;
            const sessionManager = require('../services/sessionManager');

            const sock = sessionManager.getSession(sessionId);

            // Update group description
            await sock.groupUpdateDescription(groupId, description);

            logWithSession('info', 'Group description updated', sessionId, {
                groupId: groupId,
                newDescription: description
            });

            res.json({
                success: true,
                message: 'Group description updated successfully',
                data: {
                    groupId: groupId,
                    description: description
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
 * POST /api/group/leave
 * Leave group
 */
router.post('/leave',
    validateRequired(['sessionId', 'groupId']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, groupId } = req.body;
            const sessionManager = require('../services/sessionManager');

            const sock = sessionManager.getSession(sessionId);

            // Leave group
            await sock.groupLeave(groupId);

            logWithSession('info', 'Left group', sessionId, {
                groupId: groupId
            });

            res.json({
                success: true,
                message: 'Left group successfully',
                data: {
                    groupId: groupId
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
 * GET /api/group/info/:sessionId/:groupId
 * Get group information
 */
router.get('/info/:sessionId/:groupId',
    async (req, res) => {
        try {
            const { sessionId, groupId } = req.params;
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

            // Get group metadata
            const groupMetadata = await sock.groupMetadata(groupId);

            res.json({
                success: true,
                message: 'Group information retrieved',
                data: groupMetadata
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
 * POST /api/group/invite-code
 * Get group invite code
 */
router.post('/invite-code',
    validateRequired(['sessionId', 'groupId']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, groupId } = req.body;
            const sessionManager = require('../services/sessionManager');

            const sock = sessionManager.getSession(sessionId);

            // Get invite code
            const inviteCode = await sock.groupInviteCode(groupId);

            logWithSession('info', 'Group invite code retrieved', sessionId, {
                groupId: groupId
            });

            res.json({
                success: true,
                message: 'Group invite code retrieved',
                data: {
                    groupId: groupId,
                    inviteCode: inviteCode,
                    inviteUrl: `https://chat.whatsapp.com/${inviteCode}`
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
 * POST /api/group/revoke-invite
 * Revoke group invite code
 */
router.post('/revoke-invite',
    validateRequired(['sessionId', 'groupId']),
    validateSessionExists,
    validateSessionConnected,
    async (req, res) => {
        try {
            const { sessionId, groupId } = req.body;
            const sessionManager = require('../services/sessionManager');

            const sock = sessionManager.getSession(sessionId);

            // Revoke invite code
            const newInviteCode = await sock.groupRevokeInvite(groupId);

            logWithSession('info', 'Group invite code revoked', sessionId, {
                groupId: groupId,
                newInviteCode: newInviteCode
            });

            res.json({
                success: true,
                message: 'Group invite code revoked and new one generated',
                data: {
                    groupId: groupId,
                    newInviteCode: newInviteCode,
                    newInviteUrl: `https://chat.whatsapp.com/${newInviteCode}`
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