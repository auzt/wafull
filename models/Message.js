const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Message = sequelize.define('Message', {
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

    // WhatsApp message ID
    waMessageId: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'WhatsApp generated message ID'
    },

    // Message direction
    direction: {
        type: DataTypes.ENUM('OUTGOING', 'INCOMING'),
        allowNull: false
    },

    // Message type
    messageType: {
        type: DataTypes.ENUM(
            'TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT',
            'LOCATION', 'CONTACT', 'POLL', 'LIST', 'BUTTON',
            'REACTION', 'FORWARD', 'REPLY', 'EDIT', 'DELETE'
        ),
        allowNull: false
    },

    // Recipient info
    recipientType: {
        type: DataTypes.ENUM('INDIVIDUAL', 'GROUP', 'BROADCAST'),
        defaultValue: 'INDIVIDUAL'
    },

    // Phone numbers (for outgoing) or sender (for incoming)
    phoneNumbers: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'JSON array of phone numbers for outgoing messages'
    },

    fromJid: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Sender JID for incoming messages'
    },

    toJid: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Recipient JID'
    },

    groupJid: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Group JID if message in group'
    },

    // Message content
    content: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Text content of the message'
    },

    // Media info
    mediaType: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: 'MIME type for media messages'
    },

    mediaFileName: {
        type: DataTypes.STRING(255),
        allowNull: true
    },

    mediaSize: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Media file size in bytes'
    },

    mediaUrl: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'URL to downloaded media file'
    },

    // Location data
    latitude: {
        type: DataTypes.DECIMAL(10, 8),
        allowNull: true
    },

    longitude: {
        type: DataTypes.DECIMAL(11, 8),
        allowNull: true
    },

    locationName: {
        type: DataTypes.STRING(200),
        allowNull: true
    },

    locationAddress: {
        type: DataTypes.TEXT,
        allowNull: true
    },

    // Contact data
    contactName: {
        type: DataTypes.STRING(100),
        allowNull: true
    },

    contactPhone: {
        type: DataTypes.STRING(20),
        allowNull: true
    },

    contactVcard: {
        type: DataTypes.TEXT,
        allowNull: true
    },

    // Quoted/Reply message
    quotedMessageId: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'ID of quoted message'
    },

    quotedContent: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Content of quoted message'
    },

    // Reaction data
    reactionEmoji: {
        type: DataTypes.STRING(10),
        allowNull: true
    },

    reactedToMessageId: {
        type: DataTypes.STRING(100),
        allowNull: true
    },

    // Message status
    status: {
        type: DataTypes.ENUM('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'DELETED'),
        defaultValue: 'PENDING'
    },

    // Error info
    errorMessage: {
        type: DataTypes.TEXT,
        allowNull: true
    },

    retryCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },

    // Timestamps
    sentAt: {
        type: DataTypes.DATE,
        allowNull: true
    },

    deliveredAt: {
        type: DataTypes.DATE,
        allowNull: true
    },

    readAt: {
        type: DataTypes.DATE,
        allowNull: true
    },

    // WhatsApp timestamp
    waTimestamp: {
        type: DataTypes.BIGINT,
        allowNull: true,
        comment: 'WhatsApp message timestamp'
    },

    // Additional data
    rawData: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Raw WhatsApp message data (JSON)',
        get() {
            const value = this.getDataValue('rawData');
            return value ? JSON.parse(value) : null;
        },
        set(value) {
            this.setDataValue('rawData', value ? JSON.stringify(value) : null);
        }
    },

    metadata: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Additional metadata (JSON)',
        get() {
            const value = this.getDataValue('metadata');
            return value ? JSON.parse(value) : {};
        },
        set(value) {
            this.setDataValue('metadata', JSON.stringify(value));
        }
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
    tableName: 'messages',
    indexes: [
        {
            fields: ['sessionId']
        },
        {
            fields: ['waMessageId']
        },
        {
            fields: ['direction']
        },
        {
            fields: ['messageType']
        },
        {
            fields: ['status']
        },
        {
            fields: ['fromJid']
        },
        {
            fields: ['toJid']
        },
        {
            fields: ['groupJid']
        },
        {
            fields: ['createdAt']
        },
        {
            fields: ['waTimestamp']
        },
        {
            fields: ['quotedMessageId']
        },
        {
            fields: ['reactedToMessageId']
        }
    ]
});

