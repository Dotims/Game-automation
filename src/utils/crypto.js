/**
 * Code Protection - String Encryption Utility
 * Uses AES-256-CBC to encrypt/decrypt sensitive strings in memory.
 */

const crypto = require('crypto');

// Hardcoded key (obfuscated by Bytenode in final build)
// In production, this could be derived or split
const ENCRYPTION_KEY = Buffer.from('12345678901234567890123456789012'); // 32 chars
const IV_LENGTH = 16; // For AES, this is always 16

function encrypt(text) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
    if (!text) return '';
    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        
        const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (error) {
        console.error('Decryption failed:', error.message);
        return 'DECRYPTION_ERROR';
    }
}

// Utility to generate hash of current executable for integrity check
function getSelfHash() {
    try {
        const fs = require('fs');
        const fileBuffer = fs.readFileSync(process.execPath);
        const hashSum = crypto.createHash('sha256');
        hashSum.update(fileBuffer);
        return hashSum.digest('hex');
    } catch (e) {
        return null;
    }
}

module.exports = { encrypt, decrypt, getSelfHash };

// Helper to encrypt strings during development
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length > 0) {
        console.log('Encrypted:', encrypt(args[0]));
    }
}
