const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Contact = sequelize.define('Contact', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },

    sessionId: {
        type: DataTypes.STRING(50),
        allowNull: false,
        references: {
            model: 'sessions',
            key: 'id'
        }
    },

    // WhatsApp ID
    jid: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: 'WhatsApp JID (e.g., 628123456789@s.whatsapp.net)'
    },

    // Phone number
    phone: {
        type: DataTypes.STRING(20),
        allowNull: false,
        comment: 'Phone number in international format'
    },

    // Contact information
    name: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Contact name from WhatsApp'
    },

    pushName: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Push name (display name in WhatsApp)'
    },

    displayName: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Display name (custom name set by user)'
    },

    // Profile information
    status: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'WhatsApp status message'
    },

    profilePictureUrl: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'URL to profile picture'
    },

    profilePictureUpdatedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },

    // Business account info
    isBusiness: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },

    businessCategory: {
        type: DataTypes.STRING(100),
        allowNull: true
    },

    businessDescription: {
        type: DataTypes.TEXT,
        allowNull: true
    },

    businessEmail: {
        type: DataTypes.STRING(255),
        allowNull: true
    },

    businessWebsite: {
        type: DataTypes.STRING(500),
        allowNull: true
    },

    businessAddress: {
        type: DataTypes.TEXT,
        allowNull: true
    },

    // Interaction stats
    messageCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: 'Total messages exchanged'
    },

    lastMessageAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Last message timestamp'
    },

    lastSentAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Last outgoing message timestamp'
    },

    lastReceivedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Last incoming message timestamp'
    },

    // Contact status
    isBlocked: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },

    isContact: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: 'Is in phone contacts'
    },

    isOnWhatsApp: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        comment: 'Number exists on WhatsApp'
    },

    lastSeen: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Last seen timestamp'
    },

    presence: {
        type: DataTypes.ENUM('unavailable', 'available', 'composing', 'recording', 'paused'),
        allowNull: true,
        comment: 'Current presence status'
    },

    presenceUpdatedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },

    // Custom fields
    tags: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'JSON array of custom tags',
        get() {
            const value = this.getDataValue('tags');
            return value ? JSON.parse(value) : [];
        },
        set(value) {
            this.setDataValue('tags', Array.isArray(value) ? JSON.stringify(value) : '[]');
        }
    },

    notes: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Custom notes about this contact'
    },

    customFields: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Additional custom data (JSON)',
        get() {
            const value = this.getDataValue('customFields');
            return value ? JSON.parse(value) : {};
        },
        set(value) {
            this.setDataValue('customFields', JSON.stringify(value));
        }
    },

    // Timestamps
    firstContactAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'First time contacted'
    },

    createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },

    updatedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'contacts',
    indexes: [
        {
            fields: ['sessionId']
        },
        {
            fields: ['jid']
        },
        {
            fields: ['phone']
        },
        {
            unique: true,
            fields: ['sessionId', 'jid']
        },
        {
            fields: ['name']
        },
        {
            fields: ['pushName']
        },
        {
            fields: ['isBlocked']
        },
        {
            fields: ['isContact']
        },
        {
            fields: ['isBusiness']
        },
        {
            fields: ['lastMessageAt']
        },
        {
            fields: ['messageCount']
        }
    ]
});

// Instance methods
Contact.prototype.updatePresence = async function (presence, lastSeen = null) {
    this.presence = presence;
    this.presenceUpdatedAt = new Date();
    if (lastSeen) {
        this.lastSeen = lastSeen;
    }
    return this.save();
};

Contact.prototype.updateProfilePicture = async function (url) {
    this.profilePictureUrl = url;
    this.profilePictureUpdatedAt = new Date();
    return this.save();
};

Contact.prototype.updateBusinessInfo = async function (businessData) {
    this.isBusiness = true;
    this.businessCategory = businessData.category;
    this.businessDescription = businessData.description;
    this.businessEmail = businessData.email;
    this.businessWebsite = businessData.website;
    this.businessAddress = businessData.address;
    return this.save();
};

Contact.prototype.incrementMessageCount = async function (direction = 'both') {
    this.messageCount += 1;
    this.lastMessageAt = new Date();

    if (direction === 'sent' || direction === 'both') {
        this.lastSentAt = new Date();
        if (!this.firstContactAt) {
            this.firstContactAt = new Date();
        }
    }

    if (direction === 'received' || direction === 'both') {
        this.lastReceivedAt = new Date();
    }

    return this.save();
};

