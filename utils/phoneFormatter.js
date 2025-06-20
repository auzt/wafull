const { defaultConfig } = require('../config/default');

/**
 * Format nomor telepon menjadi format WhatsApp
 * @param {string} phone - Nomor telepon
 * @param {string} countryCode - Kode negara (default dari config)
 * @returns {string} - Nomor telepon terformat
 */
const formatPhoneNumber = (phone, countryCode = null) => {
    if (!phone) return null;

    // Gunakan country code dari parameter atau default
    const defaultCountryCode = countryCode || defaultConfig.whatsapp.countryCode;

    // Hapus semua karakter non-digit
    let cleanPhone = phone.replace(/\D/g, '');

    // Jika nomor dimulai dengan 0, hapus 0 dan tambah country code
    if (cleanPhone.startsWith('0')) {
        cleanPhone = defaultCountryCode + cleanPhone.substring(1);
    }
    // Jika nomor tidak dimulai dengan country code, tambahkan
    else if (!cleanPhone.startsWith(defaultCountryCode)) {
        cleanPhone = defaultCountryCode + cleanPhone;
    }

    return cleanPhone;
};

/**
 * Format nomor untuk WhatsApp ID
 * @param {string} phone - Nomor telepon
 * @param {string} countryCode - Kode negara
 * @returns {string} - WhatsApp ID format
 */
const formatToWhatsAppId = (phone, countryCode = null) => {
    const formattedPhone = formatPhoneNumber(phone, countryCode);
    return formattedPhone ? `${formattedPhone}@s.whatsapp.net` : null;
};

/**
 * Format multiple nomor telepon (dipisahkan koma)
 * @param {string} phones - String nomor telepon dipisahkan koma
 * @param {string} countryCode - Kode negara
 * @returns {Array} - Array nomor telepon terformat
 */
const formatMultiplePhones = (phones, countryCode = null) => {
    if (!phones) return [];

    return phones
        .split(',')
        .map(phone => phone.trim())
        .filter(phone => phone.length > 0)
        .map(phone => formatPhoneNumber(phone, countryCode))
        .filter(phone => phone !== null);
};

/**
 * Format multiple nomor untuk WhatsApp ID
 * @param {string} phones - String nomor telepon dipisahkan koma
 * @param {string} countryCode - Kode negara
 * @returns {Array} - Array WhatsApp ID terformat
 */
const formatMultipleToWhatsAppId = (phones, countryCode = null) => {
    if (!phones) return [];

    return phones
        .split(',')
        .map(phone => phone.trim())
        .filter(phone => phone.length > 0)
        .map(phone => formatToWhatsAppId(phone, countryCode))
        .filter(phone => phone !== null);
};

/**
 * Validasi nomor telepon
 * @param {string} phone - Nomor telepon
 * @returns {boolean} - Valid atau tidak
 */
const isValidPhoneNumber = (phone) => {
    if (!phone) return false;

    const cleanPhone = phone.replace(/\D/g, '');

    // Minimal 10 digit, maksimal 15 digit (standar internasional)
    return cleanPhone.length >= 10 && cleanPhone.length <= 15;
};

/**
 * Extract nomor dari WhatsApp ID
 * @param {string} jid - WhatsApp JID
 * @returns {string} - Nomor telepon
 */
const extractPhoneFromJid = (jid) => {
    if (!jid) return null;

    // Hapus @s.whatsapp.net atau @g.us
    return jid.split('@')[0];
};

/**
 * Cek apakah JID adalah group
 * @param {string} jid - WhatsApp JID
 * @returns {boolean} - True jika group
 */
const isGroupJid = (jid) => {
    return jid && jid.endsWith('@g.us');
};

/**
 * Cek apakah JID adalah contact
 * @param {string} jid - WhatsApp JID
 * @returns {boolean} - True jika contact
 */
const isContactJid = (jid) => {
    return jid && jid.endsWith('@s.whatsapp.net');
};

/**
 * Format nomor untuk display (dengan +)
 * @param {string} phone - Nomor telepon
 * @returns {string} - Nomor terformat untuk display
 */
const formatForDisplay = (phone) => {
    if (!phone) return '';

    const cleanPhone = phone.replace(/\D/g, '');
    return `+${cleanPhone}`;
};

/**
 * Parse nomor telepon dari berbagai format
 * @param {string} input - Input nomor telepon
 * @param {string} countryCode - Kode negara default
 * @returns {Object} - Object dengan nomor original dan terformat
 */
const parsePhoneNumber = (input, countryCode = null) => {
    const original = input;
    const formatted = formatPhoneNumber(input, countryCode);
    const whatsappId = formatToWhatsAppId(input, countryCode);
    const display = formatForDisplay(formatted);
    const isValid = isValidPhoneNumber(input);

    return {
        original,
        formatted,
        whatsappId,
        display,
        isValid
    };
};

module.exports = {
    formatPhoneNumber,
    formatToWhatsAppId,
    formatMultiplePhones,
    formatMultipleToWhatsAppId,
    isValidPhoneNumber,
    extractPhoneFromJid,
    isGroupJid,
    isContactJid,
    formatForDisplay,
    parsePhoneNumber
};