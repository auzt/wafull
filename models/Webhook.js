const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Webhook = sequelize.define('Webhook', {
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

    // Webhook details
    url: {
        type: DataTypes.STRING(500),
        allowNull: false,
        comment: 'Webhook URL'
    },

    event: {
        type: DataTypes.STRING(50),
        allowNull: false,
        comment: 'Event type (e.g., message_received, connection_status)'
    },

    method: {
        type: DataTypes.ENUM('GET', 'POST', 'PUT', 'PATCH'),
        defaultValue: 'POST'
    },

    // Request data
    headers: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Request headers (JSON)',
        get() {
            const value = this.getDataValue('headers');
            return value ? JSON.parse(value) : {};
        },
        set(value) {
            this.setDataValue('headers', JSON.stringify(value));
        }
    },

    payload: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Request payload (JSON)',
        get() {
            const value = this.getDataValue('payload');
            return value ? JSON.parse(value) : {};
        },
        set(value) {
            this.setDataValue('payload', JSON.stringify(value));
        }
    },

    // Response data
    statusCode: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'HTTP response status code'
    },

    responseBody: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Response body'
    },

    responseHeaders: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Response headers (JSON)',
        get() {
            const value = this.getDataValue('responseHeaders');
            return value ? JSON.parse(value) : {};
        },
        set(value) {
            this.setDataValue('responseHeaders', JSON.stringify(value));
        }
    },

    // Timing
    responseTime: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Response time in milliseconds'
    },

    // Status
    status: {
        type: DataTypes.ENUM('PENDING', 'SUCCESS', 'FAILED', 'RETRYING'),
        defaultValue: 'PENDING'
    },

    // Error handling
    errorMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Error message if failed'
    },

    retryCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: 'Number of retry attempts'
    },

    maxRetries: {
        type: DataTypes.INTEGER,
        defaultValue: 3,
        comment: 'Maximum retry attempts'
    },

    nextRetryAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Next retry timestamp'
    },

    // Timestamps
    sentAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'When webhook was sent'
    },

    completedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'When webhook completed (success or final failure)'
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
    tableName: 'webhooks',
    indexes: [
        {
            fields: ['sessionId']
        },
        {
            fields: ['event']
        },
        {
            fields: ['status']
        },
        {
            fields: ['url']
        },
        {
            fields: ['createdAt']
        },
        {
            fields: ['sentAt']
        },
        {
            fields: ['nextRetryAt']
        },
        {
            fields: ['retryCount']
        },
        {
            fields: ['statusCode']
        }
    ]
});

// Instance methods
Webhook.prototype.markAsSent = async function () {
    this.status = 'SUCCESS';
    this.sentAt = new Date();
    this.completedAt = new Date();
    return this.save();
};

Webhook.prototype.markAsFailed = async function (error, statusCode = null) {
    this.status = 'FAILED';
    this.errorMessage = error;
    this.statusCode = statusCode;

    // Check if can retry
    if (this.retryCount < this.maxRetries) {
        this.status = 'RETRYING';
        this.retryCount += 1;

        // Calculate next retry time with exponential backoff
        const baseDelay = 2000; // 2 seconds
        const delay = baseDelay * Math.pow(2, this.retryCount - 1);
        this.nextRetryAt = new Date(Date.now() + delay);
    } else {
        this.completedAt = new Date();
    }

    return this.save();
};

Webhook.prototype.updateResponse = async function (statusCode, responseBody, responseHeaders, responseTime) {
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.responseHeaders = responseHeaders;
    this.responseTime = responseTime;
    this.sentAt = new Date();

    if (statusCode >= 200 && statusCode < 300) {
        this.status = 'SUCCESS';
        this.completedAt = new Date();
    } else {
        await this.markAsFailed(`HTTP ${statusCode}`, statusCode);
    }

    return this.save();
};

Webhook.prototype.canRetry = function () {
    return this.status === 'RETRYING' && this.retryCount < this.maxRetries;
};

Webhook.prototype.isCompleted = function () {
    return ['SUCCESS', 'FAILED'].includes(this.status) && this.completedAt;
};

Webhook.prototype.getDuration = function () {
    if (!this.sentAt) return null;
    const endTime = this.completedAt || new Date();
    return endTime.getTime() - this.sentAt.getTime();
};

Webhook.prototype.getSummary = function () {
    return {
        id: this.id,
        event: this.event,
        url: this.url,
        status: this.status,
        statusCode: this.statusCode,
        retryCount: this.retryCount,
        responseTime: this.responseTime,
        duration: this.getDuration(),
        createdAt: this.createdAt,
        sentAt: this.sentAt,
        completedAt: this.completedAt
    };
};

