const crypto = require('crypto');
const moment = require('moment');

/**
 * Generate unique session ID
 */
const generateSessionId = (prefix = 'session') => {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(8).toString('hex');
    return `${prefix}_${timestamp}_${random}`;
};

/**
 * Delay/sleep function
 */
const delay = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Retry function with exponential backoff
 */
const retry = async (fn, options = {}) => {
    const {
        retries = 3,
        delay: baseDelay = 1000,
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
                break;
            }

            const currentDelay = exponentialBackoff ? baseDelay * Math.pow(2, i) : baseDelay;

            if (onRetry) {
                onRetry(error, i + 1, currentDelay);
            }

            await delay(currentDelay);
        }
    }

    throw lastError;
};

/**
 * Check if value is empty
 */
const isEmpty = (value) => {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
};

/**
 * Check if value is not empty
 */
const isNotEmpty = (value) => !isEmpty(value);

/**
 * Get nested object property safely
 */
const get = (obj, path, defaultValue = undefined) => {
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
};

/**
 * Set nested object property
 */
const set = (obj, path, value) => {
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
};

/**
 * Deep clone object
 */
const deepClone = (obj) => {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Array) return obj.map(item => deepClone(item));
    if (typeof obj === 'object') {
        const cloned = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                cloned[key] = deepClone(obj[key]);
            }
        }
        return cloned;
    }
};

/**
 * Merge objects deeply
 */
