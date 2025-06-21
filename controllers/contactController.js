const sessionManager = require('../services/sessionManager');
const Contact = require('../models/Contact');
const { logger, logWithSession } = require('../utils/logger');
const { formatToWhatsAppId, extractPhoneFromJid } = require('../utils/phoneFormatter');
const { createError } = require('../middleware/error');

class ContactController {

    /**
     * GET /api/contact/list/:sessionId
     * Get contact list for a session
     */
    async getContactList(req, res) {
        try {
            const { sessionId } = req.params;
            const {
                limit = 50,
                offset = 0,
                search = '',
                filter = 'all',
                sortBy = 'name',
                sortOrder = 'asc'
            } = req.query;

            if (!sessionManager.hasSession(sessionId)) {
                throw createError.notFound('Session');
            }

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            // Build query conditions
            const where = { sessionId };

            if (search) {
                where[sequelize.Op.or] = [
                    { name: { [sequelize.Op.like]: `%${search}%` } },
                    { pushName: { [sequelize.Op.like]: `%${search}%` } },
                    { phone: { [sequelize.Op.like]: `%${search}%` } }
                ];
            }

            if (filter === 'blocked') {
                where.isBlocked = true;
            } else if (filter === 'business') {
                where.isBusiness = true;
            } else if (filter === 'active') {
                const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                where.lastMessageAt = { [sequelize.Op.gte]: thirtyDaysAgo };
            }

            // Get contacts from database
            const contacts = await Contact.findAndCountAll({
                where,
                limit: parseInt(limit),
                offset: parseInt(offset),
                order: [[sortBy, sortOrder.toUpperCase()]],
                attributes: { exclude: ['customFields'] }
            });

            // Get live data from WhatsApp store if available
            const whatsappService = require('../services/whatsappService');
            const store = whatsappService.getStore(sessionId);

            if (store && store.contacts) {
                // Merge with live WhatsApp data
                const liveContacts = Object.values(store.contacts);

                // Update database with latest info
                for (const liveContact of liveContacts.slice(0, 100)) { // Limit to avoid performance issues
                    try {
                        await Contact.findOrCreate({
                            where: { sessionId, jid: liveContact.id },
                            defaults: {
                                phone: extractPhoneFromJid(liveContact.id),
                                name: liveContact.name,
                                pushName: liveContact.notify,
                                isContact: true,
                                isOnWhatsApp: true
                            }
                        });
                    } catch (error) {
                        // Continue on individual contact errors
                    }
                }
            }

            res.json({
                success: true,
                message: 'Contact list retrieved',
                data: {
                    contacts: contacts.rows,
                    pagination: {
                        total: contacts.count,
                        limit: parseInt(limit),
                        offset: parseInt(offset),
                        hasMore: (parseInt(offset) + parseInt(limit)) < contacts.count
                    }
                }
            });

        } catch (error) {
            logger.error('Error in getContactList:', error);
            throw error;
        }
    }

    /**
     * GET /api/contact/profile/:sessionId/:jid
     * Get detailed contact profile
     */
    async getContactProfile(req, res) {
        try {
            const { sessionId, jid } = req.params;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const sock = sessionManager.getSession(sessionId);

            // Get contact from database
            let contact = await Contact.findByJid(sessionId, jid);

            // Get live data from WhatsApp
            const profileData = {};

            try {
                // Get profile picture
                profileData.profilePicture = await sock.profilePictureUrl(jid, 'image');
            } catch (error) {
                profileData.profilePicture = null;
            }

            try {
                // Get status
                const statusResult = await sock.fetchStatus(jid);
                profileData.status = statusResult?.status || null;
            } catch (error) {
                profileData.status = null;
            }

            try {
                // Get business profile if applicable
                profileData.businessProfile = await sock.getBusinessProfile(jid);
            } catch (error) {
                profileData.businessProfile = null;
            }

            // Update contact in database if exists
            if (contact) {
                if (profileData.profilePicture) {
                    await contact.updateProfilePicture(profileData.profilePicture);
                }
                if (profileData.status) {
                    contact.status = profileData.status;
                    await contact.save();
                }
                if (profileData.businessProfile) {
                    await contact.updateBusinessInfo(profileData.businessProfile);
                }
            } else {
                // Create new contact
                contact = await Contact.create({
                    sessionId,
                    jid,
                    phone: extractPhoneFromJid(jid),
                    profilePictureUrl: profileData.profilePicture,
                    status: profileData.status,
                    isBusiness: !!profileData.businessProfile,
                    isOnWhatsApp: true
                });

                if (profileData.businessProfile) {
                    await contact.updateBusinessInfo(profileData.businessProfile);
                }
            }

            logWithSession('info', 'Contact profile retrieved', sessionId, { jid });

            res.json({
                success: true,
                message: 'Contact profile retrieved',
                data: {
                    contact: contact,
                    profile: profileData
                }
            });

        } catch (error) {
            logger.error('Error in getContactProfile:', error);
            throw error;
        }
    }

