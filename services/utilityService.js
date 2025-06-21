const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const sessionManager = require('./sessionManager');
const { logger } = require('../utils/logger');
const { formatPhoneNumber, isValidPhoneNumber } = require('../utils/phoneFormatter');

class UtilityService {
    constructor() {
        this.systemInfo = null;
        this.startTime = Date.now();
    }

    /**
     * Generate unique ID
     */
    generateId(prefix = '', length = 16) {
        const timestamp = Date.now().toString(36);
        const random = crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
        return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
    }

    /**
     * Generate secure token
     */
    generateSecureToken(length = 32) {
        return crypto.randomBytes(length).toString('hex');
    }

    /**
     * Hash string using SHA256
     */
    hashString(str, salt = '') {
        return crypto.createHash('sha256').update(str + salt).digest('hex');
    }

    /**
     * Generate HMAC signature
     */
    generateHMAC(data, secret, algorithm = 'sha256') {
        return crypto.createHmac(algorithm, secret).update(data).digest('hex');
    }

    /**
     * Verify HMAC signature
     */
    verifyHMAC(data, signature, secret, algorithm = 'sha256') {
        const expectedSignature = this.generateHMAC(data, secret, algorithm);
        return crypto.timingSafeEqual(
            Buffer.from(signature, 'hex'),
            Buffer.from(expectedSignature, 'hex')
        );
    }

    /**
     * Sleep/delay function
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Retry function with exponential backoff
     */
    async retry(fn, options = {}) {
        const {
            retries = 3,
            delay = 1000,
            exponentialBackoff = true,
            onRetry = null
        } = options;

        let lastError;

        for (let i = 0; i <= retries; i++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;

                if (i === retries) {
                    break; // No more retries left
                }

                const currentDelay = exponentialBackoff ? delay * Math.pow(2, i) : delay;

                if (onRetry) {
                    onRetry(error, i + 1, currentDelay);
                }

                logger.warn(`Retry attempt ${i + 1}/${retries} after ${currentDelay}ms`, {
                    error: error.message
                });

                await this.sleep(currentDelay);
            }
        }

