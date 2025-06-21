const qrcode = require('qrcode');
const QRCodeTerminal = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const { logger } = require('./logger');
const { defaultConfig } = require('../config/default');

class QRGenerator {
    constructor() {
        this.defaultOptions = {
            // QR Code generation options
            errorCorrectionLevel: 'M',
            type: 'image/png',
            quality: 0.92,
            margin: 1,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        };
    }

    /**
     * Generate QR code as data URL (base64)
     */
    async generateDataURL(text, options = {}) {
        try {
            const mergedOptions = { ...this.defaultOptions, ...options };
            const dataURL = await qrcode.toDataURL(text, mergedOptions);

            logger.info('QR code generated as data URL', {
                textLength: text.length,
                format: 'base64'
            });

            return dataURL;
        } catch (error) {
            logger.error('Error generating QR code data URL:', error);
            throw error;
        }
    }

    /**
     * Generate QR code as buffer
     */
    async generateBuffer(text, options = {}) {
        try {
            const mergedOptions = { ...this.defaultOptions, ...options };
            const buffer = await qrcode.toBuffer(text, mergedOptions);

            logger.info('QR code generated as buffer', {
                textLength: text.length,
                bufferSize: buffer.length
            });

            return buffer;
        } catch (error) {
            logger.error('Error generating QR code buffer:', error);
            throw error;
        }
    }

    /**
     * Generate QR code and save to file
     */
    async generateFile(text, filePath, options = {}) {
        try {
            const mergedOptions = { ...this.defaultOptions, ...options };

            // Ensure directory exists
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            await qrcode.toFile(filePath, text, mergedOptions);

            // Get file stats
            const stats = fs.statSync(filePath);

            logger.info('QR code saved to file', {
                filePath,
                textLength: text.length,
                fileSize: stats.size
            });

            return {
                filePath,
                size: stats.size,
                created: stats.birthtime
            };
        } catch (error) {
            logger.error('Error generating QR code file:', error);
            throw error;
        }
    }

    /**
     * Generate QR code and display in terminal
     */
    generateTerminal(text, options = {}) {
        try {
            const { small = true } = options;

            QRCodeTerminal.generate(text, { small }, (qr) => {
                logger.info('QR code displayed in terminal', {
                    textLength: text.length
                });
            });

            return true;
        } catch (error) {
            logger.error('Error generating terminal QR code:', error);
            throw error;
        }
    }

    /**
     * Generate QR code as SVG
     */
    async generateSVG(text, options = {}) {
        try {
            const mergedOptions = {
                ...this.defaultOptions,
                ...options,
                type: 'svg'
            };

            const svg = await qrcode.toString(text, mergedOptions);

            logger.info('QR code generated as SVG', {
                textLength: text.length,
                svgLength: svg.length
            });

            return svg;
        } catch (error) {
            logger.error('Error generating QR code SVG:', error);
            throw error;
        }
    }

    /**
     * Generate QR code with custom styling
     */
    async generateStyled(text, style = {}) {
        try {
            const {
                size = 200,
                border = 4,
                background = '#FFFFFF',
                foreground = '#000000',
                logo = null,
                logoSize = 0.2
            } = style;

            const options = {
                errorCorrectionLevel: 'H', // High for logo overlay
                width: size,
                margin: border,
                color: {
                    dark: foreground,
                    light: background
                }
            };

            let qrBuffer = await this.generateBuffer(text, options);

            // If logo is provided, overlay it (requires additional image processing)
            if (logo) {
                // This would require additional image processing libraries like Sharp
                logger.warn('Logo overlay not implemented yet');
            }

            logger.info('Styled QR code generated', {
                textLength: text.length,
                size,
                hasLogo: !!logo
            });

            return qrBuffer;
        } catch (error) {
            logger.error('Error generating styled QR code:', error);
            throw error;
        }
    }