const deepMerge = (target, source) => {
    const result = deepClone(target);

    for (const key in source) {
        if (source.hasOwnProperty(key)) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = deepMerge(result[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
    }

    return result;
};

/**
 * Remove empty properties from object
 */
const removeEmpty = (obj) => {
    const cleaned = {};

    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const value = obj[key];

            if (value !== null && value !== undefined && value !== '') {
                if (typeof value === 'object' && !Array.isArray(value)) {
                    const cleanedNested = removeEmpty(value);
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
};

/**
 * Pick specific properties from object
 */
const pick = (obj, keys) => {
    const result = {};
    for (const key of keys) {
        if (key in obj) {
            result[key] = obj[key];
        }
    }
    return result;
};

/**
 * Omit specific properties from object
 */
const omit = (obj, keys) => {
    const result = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key) && !keys.includes(key)) {
            result[key] = obj[key];
        }
    }
    return result;
};

/**
 * Chunk array into smaller arrays
 */
const chunk = (array, size) => {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
};

/**
 * Remove duplicates from array
 */
const unique = (array) => {
    return [...new Set(array)];
};

/**
 * Flatten array
 */
const flatten = (array) => {
    return array.reduce((flat, item) => {
        return flat.concat(Array.isArray(item) ? flatten(item) : item);
    }, []);
};

/**
 * Group array by key
 */
const groupBy = (array, key) => {
    return array.reduce((groups, item) => {
        const groupKey = typeof key === 'function' ? key(item) : item[key];
        if (!groups[groupKey]) {
            groups[groupKey] = [];
        }
        groups[groupKey].push(item);
        return groups;
    }, {});
};

/**
 * Sort array by key
 */
const sortBy = (array, key, direction = 'asc') => {
    return array.sort((a, b) => {
        const aVal = typeof key === 'function' ? key(a) : a[key];
        const bVal = typeof key === 'function' ? key(b) : b[key];

        if (direction === 'desc') {
            return bVal > aVal ? 1 : -1;
        }
        return aVal > bVal ? 1 : -1;
    });
};

/**
 * Generate random string
 */
const randomString = (length = 10, charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') => {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return result;
};

/**
 * Generate random number between min and max
 */
const randomNumber = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

/**
 * Capitalize first letter
 */
const capitalize = (str) => {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

/**
 * Convert to title case
 */
const titleCase = (str) => {
    return str.replace(/\w\S*/g, txt =>
        txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
};

/**
 * Convert to camel case
 */
const camelCase = (str) => {
    return str
        .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
        .replace(/^[A-Z]/, c => c.toLowerCase());
};

/**
 * Convert to kebab case
 */
const kebabCase = (str) => {
    return str
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/[\s_]+/g, '-')
        .toLowerCase();
};

/**
 * Convert to snake case
 */
const snakeCase = (str) => {
    return str
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .replace(/[\s-]+/g, '_')
        .toLowerCase();
};

/**
 * Truncate string
 */
const truncate = (str, length, suffix = '...') => {
    if (str.length <= length) return str;
    return str.substring(0, length - suffix.length) + suffix;
};

/**
 * Escape HTML entities
 */
const escapeHtml = (str) => {
    const htmlEntities = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };
    return str.replace(/[&<>"']/g, match => htmlEntities[match]);
};

/**
 * Parse JSON safely
 */
const parseJSON = (str, defaultValue = null) => {
    try {
        return JSON.parse(str);
    } catch {
        return defaultValue;
    }
};

/**
 * Stringify JSON safely
 */
const stringifyJSON = (obj, space = null) => {
    try {
        return JSON.stringify(obj, null, space);
    } catch {
        return '{}';
    }
};

/**
 * Format bytes to human readable
 */
const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

/**
 * Format duration to human readable
 */
const formatDuration = (ms) => {
    const duration = moment.duration(ms);

    if (duration.asDays() >= 1) {
        return `${Math.floor(duration.asDays())}d ${duration.hours()}h ${duration.minutes()}m`;
    } else if (duration.asHours() >= 1) {
        return `${duration.hours()}h ${duration.minutes()}m ${duration.seconds()}s`;
    } else if (duration.asMinutes() >= 1) {
        return `${duration.minutes()}m ${duration.seconds()}s`;
    } else {
        return `${duration.seconds()}s`;
    }
};

/**
 * Format date to relative time
 */
const formatRelativeTime = (date) => {
    return moment(date).fromNow();
};

/**
 * Format date
 */
const formatDate = (date, format = 'YYYY-MM-DD HH:mm:ss') => {
    return moment(date).format(format);
};

/**
 * Check if date is valid
 */
const isValidDate = (date) => {
    return moment(date).isValid();
};

/**
 * Add time to date
 */
const addTime = (date, amount, unit) => {
    return moment(date).add(amount, unit).toDate();
};

/**
 * Subtract time from date
 */
const subtractTime = (date, amount, unit) => {
    return moment(date).subtract(amount, unit).toDate();
};

/**
 * Get difference between dates
 */
const dateDiff = (date1, date2, unit = 'milliseconds') => {
    return moment(date1).diff(moment(date2), unit);
};

/**
 * Validate email
 */
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

/**
 * Validate URL
 */
const isValidUrl = (url) => {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
};

/**
 * Validate UUID
 */
const isValidUUID = (uuid) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
};

/**
 * Generate hash
 */
const hash = (str, algorithm = 'sha256') => {
    return crypto.createHash(algorithm).update(str).digest('hex');
};

/**
 * Generate HMAC
 */
const hmac = (data, secret, algorithm = 'sha256') => {
    return crypto.createHmac(algorithm, secret).update(data).digest('hex');
};

/**
 * Encode base64
 */
const base64Encode = (str) => {
    return Buffer.from(str).toString('base64');
};

/**
 * Decode base64
 */
const base64Decode = (str) => {
    return Buffer.from(str, 'base64').toString('utf8');
};

/**
 * Generate UUID v4
 */
const uuid = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

/**
 * Debounce function
 */
const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

/**
 * Throttle function
 */
const throttle = (func, limit) => {
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
};

/**
 * Memoize function
 */
const memoize = (func) => {
    const cache = new Map();
    return function (...args) {
        const key = JSON.stringify(args);
        if (cache.has(key)) {
            return cache.get(key);
        }
        const result = func.apply(this, args);
        cache.set(key, result);
        return result;
    };
};

/**
 * Create safe async function
 */
const safeAsync = (asyncFn) => {
    return async (...args) => {
        try {
            const result = await asyncFn(...args);
            return [null, result];
        } catch (error) {
            return [error, null];
        }
    };
};

/**
 * Format error for API response
 */
const formatError = (error) => {
    return {
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        code: error.code || 'UNKNOWN_ERROR',
        timestamp: new Date().toISOString()
    };
};

/**
 * Create API response
 */
const createResponse = (success, message, data = null, meta = {}) => {
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
};

/**
 * Validate required fields
 */
const validateRequired = (obj, requiredFields) => {
    const missing = [];

    for (const field of requiredFields) {
        if (isEmpty(get(obj, field))) {
            missing.push(field);
        }
    }

    return {
        isValid: missing.length === 0,
        missing
    };
};

/**
 * Sanitize object for logging
 */
const sanitizeForLogging = (obj, sensitiveFields = ['password', 'token', 'apiKey', 'secret']) => {
    const sanitized = deepClone(obj);

    const sanitizeRecursive = (current, path = '') => {
        for (const key in current) {
            if (current.hasOwnProperty(key)) {
                const fullPath = path ? `${path}.${key}` : key;

                if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
                    current[key] = '***';
                } else if (typeof current[key] === 'object' && current[key] !== null) {
                    sanitizeRecursive(current[key], fullPath);
                }
            }
        }
    };

    sanitizeRecursive(sanitized);
    return sanitized;
};

module.exports = {
    // Core utilities
    generateSessionId,
    delay,
    retry,

    // Object utilities
    isEmpty,
    isNotEmpty,
    get,
    set,
    deepClone,
    deepMerge,
    removeEmpty,
    pick,
    omit,

    // Array utilities
    chunk,
    unique,
    flatten,
    groupBy,
    sortBy,

    // String utilities
    randomString,
    randomNumber,
    capitalize,
    titleCase,
    camelCase,
    kebabCase,
    snakeCase,
    truncate,
    escapeHtml,

    // JSON utilities
    parseJSON,
    stringifyJSON,

    // Format utilities
    formatBytes,
    formatDuration,
    formatRelativeTime,
    formatDate,

    // Date utilities
    isValidDate,
    addTime,
    subtractTime,
    dateDiff,

    // Validation utilities
    isValidEmail,
    isValidUrl,
    isValidUUID,

    // Crypto utilities
    hash,
    hmac,
    base64Encode,
    base64Decode,
    uuid,

    // Function utilities
    debounce,
    throttle,
    memoize,
    safeAsync,

    // API utilities
    formatError,
    createResponse,
    validateRequired,
    sanitizeForLogging
};