    /**
     * POST /api/contact/sync
     * Sync contacts from WhatsApp to database
     */
    async syncContacts(req, res) {
        try {
            const { sessionId } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const whatsappService = require('../services/whatsappService');
            const store = whatsappService.getStore(sessionId);

            if (!store || !store.contacts) {
                throw createError.api('WhatsApp store not available', 400);
            }

            const liveContacts = Object.values(store.contacts);
            let synced = 0;
            let updated = 0;
            let errors = 0;

            for (const liveContact of liveContacts) {
                try {
                    const [contact, created] = await Contact.findOrCreate({
                        where: { sessionId, jid: liveContact.id },
                        defaults: {
                            phone: extractPhoneFromJid(liveContact.id),
                            name: liveContact.name,
                            pushName: liveContact.notify,
                            isContact: true,
                            isOnWhatsApp: true
                        }
                    });

                    if (created) {
                        synced++;
                    } else {
                        // Update existing contact
                        let hasChanges = false;

                        if (liveContact.name && contact.name !== liveContact.name) {
                            contact.name = liveContact.name;
                            hasChanges = true;
                        }

                        if (liveContact.notify && contact.pushName !== liveContact.notify) {
                            contact.pushName = liveContact.notify;
                            hasChanges = true;
                        }

                        if (hasChanges) {
                            await contact.save();
                            updated++;
                        }
                    }
                } catch (error) {
                    errors++;
                }
            }

            logWithSession('info', 'Contacts synced', sessionId, { synced, updated, errors });

            res.json({
                success: true,
                message: 'Contacts synchronized',
                data: {
                    total: liveContacts.length,
                    synced,
                    updated,
                    errors
                }
            });

        } catch (error) {
            logger.error('Error in syncContacts:', error);
            throw error;
        }
    }

    /**
     * POST /api/contact/block
     * Block a contact
     */
    async blockContact(req, res) {
        try {
            const { sessionId, jid } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const sock = sessionManager.getSession(sessionId);
            const config = sessionManager.getSessionConfig(sessionId);

            // Format JID if it's a phone number
            const targetJid = jid.includes('@') ? jid : formatToWhatsAppId(jid, config.countryCode);

            // Block on WhatsApp
            await sock.updateBlockStatus(targetJid, 'block');

            // Update in database
            const contact = await Contact.findByJid(sessionId, targetJid);
            if (contact) {
                await contact.block();
            }

            logWithSession('info', 'Contact blocked', sessionId, { jid: targetJid });

            res.json({
                success: true,
                message: 'Contact blocked successfully',
                data: {
                    jid: targetJid,
                    blocked: true
                }
            });

        } catch (error) {
            logger.error('Error in blockContact:', error);
            throw error;
        }
    }

    /**
     * POST /api/contact/unblock
     * Unblock a contact
     */
    async unblockContact(req, res) {
        try {
            const { sessionId, jid } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const sock = sessionManager.getSession(sessionId);
            const config = sessionManager.getSessionConfig(sessionId);

            // Format JID if it's a phone number
            const targetJid = jid.includes('@') ? jid : formatToWhatsAppId(jid, config.countryCode);

            // Unblock on WhatsApp
            await sock.updateBlockStatus(targetJid, 'unblock');

            // Update in database
            const contact = await Contact.findByJid(sessionId, targetJid);
            if (contact) {
                await contact.unblock();
            }

            logWithSession('info', 'Contact unblocked', sessionId, { jid: targetJid });

            res.json({
                success: true,
                message: 'Contact unblocked successfully',
                data: {
                    jid: targetJid,
                    blocked: false
                }
            });

        } catch (error) {
            logger.error('Error in unblockContact:', error);
            throw error;
        }
    }

    /**
     * GET /api/contact/blocked/:sessionId
     * Get list of blocked contacts
     */
    async getBlockedContacts(req, res) {
        try {
            const { sessionId } = req.params;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            // Get from WhatsApp
            const sock = sessionManager.getSession(sessionId);
            const blockedJids = await sock.fetchBlocklist();

            // Get from database
            const blockedContacts = await Contact.getBlockedContacts(sessionId);

            res.json({
                success: true,
                message: 'Blocked contacts retrieved',
                data: {
                    whatsappBlocked: blockedJids,
                    databaseBlocked: blockedContacts,
                    total: blockedJids.length
                }
            });

        } catch (error) {
            logger.error('Error in getBlockedContacts:', error);
            throw error;
        }
    }