    /**
     * Generate QR code for WhatsApp authentication
     */
    async generateWhatsAppQR(qrData, sessionId, options = {}) {
        try {
            const {
                saveToFile = true,
                showInTerminal = true,
                format = 'png'
            } = options;

            const results = {};

            // Generate base64 data URL
            results.dataURL = await this.generateDataURL(qrData, {
                errorCorrectionLevel: 'L', // WhatsApp QR codes use low error correction
                width: 256,
                margin: 2
            });

            // Show in terminal if requested
            if (showInTerminal) {
                this.generateTerminal(qrData, { small: true });
                results.terminal = true;
            }

            // Save to file if requested
            if (saveToFile) {
                const sessionPath = path.join(defaultConfig.session.path, sessionId);
                const qrPath = path.join(sessionPath, `qr.${format}`);

                results.file = await this.generateFile(qrData, qrPath, {
                    errorCorrectionLevel: 'L',
                    width: 256,
                    margin: 2
                });
            }

            // Extract base64 data
            results.base64 = results.dataURL.split(',')[1];

            logger.info('WhatsApp QR code generated', {
                sessionId,
                saveToFile,
                showInTerminal,
                dataLength: qrData.length
            });

            return results;
        } catch (error) {
            logger.error('Error generating WhatsApp QR code:', error);
            throw error;
        }
    }

    /**
     * Generate QR code for URL
     */
    async generateURLQR(url, options = {}) {
        try {
            // Validate URL
            try {
                new URL(url);
            } catch {
                throw new Error('Invalid URL provided');
            }

            const qrOptions = {
                errorCorrectionLevel: 'M',
                width: options.size || 200,
                margin: options.margin || 2,
                color: {
                    dark: options.foreground || '#000000',
                    light: options.background || '#FFFFFF'
                }
            };

            const result = await this.generateDataURL(url, qrOptions);

            logger.info('URL QR code generated', {
                url,
                size: options.size || 200
            });

            return result;
        } catch (error) {
            logger.error('Error generating URL QR code:', error);
            throw error;
        }
    }

    /**
     * Generate QR code for contact (vCard)
     */
    async generateContactQR(contact, options = {}) {
        try {
            const {
                name,
                phone,
                email,
                organization,
                url: website
            } = contact;

            if (!name || !phone) {
                throw new Error('Name and phone are required for contact QR');
            }

            // Create vCard format
            const vCard = [
                'BEGIN:VCARD',
                'VERSION:3.0',
                `FN:${name}`,
                `TEL:${phone}`,
                email ? `EMAIL:${email}` : '',
                organization ? `ORG:${organization}` : '',
                website ? `URL:${website}` : '',
                'END:VCARD'
            ].filter(line => line).join('\n');

            const qrOptions = {
                errorCorrectionLevel: 'M',
                width: options.size || 200,
                margin: options.margin || 2
            };

            const result = await this.generateDataURL(vCard, qrOptions);

            logger.info('Contact QR code generated', {
                name,
                phone,
                hasEmail: !!email,
                hasOrganization: !!organization
            });

            return result;
        } catch (error) {
            logger.error('Error generating contact QR code:', error);
            throw error;
        }
    }

    /**
     * Generate QR code for WiFi
     */
    async generateWiFiQR(wifiConfig, options = {}) {
        try {
            const {
                ssid,
                password,
                security = 'WPA',
                hidden = false
            } = wifiConfig;

            if (!ssid) {
                throw new Error('SSID is required for WiFi QR');
            }

            // Create WiFi QR format
            const wifiString = `WIFI:T:${security};S:${ssid};P:${password || ''};H:${hidden ? 'true' : 'false'};;`;

            const qrOptions = {
                errorCorrectionLevel: 'M',
                width: options.size || 200,
                margin: options.margin || 2
            };

            const result = await this.generateDataURL(wifiString, qrOptions);

            logger.info('WiFi QR code generated', {
                ssid,
                security,
                hasPassword: !!password,
                hidden
            });

            return result;
        } catch (error) {
            logger.error('Error generating WiFi QR code:', error);
            throw error;
        }
    }

    /**
     * Generate QR code for SMS
     */
    async generateSMSQR(phone, message = '', options = {}) {
        try {
            if (!phone) {
                throw new Error('Phone number is required for SMS QR');
            }

            const smsString = `SMS:${phone}:${message}`;

            const qrOptions = {
                errorCorrectionLevel: 'M',
                width: options.size || 200,
                margin: options.margin || 2
            };

            const result = await this.generateDataURL(smsString, qrOptions);

            logger.info('SMS QR code generated', {
                phone,
                hasMessage: !!message
            });

            return result;
        } catch (error) {
            logger.error('Error generating SMS QR code:', error);
            throw error;
        }
    }