// Instance methods
Message.prototype.updateStatus = async function (status, additionalData = {}) {
    this.status = status;

    if (status === 'SENT') {
        this.sentAt = new Date();
        if (additionalData.waMessageId) {
            this.waMessageId = additionalData.waMessageId;
        }
        if (additionalData.waTimestamp) {
            this.waTimestamp = additionalData.waTimestamp;
        }
    } else if (status === 'DELIVERED') {
        this.deliveredAt = new Date();
    } else if (status === 'READ') {
        this.readAt = new Date();
    } else if (status === 'FAILED') {
        this.errorMessage = additionalData.error;
        this.retryCount += 1;
    }

    if (additionalData.metadata) {
        const currentMetadata = this.metadata || {};
        this.metadata = { ...currentMetadata, ...additionalData.metadata };
    }

    return this.save();
};

Message.prototype.isDelivered = function () {
    return ['DELIVERED', 'READ'].includes(this.status);
};

Message.prototype.isRead = function () {
    return this.status === 'READ';
};

Message.prototype.isFailed = function () {
    return this.status === 'FAILED';
};

Message.prototype.canRetry = function () {
    return this.status === 'FAILED' && this.retryCount < 3;
};

Message.prototype.getRecipients = function () {
    try {
        return this.phoneNumbers ? JSON.parse(this.phoneNumbers) : [];
    } catch {
        return [];
    }
};

Message.prototype.getSummary = function () {
    const summary = {
        id: this.id,
        waMessageId: this.waMessageId,
        direction: this.direction,
        messageType: this.messageType,
        status: this.status,
        createdAt: this.createdAt,
        sentAt: this.sentAt
    };

    if (this.direction === 'OUTGOING') {
        summary.recipients = this.getRecipients();
        summary.recipientCount = this.getRecipients().length;
    } else {
        summary.fromJid = this.fromJid;
    }

    if (this.messageType === 'TEXT') {
        summary.content = this.content?.substring(0, 100) + (this.content?.length > 100 ? '...' : '');
    } else if (['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'].includes(this.messageType)) {
        summary.mediaInfo = {
            fileName: this.mediaFileName,
            size: this.mediaSize,
            type: this.mediaType
        };
    } else if (this.messageType === 'LOCATION') {
        summary.location = {
            name: this.locationName,
            latitude: this.latitude,
            longitude: this.longitude
        };
    }

    return summary;
};

// Static methods
Message.getSessionStats = async function (sessionId) {
    const total = await this.count({ where: { sessionId } });
    const sent = await this.count({
        where: {
            sessionId,
            direction: 'OUTGOING',
            status: ['SENT', 'DELIVERED', 'READ']
        }
    });
    const received = await this.count({
        where: {
            sessionId,
            direction: 'INCOMING'
        }
    });
    const failed = await this.count({
        where: {
            sessionId,
            status: 'FAILED'
        }
    });

    return {
        total,
        sent,
        received,
        failed,
        pending: total - sent - received - failed
    };
};

Message.getRecentMessages = function (sessionId, limit = 50, offset = 0) {
    return this.findAll({
        where: { sessionId },
        order: [['createdAt', 'DESC']],
        limit,
        offset,
        attributes: { exclude: ['rawData'] }
    });
};

Message.getMessagesByType = function (sessionId, messageType, limit = 50) {
    return this.findAll({
        where: {
            sessionId,
            messageType
        },
        order: [['createdAt', 'DESC']],
        limit,
        attributes: { exclude: ['rawData'] }
    });
};

Message.getFailedMessages = function (sessionId) {
    return this.findAll({
        where: {
            sessionId,
            status: 'FAILED',
            retryCount: { [sequelize.Op.lt]: 3 }
        },
        order: [['createdAt', 'ASC']]
    });
};

Message.searchMessages = function (sessionId, query, limit = 50) {
    return this.findAll({
        where: {
            sessionId,
            [sequelize.Op.or]: [
                { content: { [sequelize.Op.like]: `%${query}%` } },
                { contactName: { [sequelize.Op.like]: `%${query}%` } },
                { locationName: { [sequelize.Op.like]: `%${query}%` } }
            ]
        },
        order: [['createdAt', 'DESC']],
        limit,
        attributes: { exclude: ['rawData'] }
    });
};

Message.cleanupOldMessages = async function (olderThanDays = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.destroy({
        where: {
            createdAt: {
                [sequelize.Op.lt]: cutoffDate
            }
        }
    });

    return result;
};

// Association with Session
Message.belongsTo(require('./Session'), {
    foreignKey: 'sessionId',
    as: 'session'
});

module.exports = Message;