    /**
     * POST /api/contact/presence
     * Get contact presence status
     */
    async getPresence(req, res) {
        try {
            const { sessionId, jid } = req.body;

            if (!sessionManager.isSessionConnected(sessionId)) {
                throw createError.session('Session not connected', sessionId);
            }

            const sock = sessionManager.getSession(sessionId);
            const config = sessionManager.getSessionConfig(sessionId);

            // Format JID if it's a phone number
            const targetJid = jid.includes('@') ? jid : formatToWhatsAppId(jid, config.countryCode);

            // Subscribe to presence updates
            await sock.presenceSubscribe(targetJid);

            // Get current presence from store
            const whatsappService = require('../services/whatsappService');
            const store = whatsappService.getStore(sessionId);
            const presence = store?.presences?.[targetJid] || null;

            // Update contact in database
            const contact = await Contact.findByJid(sessionId, targetJid);
            if (contact && presence) {
                await contact.updatePresence(presence.lastKnownPresence, presence.lastSeen);
            }

            res.json({
                success: true,
                message: 'Presence information retrieved',
                data: {
                    jid: targetJid,
                    presence: presence,
                    subscribed: true
                }
            });

        } catch (error) {
            logger.error('Error in getPresence:', error);
            throw error;
        }
    }

    /**
     * POST /api/contact/add-tag
     * Add tag to contact
     */
    async addTag(req, res) {
        try {
            const { sessionId, jid, tag } = req.body;

            if (!tag || tag.trim().length === 0) {
                throw createError.validation('Tag is required');
            }

            let contact = await Contact.findByJid(sessionId, jid);

            if (!contact) {
                // Create contact if not exists
                contact = await Contact.create({
                    sessionId,
                    jid,
                    phone: extractPhoneFromJid(jid)
                });
            }

            await contact.addTag(tag.trim());

            logWithSession('info', 'Tag added to contact', sessionId, { jid, tag });

            res.json({
                success: true,
                message: 'Tag added successfully',
                data: {
                    jid,
                    tag,
                    tags: contact.tags
                }
            });

        } catch (error) {
            logger.error('Error in addTag:', error);
            throw error;
        }
    }

    /**
     * POST /api/contact/remove-tag
     * Remove tag from contact
     */
    async removeTag(req, res) {
        try {
            const { sessionId, jid, tag } = req.body;

            const contact = await Contact.findByJid(sessionId, jid);
            if (!contact) {
                throw createError.notFound('Contact');
            }

            await contact.removeTag(tag);

            logWithSession('info', 'Tag removed from contact', sessionId, { jid, tag });

            res.json({
                success: true,
                message: 'Tag removed successfully',
                data: {
                    jid,
                    tag,
                    tags: contact.tags
                }
            });

        } catch (error) {
            logger.error('Error in removeTag:', error);
            throw error;
        }
    }

    /**
     * PUT /api/contact/update
     * Update contact information
     */
    async updateContact(req, res) {
        try {
            const { sessionId, jid, displayName, notes, customFields } = req.body;

            let contact = await Contact.findByJid(sessionId, jid);

            if (!contact) {
                // Create contact if not exists
                contact = await Contact.create({
                    sessionId,
                    jid,
                    phone: extractPhoneFromJid(jid)
                });
            }

            // Update fields
            if (displayName !== undefined) {
                contact.displayName = displayName;
            }

            if (notes !== undefined) {
                contact.notes = notes;
            }

            if (customFields !== undefined) {
                const currentFields = contact.customFields || {};
                contact.customFields = { ...currentFields, ...customFields };
            }

            await contact.save();

            logWithSession('info', 'Contact updated', sessionId, { jid });

            res.json({
                success: true,
                message: 'Contact updated successfully',
                data: contact
            });

        } catch (error) {
            logger.error('Error in updateContact:', error);
            throw error;
        }
    }

    /**
     * GET /api/contact/stats/:sessionId
     * Get contact statistics
     */
    async getContactStats(req, res) {
        try {
            const { sessionId } = req.params;

            const stats = await Contact.getSessionStats(sessionId);

            res.json({
                success: true,
                message: 'Contact statistics retrieved',
                data: stats
            });

        } catch (error) {
            logger.error('Error in getContactStats:', error);
            throw error;
        }
    }

    /**
     * POST /api/contact/search
     * Search contacts
     */
    async searchContacts(req, res) {
        try {
            const { sessionId, query, limit = 50 } = req.body;

            if (!query || query.trim().length < 2) {
                throw createError.validation('Search query must be at least 2 characters');
            }

            const contacts = await Contact.searchContacts(sessionId, query.trim(), parseInt(limit));

            res.json({
                success: true,
                message: 'Contact search completed',
                data: {
                    query: query.trim(),
                    results: contacts,
                    total: contacts.length
                }
            });

        } catch (error) {
            logger.error('Error in searchContacts:', error);
            throw error;
        }
    }

    /**
     * DELETE /api/contact/delete
     * Delete contact from database
     */
    async deleteContact(req, res) {
        try {
            const { sessionId, jid } = req.body;

            const contact = await Contact.findByJid(sessionId, jid);
            if (!contact) {
                throw createError.notFound('Contact');
            }

            await contact.destroy();

            logWithSession('info', 'Contact deleted', sessionId, { jid });

            res.json({
                success: true,
                message: 'Contact deleted successfully',
                data: { jid }
            });

        } catch (error) {
            logger.error('Error in deleteContact:', error);
            throw error;
        }
    }
}

module.exports = new ContactController();