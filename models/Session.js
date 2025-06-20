const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Session = sequelize.define('Session', {
    id: {
        type: DataTypes.STRING(50),
        primaryKey: true,
        allowNull: false
    },

    name: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Display name for the session'
    },

    phone: {
        type: DataTypes.STRING(20),
        allowNull: true,
        comment: 'Phone number associated with session'
    },

    jid: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'WhatsApp JID when connected'
    },

    status: {
        type: DataTypes.ENUM('CONNECTING', 'CONNECTED', 'DISCONNECTED', 'BANNED', 'QR_GENERATED', 'PAIRING'),
        defaultValue: 'DISCONNECTED',
        allowNull: false
    },

    // Configuration JSON
    config: {
        type: DataTypes.TEXT,
        allowNull: true,
        get() {
            const value = this.getDataValue('config');
            return value ? JSON.parse(value) : {};
        },
        set(value) {
            this.setDataValue('config', JSON.stringify(value));
        }
    },

    // User info when connected
    userInfo: {
        type: DataTypes.TEXT,
        allowNull: true,
        get() {
            const value = this.getDataValue('userInfo');
            return value ? JSON.parse(value) : null;
        },
        set(value) {
            this.setDataValue('userInfo', value ? JSON.stringify(value) : null);
        }
    },

    // Connection stats
    connectionCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: 'Number of times connected'
    },

    lastConnectedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },

    lastDisconnectedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },

    // QR Code info
    qrCode: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Latest QR code generated'
    },

    qrGeneratedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },

    // Error tracking
    lastError: {
        type: DataTypes.TEXT,
        allowNull: true
    },

    errorCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },

    // Webhook stats
    webhookUrl: {
        type: DataTypes.STRING(500),
        allowNull: true
    },

    webhookStats: {
        type: DataTypes.TEXT,
        allowNull: true,
        get() {
            const value = this.getDataValue('webhookStats');
            return value ? JSON.parse(value) : { total: 0, success: 0, error: 0 };
        },
        set(value) {
            this.setDataValue('webhookStats', JSON.stringify(value));
        }
    },

    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },

    notes: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Admin notes about this session'
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
    tableName: 'sessions',
    indexes: [
        {
            fields: ['status']
        },
        {
            fields: ['phone']
        },
        {
            fields: ['jid']
        },
        {
            fields: ['isActive']
        },
        {
            fields: ['lastConnectedAt']
        }
    ]
});

// Instance methods
Session.prototype.updateStatus = async function (status, additionalData = {}) {
    this.status = status;

    if (status === 'CONNECTED') {
        this.lastConnectedAt = new Date();
        this.connectionCount += 1;

        if (additionalData.userInfo) {
            this.userInfo = additionalData.userInfo;
            this.phone = additionalData.userInfo.id?.split('@')[0];
            this.jid = additionalData.userInfo.id;
        }
    } else if (status === 'DISCONNECTED' || status === 'BANNED') {
        this.lastDisconnectedAt = new Date();

        if (additionalData.error) {
            this.lastError = additionalData.error;
            this.errorCount += 1;
        }
    } else if (status === 'QR_GENERATED' && additionalData.qrCode) {
        this.qrCode = additionalData.qrCode;
        this.qrGeneratedAt = new Date();
    }

    return this.save();
};

Session.prototype.updateConfig = async function (newConfig) {
    const currentConfig = this.config || {};
    this.config = { ...currentConfig, ...newConfig };
    return this.save();
};

Session.prototype.updateWebhookStats = async function (type) {
    const stats = this.webhookStats || { total: 0, success: 0, error: 0 };
    stats.total += 1;
    stats[type] += 1;
    this.webhookStats = stats;
    return this.save();
};

Session.prototype.isConnected = function () {
    return this.status === 'CONNECTED';
};

Session.prototype.canConnect = function () {
    return ['DISCONNECTED', 'QR_GENERATED', 'PAIRING'].includes(this.status);
};

Session.prototype.getDisplayInfo = function () {
    return {
        id: this.id,
        name: this.name,
        phone: this.phone,
        status: this.status,
        isConnected: this.isConnected(),
        lastConnected: this.lastConnectedAt,
        connectionCount: this.connectionCount,
        hasWebhook: !!this.webhookUrl,
        isActive: this.isActive
    };
};

// Static methods
Session.getConnectedSessions = function () {
    return this.findAll({
        where: {
            status: 'CONNECTED',
            isActive: true
        }
    });
};

Session.getSessionByPhone = function (phone) {
    return this.findOne({
        where: {
            phone: phone,
            isActive: true
        }
    });
};

Session.getSessionStats = async function () {
    const total = await this.count({ where: { isActive: true } });
    const connected = await this.count({
        where: {
            status: 'CONNECTED',
            isActive: true
        }
    });
    const disconnected = await this.count({
        where: {
            status: 'DISCONNECTED',
            isActive: true
        }
    });
    const banned = await this.count({
        where: {
            status: 'BANNED',
            isActive: true
        }
    });

    return {
        total,
        connected,
        disconnected,
        banned,
        connecting: total - connected - disconnected - banned
    };
};

Session.cleanupInactiveSessions = async function (olderThanDays = 7) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.update(
        { isActive: false },
        {
            where: {
                status: ['DISCONNECTED', 'BANNED'],
                updatedAt: {
                    [sequelize.Op.lt]: cutoffDate
                },
                isActive: true
            }
        }
    );

    return result[0]; // Number of affected rows
};

module.exports = Session;