Contact.prototype.addTag = async function (tag) {
    const tags = this.tags || [];
    if (!tags.includes(tag)) {
        tags.push(tag);
        this.tags = tags;
        return this.save();
    }
    return this;
};

Contact.prototype.removeTag = async function (tag) {
    const tags = this.tags || [];
    const index = tags.indexOf(tag);
    if (index > -1) {
        tags.splice(index, 1);
        this.tags = tags;
        return this.save();
    }
    return this;
};

Contact.prototype.block = async function () {
    this.isBlocked = true;
    return this.save();
};

Contact.prototype.unblock = async function () {
    this.isBlocked = false;
    return this.save();
};

Contact.prototype.getDisplayName = function () {
    return this.displayName || this.name || this.pushName || this.phone;
};

Contact.prototype.isActive = function () {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    return this.lastMessageAt && this.lastMessageAt > oneMonthAgo;
};

Contact.prototype.getActivityLevel = function () {
    if (!this.lastMessageAt) return 'never';

    const now = new Date();
    const daysDiff = Math.floor((now - this.lastMessageAt) / (1000 * 60 * 60 * 24));

    if (daysDiff <= 7) return 'active';
    if (daysDiff <= 30) return 'recent';
    if (daysDiff <= 90) return 'old';
    return 'inactive';
};

Contact.prototype.getSummary = function () {
    return {
        id: this.id,
        jid: this.jid,
        phone: this.phone,
        name: this.getDisplayName(),
        isBusiness: this.isBusiness,
        isBlocked: this.isBlocked,
        messageCount: this.messageCount,
        lastMessageAt: this.lastMessageAt,
        activityLevel: this.getActivityLevel(),
        presence: this.presence,
        tags: this.tags
    };
};

// Static methods
Contact.findByPhone = function (sessionId, phone) {
    return this.findOne({
        where: {
            sessionId,
            phone
        }
    });
};

Contact.findByJid = function (sessionId, jid) {
    return this.findOne({
        where: {
            sessionId,
            jid
        }
    });
};

Contact.getBusinessContacts = function (sessionId) {
    return this.findAll({
        where: {
            sessionId,
            isBusiness: true
        },
        order: [['businessCategory', 'ASC'], ['name', 'ASC']]
    });
};

Contact.getBlockedContacts = function (sessionId) {
    return this.findAll({
        where: {
            sessionId,
            isBlocked: true
        },
        order: [['updatedAt', 'DESC']]
    });
};

Contact.getActiveContacts = function (sessionId, limit = 50) {
    return this.findAll({
        where: {
            sessionId,
            lastMessageAt: {
                [sequelize.Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days
            }
        },
        order: [['lastMessageAt', 'DESC']],
        limit
    });
};

Contact.searchContacts = function (sessionId, query, limit = 50) {
    return this.findAll({
        where: {
            sessionId,
            [sequelize.Op.or]: [
                { name: { [sequelize.Op.like]: `%${query}%` } },
                { pushName: { [sequelize.Op.like]: `%${query}%` } },
                { displayName: { [sequelize.Op.like]: `%${query}%` } },
                { phone: { [sequelize.Op.like]: `%${query}%` } },
                { businessCategory: { [sequelize.Op.like]: `%${query}%` } }
            ]
        },
        order: [['messageCount', 'DESC'], ['lastMessageAt', 'DESC']],
        limit
    });
};

Contact.getContactsByTag = function (sessionId, tag) {
    return this.findAll({
        where: {
            sessionId,
            tags: {
                [sequelize.Op.like]: `%"${tag}"%`
            }
        },
        order: [['name', 'ASC']]
    });
};

Contact.getSessionStats = async function (sessionId) {
    const total = await this.count({ where: { sessionId } });
    const business = await this.count({
        where: {
            sessionId,
            isBusiness: true
        }
    });
    const blocked = await this.count({
        where: {
            sessionId,
            isBlocked: true
        }
    });
    const active = await this.count({
        where: {
            sessionId,
            lastMessageAt: {
                [sequelize.Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
            }
        }
    });

    return {
        total,
        business,
        blocked,
        active,
        inactive: total - active
    };
};

Contact.cleanupInactiveContacts = async function (olderThanDays = 180) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.destroy({
        where: {
            messageCount: 0,
            createdAt: {
                [sequelize.Op.lt]: cutoffDate
            }
        }
    });

    return result;
};

// Association with Session
Contact.belongsTo(require('./Session'), {
    foreignKey: 'sessionId',
    as: 'session'
});

module.exports = Contact;