// Static methods
Webhook.getPendingWebhooks = function (sessionId = null) {
    const where = {
        status: ['PENDING', 'RETRYING'],
        [sequelize.Op.or]: [
            { nextRetryAt: null },
            { nextRetryAt: { [sequelize.Op.lte]: new Date() } }
        ]
    };

    if (sessionId) {
        where.sessionId = sessionId;
    }

    return this.findAll({
        where,
        order: [['createdAt', 'ASC']]
    });
};

Webhook.getSessionStats = async function (sessionId, timeRange = null) {
    const where = { sessionId };

    if (timeRange) {
        const timeRanges = {
            '1h': new Date(Date.now() - 60 * 60 * 1000),
            '24h': new Date(Date.now() - 24 * 60 * 60 * 1000),
            '7d': new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            '30d': new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        };

        if (timeRanges[timeRange]) {
            where.createdAt = {
                [sequelize.Op.gte]: timeRanges[timeRange]
            };
        }
    }

    const total = await this.count({ where });
    const success = await this.count({
        where: {
            ...where,
            status: 'SUCCESS'
        }
    });
    const failed = await this.count({
        where: {
            ...where,
            status: 'FAILED'
        }
    });
    const pending = await this.count({
        where: {
            ...where,
            status: ['PENDING', 'RETRYING']
        }
    });

    // Average response time
    const avgResponseTime = await this.findAll({
        where: {
            ...where,
            status: 'SUCCESS',
            responseTime: { [sequelize.Op.not]: null }
        },
        attributes: [
            [sequelize.fn('AVG', sequelize.col('responseTime')), 'avg']
        ],
        raw: true
    });

    return {
        total,
        success,
        failed,
        pending,
        successRate: total > 0 ? ((success / total) * 100).toFixed(2) : 0,
        averageResponseTime: avgResponseTime[0]?.avg ? Math.round(avgResponseTime[0].avg) : null
    };
};

Webhook.getEventStats = async function (sessionId) {
    const stats = await this.findAll({
        where: { sessionId },
        attributes: [
            'event',
            [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
            [sequelize.fn('SUM', sequelize.literal('CASE WHEN status = "SUCCESS" THEN 1 ELSE 0 END')), 'success'],
            [sequelize.fn('AVG', sequelize.col('responseTime')), 'avgResponseTime']
        ],
        group: ['event'],
        raw: true
    });

    return stats.map(stat => ({
        event: stat.event,
        total: parseInt(stat.count),
        success: parseInt(stat.success),
        failed: parseInt(stat.count) - parseInt(stat.success),
        successRate: ((parseInt(stat.success) / parseInt(stat.count)) * 100).toFixed(2),
        averageResponseTime: stat.avgResponseTime ? Math.round(stat.avgResponseTime) : null
    }));
};

Webhook.getFailedWebhooks = function (sessionId, limit = 50) {
    return this.findAll({
        where: {
            sessionId,
            status: 'FAILED'
        },
        order: [['updatedAt', 'DESC']],
        limit
    });
};

Webhook.getRecentWebhooks = function (sessionId, limit = 50) {
    return this.findAll({
        where: { sessionId },
        order: [['createdAt', 'DESC']],
        limit,
        attributes: { exclude: ['payload', 'responseBody'] }
    });
};

Webhook.retryFailedWebhooks = async function (sessionId) {
    const failedWebhooks = await this.findAll({
        where: {
            sessionId,
            status: 'FAILED',
            retryCount: { [sequelize.Op.lt]: sequelize.col('maxRetries') }
        }
    });

    for (const webhook of failedWebhooks) {
        webhook.status = 'RETRYING';
        webhook.retryCount += 1;
        webhook.nextRetryAt = new Date(Date.now() + 5000); // Retry in 5 seconds
        await webhook.save();
    }

    return failedWebhooks.length;
};

Webhook.cleanupOldWebhooks = async function (olderThanDays = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.destroy({
        where: {
            status: ['SUCCESS', 'FAILED'],
            completedAt: {
                [sequelize.Op.lt]: cutoffDate
            }
        }
    });

    return result;
};

Webhook.getGlobalStats = async function () {
    const total = await this.count();
    const success = await this.count({ where: { status: 'SUCCESS' } });
    const failed = await this.count({ where: { status: 'FAILED' } });
    const pending = await this.count({ where: { status: ['PENDING', 'RETRYING'] } });

    const sessionCount = await this.count({
        distinct: true,
        col: 'sessionId'
    });

    return {
        total,
        success,
        failed,
        pending,
        successRate: total > 0 ? ((success / total) * 100).toFixed(2) : 0,
        activeSessions: sessionCount
    };
};

// Association with Session
Webhook.belongsTo(require('./Session'), {
    foreignKey: 'sessionId',
    as: 'session'
});

module.exports = Webhook;