        throw lastError;
    }

    /**
     * Debounce function
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Throttle function
     */
    throttle(func, limit) {
        let inThrottle;
        return function () {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    /**
     * Format bytes to human readable
     */
    formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    /**
     * Format duration to human readable
     */
    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days}d ${hours % 24}h ${minutes % 60}m`;
        } else if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    /**
     * Get system information
     */
    getSystemInfo() {
        if (!this.systemInfo) {
            this.systemInfo = {
                platform: os.platform(),
                arch: os.arch(),
                release: os.release(),
                hostname: os.hostname(),
                cpus: os.cpus().length,
                totalMemory: os.totalmem(),
                nodeVersion: process.version,
                pid: process.pid,
                uptime: process.uptime()
            };
        }

        return {
            ...this.systemInfo,
            currentMemory: process.memoryUsage(),
            currentUptime: process.uptime(),
            applicationUptime: Date.now() - this.startTime,
            loadAverage: os.loadavg(),
            freeMemory: os.freemem()
        };
    }

    /**
     * Get system health status
     */
    getSystemHealth() {
        const memoryUsage = process.memoryUsage();
        const totalMemory = os.totalmem();
        const freeMemory = os.freemem();
        const usedMemory = totalMemory - freeMemory;
        const memoryUsagePercent = (usedMemory / totalMemory) * 100;
        const heapUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;

        const health = {
            status: 'healthy',
            checks: {
                memory: {
                    status: memoryUsagePercent < 90 ? 'healthy' : 'warning',
                    usage: memoryUsagePercent.toFixed(2) + '%',
                    details: {
                        total: this.formatBytes(totalMemory),
                        used: this.formatBytes(usedMemory),
                        free: this.formatBytes(freeMemory)
                    }
                },
                heap: {
                    status: heapUsagePercent < 90 ? 'healthy' : 'warning',
                    usage: heapUsagePercent.toFixed(2) + '%',
                    details: {
                        used: this.formatBytes(memoryUsage.heapUsed),
                        total: this.formatBytes(memoryUsage.heapTotal)
                    }
                },
                uptime: {
                    status: 'healthy',
                    value: this.formatDuration(Date.now() - this.startTime)
                },
                sessions: this.getSessionsHealth()
            },
            timestamp: new Date().toISOString()
        };

        // Determine overall status
        const hasWarnings = Object.values(health.checks).some(check => check.status === 'warning');
        const hasErrors = Object.values(health.checks).some(check => check.status === 'error');

        if (hasErrors) {
            health.status = 'error';
        } else if (hasWarnings) {
            health.status = 'warning';
        }

        return health;
    }

    /**
     * Get sessions health status
     */
    getSessionsHealth() {
        const allSessions = sessionManager.getAllSessionsInfo();
        const connected = allSessions.filter(s => s.connected).length;
        const total = allSessions.length;

        let status = 'healthy';
        if (total === 0) {
            status = 'warning';
        } else if (connected / total < 0.5) {
            status = 'warning';
        } else if (connected === 0) {
            status = 'error';
        }

        return {
            status,
            connected,
            total,
            connectionRate: total > 0 ? ((connected / total) * 100).toFixed(2) + '%' : '0%'
        };
    }

    /**
     * Sanitize string untuk filename
     */
    sanitizeFilename(filename) {
        return filename
            .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid characters
            .replace(/\s+/g, '_') // Replace spaces with underscores
            .replace(/_+/g, '_') // Replace multiple underscores with single
            .replace(/^_|_$/g, '') // Remove leading/trailing underscores
            .substring(0, 255); // Limit length
    }

    /**
     * Validate email address
     */
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    /**
     * Validate URL
     */
    isValidUrl(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Parse user agent
     */
    parseUserAgent(userAgent) {
        const result = {
            browser: 'Unknown',
            os: 'Unknown',
            device: 'Unknown',
            version: 'Unknown'
        };

        if (!userAgent) return result;

        // Simple user agent parsing
        if (userAgent.includes('Chrome')) {
            result.browser = 'Chrome';
        } else if (userAgent.includes('Firefox')) {
            result.browser = 'Firefox';
        } else if (userAgent.includes('Safari')) {
            result.browser = 'Safari';
        } else if (userAgent.includes('Edge')) {
            result.browser = 'Edge';
        }

        if (userAgent.includes('Windows')) {
            result.os = 'Windows';
        } else if (userAgent.includes('Mac')) {
            result.os = 'macOS';
        } else if (userAgent.includes('Linux')) {
            result.os = 'Linux';
        } else if (userAgent.includes('Android')) {
            result.os = 'Android';
        } else if (userAgent.includes('iOS')) {
            result.os = 'iOS';
        }

        if (userAgent.includes('Mobile')) {
            result.device = 'Mobile';
        } else if (userAgent.includes('Tablet')) {
            result.device = 'Tablet';
        } else {
            result.device = 'Desktop';
        }

        return result;
    }

    /**
     * Generate random string
     */
    generateRandomString(length = 10, charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
        let result = '';
        const charactersLength = charset.length;
        for (let i = 0; i < length; i++) {
            result += charset.charAt(Math.floor(Math.random() * charactersLength));
        }
        return result;
    }

    /**
     * Deep clone object
     */
    deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj.getTime());
        if (obj instanceof Array) return obj.map(item => this.deepClone(item));
        if (typeof obj === 'object') {
            const cloned = {};
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    cloned[key] = this.deepClone(obj[key]);
                }
            }
            return cloned;
        }
    }

    /**
     * Merge objects deeply
     */
    deepMerge(target, source) {
        const result = this.deepClone(target);

        for (const key in source) {
            if (source.hasOwnProperty(key)) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    result[key] = this.deepMerge(result[key] || {}, source[key]);
                } else {
                    result[key] = source[key];
                }
            }
        }

        return result;
    }

    /**
     * Get object nested property safely
     */
    getNestedProperty(obj, path, defaultValue = undefined) {
        const keys = path.split('.');
        let current = obj;

        for (const key of keys) {
            if (current && typeof current === 'object' && key in current) {
                current = current[key];
            } else {
                return defaultValue;
            }
        }

        return current;
    }

    /**
     * Set object nested property
     */
    setNestedProperty(obj, path, value) {
        const keys = path.split('.');
        let current = obj;

        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!(key in current) || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }

        current[keys[keys.length - 1]] = value;
        return obj;
    }

    /**
     * Remove empty properties from object
     */
    removeEmptyProperties(obj) {
        const cleaned = {};

        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const value = obj[key];

                if (value !== null && value !== undefined && value !== '') {
                    if (typeof value === 'object' && !Array.isArray(value)) {
                        const cleanedNested = this.removeEmptyProperties(value);
                        if (Object.keys(cleanedNested).length > 0) {
                            cleaned[key] = cleanedNested;
                        }
                    } else if (Array.isArray(value) && value.length > 0) {
                        cleaned[key] = value;
                    } else if (typeof value !== 'object') {
                        cleaned[key] = value;
                    }
                }
            }
        }

        return cleaned;
    }

    /**
     * Flatten object
     */
    flattenObject(obj, prefix = '', separator = '.') {
        const flattened = {};

        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const newKey = prefix ? `${prefix}${separator}${key}` : key;

                if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
                    Object.assign(flattened, this.flattenObject(obj[key], newKey, separator));
                } else {
                    flattened[newKey] = obj[key];
                }
            }
        }

        return flattened;
    }

    /**
     * Convert to title case
     */
    toTitleCase(str) {
        return str.replace(/\w\S*/g, (txt) =>
            txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
        );
    }

    /**
     * Convert to kebab case
     */
    toKebabCase(str) {
        return str
            .replace(/([a-z])([A-Z])/g, '$1-$2')
            .replace(/[\s_]+/g, '-')
            .toLowerCase();
    }

    /**
     * Convert to camel case
     */
    toCamelCase(str) {
        return str
            .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
            .replace(/^[A-Z]/, c => c.toLowerCase());
    }

    /**
     * Truncate string
     */
    truncateString(str, length, suffix = '...') {
        if (str.length <= length) return str;
        return str.substring(0, length - suffix.length) + suffix;
    }

    /**
     * Parse JSON safely
     */
    parseJSON(str, defaultValue = null) {
        try {
            return JSON.parse(str);
        } catch {
            return defaultValue;
        }
    }

    /**
     * Stringify JSON safely
     */
    stringifyJSON(obj, space = null) {
        try {
            return JSON.stringify(obj, null, space);
        } catch {
            return '{}';
        }
    }

    /**
     * Get file extension
     */
    getFileExtension(filename) {
        return path.extname(filename).toLowerCase().substring(1);
    }

    /**
     * Check if file exists
     */
    async fileExists(filePath) {
        try {
            await promisify(fs.access)(filePath, fs.constants.F_OK);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Create directory if not exists
     */
    async ensureDirectory(dirPath) {
        try {
            await promisify(fs.mkdir)(dirPath, { recursive: true });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get file stats
     */
    async getFileStats(filePath) {
        try {
            return await promisify(fs.stat)(filePath);
        } catch {
            return null;
        }
    }

    /**
     * Generate checksum
     */
    async generateChecksum(filePath, algorithm = 'md5') {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash(algorithm);
            const stream = fs.createReadStream(filePath);

            stream.on('data', data => hash.update(data));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', reject);
        });
    }

    /**
     * Validate phone numbers in bulk
     */
    validatePhoneNumbers(phoneNumbers) {
        const results = [];

        for (const phone of phoneNumbers) {
            const formatted = formatPhoneNumber(phone);
            const isValid = isValidPhoneNumber(phone);

            results.push({
                original: phone,
                formatted: formatted,
                isValid: isValid,
                errors: isValid ? [] : ['Invalid phone number format']
            });
        }

        return results;
    }

    /**
     * Clean phone numbers list
     */
    cleanPhoneNumbers(phoneNumbers) {
        return phoneNumbers
            .map(phone => formatPhoneNumber(phone))
            .filter(phone => phone && isValidPhoneNumber(phone))
            .filter((phone, index, arr) => arr.indexOf(phone) === index); // Remove duplicates
    }

    /**
     * Rate limiter helper
     */
    createRateLimiter(windowMs, maxRequests) {
        const requests = new Map();

        return (key) => {
            const now = Date.now();
            const windowStart = now - windowMs;

            // Clean old requests
            for (const [reqKey, timestamps] of requests.entries()) {
                const filtered = timestamps.filter(time => time > windowStart);
                if (filtered.length === 0) {
                    requests.delete(reqKey);
                } else {
                    requests.set(reqKey, filtered);
                }
            }

            // Check current key
            const currentRequests = requests.get(key) || [];
            const recentRequests = currentRequests.filter(time => time > windowStart);

            if (recentRequests.length >= maxRequests) {
                return {
                    allowed: false,
                    resetTime: Math.min(...recentRequests) + windowMs,
                    remaining: 0
                };
            }

            // Add current request
            recentRequests.push(now);
            requests.set(key, recentRequests);

            return {
                allowed: true,
                resetTime: now + windowMs,
                remaining: maxRequests - recentRequests.length
            };
        };
    }

    /**
     * Format response helper
     */
    formatApiResponse(success, message, data = null, meta = {}) {
        const response = {
            success,
            message,
            timestamp: new Date().toISOString()
        };

        if (data !== null) {
            response.data = data;
        }

        if (Object.keys(meta).length > 0) {
            response.meta = meta;
        }

        return response;
    }

    /**
     * Generate API documentation
     */
    generateApiDocs() {
        return {
            title: 'WhatsApp API Documentation',
            version: '1.0.0',
            description: 'Complete WhatsApp API with multiple session support',
            baseUrl: process.env.BASE_URL || 'http://localhost:3000',
            authentication: {
                type: 'API Key',
                header: 'x-api-key'
            },
            endpoints: {
                health: 'GET /health',
                info: 'GET /api/info',
                auth: 'POST /api/auth/*',
                message: 'POST /api/message/*',
                group: 'POST /api/group/*',
                contact: 'GET /api/contact/*',
                status: 'POST /api/status/*',
                webhook: 'POST /api/webhook/*'
            },
            features: [
                'Multiple WhatsApp sessions',
                'Text and media messages',
                'Group management',
                'Contact management',
                'Webhook integration',
                'Real-time events',
                'Message history',
                'Auto-read messages',
                'Typing indicators',
                'File uploads',
                'QR code authentication',
                'Pairing code support',
                'Rate limiting',
                'Comprehensive logging'
            ]
        };
    }
}

// Singleton instance
const utilityService = new UtilityService();

module.exports = utilityService;