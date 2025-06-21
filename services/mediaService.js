const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mime = require('mime-types');
const sharp = require('sharp');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const { logger } = require('../utils/logger');
const { defaultConfig } = require('../config/default');

class MediaService {
    constructor() {
        this.uploadPath = defaultConfig.media.uploadPath;
        this.maxFileSize = this.parseSize(defaultConfig.media.maxFileSize);
        this.allowedTypes = {
            image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'],
            video: ['video/mp4', 'video/avi', 'video/mkv', 'video/mov', 'video/webm', 'video/3gp'],
            audio: ['audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/aac', 'audio/flac'],
            document: [
                'application/pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/vnd.ms-powerpoint',
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                'text/plain',
                'text/csv',
                'application/zip',
                'application/x-rar-compressed',
                'application/x-7z-compressed'
            ]
        };

        this.ensureUploadDirectory();
    }

    /**
     * Pastikan direktori upload ada
     */
    ensureUploadDirectory() {
        if (!fs.existsSync(this.uploadPath)) {
            fs.mkdirSync(this.uploadPath, { recursive: true });
            logger.info(`Media upload directory created: ${this.uploadPath}`);
        }
    }

    /**
     * Parse ukuran file dari string ke bytes
     */
    parseSize(sizeStr) {
        const units = {
            'B': 1,
            'KB': 1024,
            'MB': 1024 * 1024,
            'GB': 1024 * 1024 * 1024
        };

        const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
        if (!match) {
            return 50 * 1024 * 1024; // Default 50MB
        }

        const [, size, unit] = match;
        return parseFloat(size) * units[unit.toUpperCase()];
    }

    /**
     * Generate unique filename
     */
    generateFileName(originalName, extension = null) {
        const timestamp = Date.now();
        const random = crypto.randomBytes(8).toString('hex');
        const ext = extension || path.extname(originalName) || '';
        const baseName = path.basename(originalName, path.extname(originalName))
            .replace(/[^a-zA-Z0-9]/g, '_')
            .substring(0, 20);

        return `${timestamp}_${random}_${baseName}${ext}`;
    }