    /**
     * Batch generate QR codes
     */
    async generateBatch(items, options = {}) {
        try {
            const {
                format = 'dataURL',
                saveToDirectory = null,
                filenamePrefix = 'qr'
            } = options;

            const results = [];

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const filename = `${filenamePrefix}_${i + 1}.png`;

                try {
                    let result;

                    switch (format) {
                        case 'dataURL':
                            result = await this.generateDataURL(item.text || item, item.options);
                            break;
                        case 'buffer':
                            result = await this.generateBuffer(item.text || item, item.options);
                            break;
                        case 'file':
                            if (!saveToDirectory) {
                                throw new Error('saveToDirectory is required for file format');
                            }
                            const filePath = path.join(saveToDirectory, filename);
                            result = await this.generateFile(item.text || item, filePath, item.options);
                            break;
                        default:
                            throw new Error(`Unsupported format: ${format}`);
                    }

                    results.push({
                        index: i,
                        item: item.text || item,
                        result,
                        success: true
                    });
                } catch (error) {
                    results.push({
                        index: i,
                        item: item.text || item,
                        error: error.message,
                        success: false
                    });
                }
            }

            const successful = results.filter(r => r.success).length;

            logger.info('Batch QR codes generated', {
                total: items.length,
                successful,
                failed: items.length - successful,
                format
            });

            return {
                results,
                summary: {
                    total: items.length,
                    successful,
                    failed: items.length - successful
                }
            };
        } catch (error) {
            logger.error('Error generating batch QR codes:', error);
            throw error;
        }
    }

    /**
     * Clean up old QR files
     */
    async cleanupOldQRFiles(directory, olderThanHours = 24) {
        try {
            if (!fs.existsSync(directory)) {
                return { cleaned: 0 };
            }

            const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
            const files = fs.readdirSync(directory);
            let cleaned = 0;

            for (const file of files) {
                if (file.startsWith('qr.') || file.includes('_qr_')) {
                    const filePath = path.join(directory, file);
                    const stats = fs.statSync(filePath);

                    if (stats.birthtime.getTime() < cutoffTime) {
                        try {
                            fs.unlinkSync(filePath);
                            cleaned++;
                        } catch (error) {
                            logger.warn('Failed to delete old QR file:', { file, error: error.message });
                        }
                    }
                }
            }

            logger.info('Old QR files cleaned up', {
                directory,
                cleaned,
                olderThanHours
            });

            return { cleaned };
        } catch (error) {
            logger.error('Error cleaning up QR files:', error);
            throw error;
        }
    }

    /**
     * Validate QR code content
     */
    validateContent(text) {
        const validations = {
            isValid: true,
            warnings: [],
            errors: []
        };

        // Check text length
        if (!text || text.length === 0) {
            validations.isValid = false;
            validations.errors.push('QR content cannot be empty');
        }

        // QR codes have practical limits
        if (text.length > 4296) {
            validations.isValid = false;
            validations.errors.push('QR content too long (max 4296 characters)');
        } else if (text.length > 2000) {
            validations.warnings.push('QR content is quite long, consider shorter text for better readability');
        }

        // Check for special characters that might cause issues
        const problematicChars = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
        if (problematicChars.test(text)) {
            validations.warnings.push('Content contains control characters that might not scan properly');
        }

        return validations;
    }

    /**
     * Get QR code info
     */
    getQRInfo(text) {
        const validation = this.validateContent(text);

        return {
            content: text,
            length: text.length,
            estimatedSize: {
                low: Math.ceil(text.length * 0.8),
                medium: Math.ceil(text.length * 1.0),
                quartile: Math.ceil(text.length * 1.2),
                high: Math.ceil(text.length * 1.5)
            },
            recommendedErrorCorrection: text.length < 1000 ? 'M' : 'L',
            validation
        };
    }
}

// Singleton instance
const qrGenerator = new QRGenerator();

module.exports = qrGenerator;