    /**
     * Validate media file
     */
    validateMediaFile(file, mediaType = null) {
        const errors = [];

        // Check file size
        if (file.size > this.maxFileSize) {
            errors.push(`File size exceeds maximum limit (${this.formatSize(this.maxFileSize)})`);
        }

        // Detect media type from mime type if not provided
        if (!mediaType) {
            mediaType = this.detectMediaType(file.mimetype);
        }

        // Check mime type
        if (mediaType && this.allowedTypes[mediaType]) {
            if (!this.allowedTypes[mediaType].includes(file.mimetype)) {
                errors.push(`Invalid file type for ${mediaType}. Allowed types: ${this.allowedTypes[mediaType].join(', ')}`);
            }
        } else {
            // Check if it's any allowed type
            const allAllowedTypes = Object.values(this.allowedTypes).flat();
            if (!allAllowedTypes.includes(file.mimetype)) {
                errors.push(`Unsupported file type: ${file.mimetype}`);
            }
        }

        // Additional validations based on media type
        if (mediaType === 'image') {
            if (file.size > 10 * 1024 * 1024) { // 10MB for images
                errors.push('Image file too large. Maximum 10MB allowed');
            }
        } else if (mediaType === 'video') {
            if (file.size > 100 * 1024 * 1024) { // 100MB for videos
                errors.push('Video file too large. Maximum 100MB allowed');
            }
        } else if (mediaType === 'audio') {
            if (file.size > 20 * 1024 * 1024) { // 20MB for audio
                errors.push('Audio file too large. Maximum 20MB allowed');
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            mediaType,
            detectedType: this.detectMediaType(file.mimetype)
        };
    }

    /**
     * Detect media type from mime type
     */
    detectMediaType(mimeType) {
        for (const [type, mimes] of Object.entries(this.allowedTypes)) {
            if (mimes.includes(mimeType)) {
                return type;
            }
        }
        return 'document'; // Default to document
    }

    /**
     * Save media file to disk
     */
    async saveMediaFile(file, options = {}) {
        try {
            const {
                customName = null,
                subDirectory = '',
                compress = false,
                quality = 80
            } = options;

            // Validate file
            const validation = this.validateMediaFile(file);
            if (!validation.isValid) {
                throw new Error(`File validation failed: ${validation.errors.join(', ')}`);
            }

            // Prepare directory
            const targetDir = path.join(this.uploadPath, subDirectory);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            // Generate filename
            const fileName = customName || this.generateFileName(file.originalname);
            const filePath = path.join(targetDir, fileName);

            let buffer = file.buffer;

            // Compress image if requested
            if (compress && validation.mediaType === 'image') {
                buffer = await this.compressImage(buffer, quality);
            }

            // Save file
            fs.writeFileSync(filePath, buffer);

            const fileInfo = {
                fileName,
                filePath,
                originalName: file.originalname,
                mimeType: file.mimetype,
                size: buffer.length,
                mediaType: validation.mediaType,
                url: `/media/${subDirectory ? subDirectory + '/' : ''}${fileName}`,
                savedAt: new Date().toISOString()
            };

            logger.info('Media file saved', {
                fileName,
                size: buffer.length,
                mediaType: validation.mediaType
            });

            return fileInfo;

        } catch (error) {
            logger.error('Error saving media file:', error);
            throw error;
        }
    }

    /**
     * Compress image using Sharp
     */
    async compressImage(buffer, quality = 80) {
        try {
            const compressed = await sharp(buffer)
                .jpeg({ quality, progressive: true })
                .toBuffer();

            logger.info('Image compressed', {
                originalSize: buffer.length,
                compressedSize: compressed.length,
                compressionRatio: ((1 - compressed.length / buffer.length) * 100).toFixed(2) + '%'
            });

            return compressed;
        } catch (error) {
            logger.warn('Image compression failed, using original:', error.message);
            return buffer;
        }
    }

    /**
     * Generate thumbnail for image
     */
    async generateThumbnail(buffer, options = {}) {
        try {
            const {
                width = 150,
                height = 150,
                quality = 70
            } = options;

            const thumbnail = await sharp(buffer)
                .resize(width, height, {
                    fit: 'cover',
                    position: 'center'
                })
                .jpeg({ quality })
                .toBuffer();

            return thumbnail;
        } catch (error) {
            logger.error('Error generating thumbnail:', error);
            throw error;
        }
    }

    /**
     * Download media from WhatsApp message
     */
    async downloadWhatsAppMedia(message, sessionId, saveToFile = false) {
        try {
            // Download media buffer
            const buffer = await downloadMediaMessage(message, 'buffer', {});

            if (!buffer) {
                throw new Error('Failed to download media from WhatsApp');
            }

            // Get message type and media info
            const messageType = Object.keys(message.message)[0];
            const mediaInfo = message.message[messageType];

            const mediaData = {
                buffer,
                size: buffer.length,
                mimeType: mediaInfo.mimetype,
                fileName: mediaInfo.fileName || `media_${Date.now()}`,
                caption: mediaInfo.caption || null,
                messageType
            };

            // Save to file if requested
            if (saveToFile) {
                const subDir = `downloads/${sessionId}`;
                const fileInfo = await this.saveMediaFile({
                    buffer,
                    originalname: mediaData.fileName,
                    mimetype: mediaData.mimeType,
                    size: buffer.length
                }, { subDirectory: subDir });

                mediaData.savedFile = fileInfo;
            }

            logger.info('WhatsApp media downloaded', {
                sessionId,
                messageType,
                size: buffer.length,
                savedToFile
            });

            return mediaData;

        } catch (error) {
            logger.error('Error downloading WhatsApp media:', error);
            throw error;
        }
    }

    /**
     * Process uploaded file for WhatsApp
     */
    async processForWhatsApp(file, mediaType, options = {}) {
        try {
            const {
                compress = true,
                generateThumbnail = true,
                maxDimension = 1920
            } = options;

            let processedBuffer = file.buffer;
            let thumbnail = null;

            // Process image
            if (mediaType === 'image' && compress) {
                // Resize if too large
                const metadata = await sharp(file.buffer).metadata();
                if (metadata.width > maxDimension || metadata.height > maxDimension) {
                    processedBuffer = await sharp(file.buffer)
                        .resize(maxDimension, maxDimension, {
                            fit: 'inside',
                            withoutEnlargement: true
                        })
                        .jpeg({ quality: 85, progressive: true })
                        .toBuffer();
                }

                // Generate thumbnail
                if (generateThumbnail) {
                    thumbnail = await this.generateThumbnail(processedBuffer);
                }
            }

            // Process video (basic validation only)
            if (mediaType === 'video') {
                // Could add video compression here using ffmpeg
                // For now, just validate size
                if (file.size > 64 * 1024 * 1024) { // 64MB limit for WhatsApp
                    throw new Error('Video file too large for WhatsApp. Maximum 64MB allowed');
                }
            }

            // Process audio
            if (mediaType === 'audio') {
                // Could add audio compression/conversion here
                if (file.size > 16 * 1024 * 1024) { // 16MB limit for WhatsApp
                    throw new Error('Audio file too large for WhatsApp. Maximum 16MB allowed');
                }
            }

            return {
                buffer: processedBuffer,
                thumbnail,
                originalSize: file.buffer.length,
                processedSize: processedBuffer.length,
                mimeType: file.mimetype,
                fileName: file.originalname
            };

        } catch (error) {
            logger.error('Error processing file for WhatsApp:', error);
            throw error;
        }
    }

    /**
     * Get media info from file
     */
    async getMediaInfo(filePath) {
        try {
            if (!fs.existsSync(filePath)) {
                throw new Error('File not found');
            }

            const stats = fs.statSync(filePath);
            const mimeType = mime.lookup(filePath) || 'application/octet-stream';
            const mediaType = this.detectMediaType(mimeType);

            const info = {
                fileName: path.basename(filePath),
                filePath,
                size: stats.size,
                mimeType,
                mediaType,
                createdAt: stats.birthtime,
                modifiedAt: stats.mtime
            };

            // Get additional info for images
            if (mediaType === 'image') {
                try {
                    const metadata = await sharp(filePath).metadata();
                    info.dimensions = {
                        width: metadata.width,
                        height: metadata.height
                    };
                    info.format = metadata.format;
                    info.hasAlpha = metadata.hasAlpha;
                } catch (error) {
                    // Continue without image metadata
                }
            }

            return info;

        } catch (error) {
            logger.error('Error getting media info:', error);
            throw error;
        }
    }

    /**
     * Delete media file
     */
    async deleteMediaFile(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                logger.info('Media file deleted', { filePath });
                return true;
            }
            return false;
        } catch (error) {
            logger.error('Error deleting media file:', error);
            throw error;
        }
    }

    /**
     * Cleanup old media files
     */
    async cleanupOldFiles(olderThanDays = 30) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

            let deletedCount = 0;

            const cleanupDirectory = (dir) => {
                if (!fs.existsSync(dir)) return;

                const items = fs.readdirSync(dir);

                for (const item of items) {
                    const itemPath = path.join(dir, item);
                    const stats = fs.statSync(itemPath);

                    if (stats.isDirectory()) {
                        cleanupDirectory(itemPath);

                        // Remove empty directories
                        try {
                            const remaining = fs.readdirSync(itemPath);
                            if (remaining.length === 0) {
                                fs.rmdirSync(itemPath);
                            }
                        } catch (error) {
                            // Directory not empty or other error
                        }
                    } else if (stats.mtime < cutoffDate) {
                        try {
                            fs.unlinkSync(itemPath);
                            deletedCount++;
                        } catch (error) {
                            logger.warn('Failed to delete old file:', { file: itemPath, error: error.message });
                        }
                    }
                }
            };

            cleanupDirectory(this.uploadPath);

            logger.info(`Cleaned up ${deletedCount} old media files`);
            return deletedCount;

        } catch (error) {
            logger.error('Error cleaning up old files:', error);
            throw error;
        }
    }

    /**
     * Get storage statistics
     */
    async getStorageStats() {
        try {
            let totalSize = 0;
            let fileCount = 0;
            const typeStats = {};

            const scanDirectory = (dir) => {
                if (!fs.existsSync(dir)) return;

                const items = fs.readdirSync(dir);

                for (const item of items) {
                    const itemPath = path.join(dir, item);
                    const stats = fs.statSync(itemPath);

                    if (stats.isDirectory()) {
                        scanDirectory(itemPath);
                    } else {
                        totalSize += stats.size;
                        fileCount++;

                        const mimeType = mime.lookup(itemPath) || 'application/octet-stream';
                        const mediaType = this.detectMediaType(mimeType);

                        if (!typeStats[mediaType]) {
                            typeStats[mediaType] = { count: 0, size: 0 };
                        }
                        typeStats[mediaType].count++;
                        typeStats[mediaType].size += stats.size;
                    }
                }
            };

            scanDirectory(this.uploadPath);

            return {
                totalSize,
                totalSizeFormatted: this.formatSize(totalSize),
                fileCount,
                typeStats: Object.entries(typeStats).map(([type, stats]) => ({
                    type,
                    count: stats.count,
                    size: stats.size,
                    sizeFormatted: this.formatSize(stats.size),
                    percentage: ((stats.size / totalSize) * 100).toFixed(2) + '%'
                })),
                uploadPath: this.uploadPath,
                maxFileSize: this.maxFileSize,
                maxFileSizeFormatted: this.formatSize(this.maxFileSize)
            };

        } catch (error) {
            logger.error('Error getting storage stats:', error);
            throw error;
        }
    }

    /**
     * Format file size
     */
    formatSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }

    /**
     * Convert file to different format (using Sharp for images)
     */
    async convertImage(buffer, outputFormat, options = {}) {
        try {
            const {
                quality = 85,
                width,
                height,
                fit = 'cover'
            } = options;

            let sharpInstance = sharp(buffer);

            // Resize if dimensions provided
            if (width || height) {
                sharpInstance = sharpInstance.resize(width, height, { fit });
            }

            // Convert format
            switch (outputFormat.toLowerCase()) {
                case 'jpeg':
                case 'jpg':
                    sharpInstance = sharpInstance.jpeg({ quality });
                    break;
                case 'png':
                    sharpInstance = sharpInstance.png({ quality });
                    break;
                case 'webp':
                    sharpInstance = sharpInstance.webp({ quality });
                    break;
                default:
                    throw new Error(`Unsupported output format: ${outputFormat}`);
            }

            const convertedBuffer = await sharpInstance.toBuffer();

            logger.info('Image converted', {
                outputFormat,
                originalSize: buffer.length,
                convertedSize: convertedBuffer.length
            });

            return convertedBuffer;

        } catch (error) {
            logger.error('Error converting image:', error);
            throw error;
        }
    }

    /**
     * Create media URL
     */
    createMediaUrl(fileName, subDirectory = '') {
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        return `${baseUrl}/media/${subDirectory ? subDirectory + '/' : ''}${fileName}`;
    }

    /**
     * Validate and prepare media for specific platforms
     */
    async prepareForPlatform(file, platform = 'whatsapp') {
        const platforms = {
            whatsapp: {
                image: { maxSize: 10 * 1024 * 1024, maxDimension: 1920 },
                video: { maxSize: 64 * 1024 * 1024, maxDuration: 300 },
                audio: { maxSize: 16 * 1024 * 1024, maxDuration: 300 },
                document: { maxSize: 100 * 1024 * 1024 }
            }
        };

        const platformLimits = platforms[platform];
        if (!platformLimits) {
            throw new Error(`Unsupported platform: ${platform}`);
        }

        const mediaType = this.detectMediaType(file.mimetype);
        const limits = platformLimits[mediaType];

        if (!limits) {
            throw new Error(`Unsupported media type for ${platform}: ${mediaType}`);
        }

        // Check size limit
        if (file.size > limits.maxSize) {
            throw new Error(`File too large for ${platform}. Maximum ${this.formatSize(limits.maxSize)} allowed for ${mediaType}`);
        }

        // Process based on type and platform requirements
        return await this.processForWhatsApp(file, mediaType);
    }
}

// Singleton instance
const mediaService = new MediaService();

module.exports = mediaService;