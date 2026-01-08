/**
 * License Management Module - MargoBot
 * Online validation via Vercel API + Supabase
 */

const https = require('https');

// API Configuration
const LICENSE_API_URL = 'margobot-api.vercel.app';

/**
 * Validates a license key via online API
 * @param {string} key License key to validate
 * @returns {Promise<Object>} { valid, reason, info }
 */
async function validateLicense(key) {
    if (!key || typeof key !== 'string') {
        return { valid: false, reason: 'Nie podano klucza licencji' };
    }
    
    return new Promise((resolve) => {
        const postData = JSON.stringify({ key: key.trim() });
        
        const options = {
            hostname: LICENSE_API_URL,
            path: '/api/validate',
            method: 'POST',
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    resolve(result);
                } catch (e) {
                    console.error('License API parse error:', e.message);
                    resolve({ valid: false, reason: 'Błąd odpowiedzi serwera licencji' });
                }
            });
        });
        
        req.on('error', (e) => {
            console.error('License API error:', e.message);
            resolve({ valid: false, reason: 'Nie można połączyć z serwerem licencji' });
        });
        
        req.on('timeout', () => {
            req.destroy();
            resolve({ valid: false, reason: 'Timeout serwera licencji' });
        });
        
        req.write(postData);
        req.end();
    });
}

// Legacy functions kept for CLI tool (generate_license.js)
// These work with local file for admin use only

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const LICENSES_FILE = path.join(__dirname, '..', 'licenses.json');

function loadLicenses() {
    try {
        if (fs.existsSync(LICENSES_FILE)) {
            const data = fs.readFileSync(LICENSES_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('❌ License: Failed to load licenses.json:', e.message);
    }
    return { keys: {} };
}

function saveLicenses(db) {
    try {
        fs.writeFileSync(LICENSES_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (e) {
        console.error('❌ License: Failed to save licenses.json:', e.message);
    }
}

function generateLicense(userId, hours) {
    const db = loadLicenses();
    const randomPart = crypto.randomBytes(8).toString('hex').toUpperCase();
    const key = `MARGO-${randomPart}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (hours * 60 * 60 * 1000));
    
    db.keys[key] = {
        user: userId,
        expiresAt: expiresAt.toISOString(),
        active: true,
        createdAt: now.toISOString()
    };
    
    saveLicenses(db);
    return { key, expiresAt };
}

function deactivateLicense(key) {
    const db = loadLicenses();
    const normalizedKey = key.trim().toUpperCase();
    if (db.keys[normalizedKey]) {
        db.keys[normalizedKey].active = false;
        saveLicenses(db);
        return true;
    }
    return false;
}

function reactivateLicense(key) {
    const db = loadLicenses();
    const normalizedKey = key.trim().toUpperCase();
    if (db.keys[normalizedKey]) {
        db.keys[normalizedKey].active = true;
        saveLicenses(db);
        return true;
    }
    return false;
}

function listLicenses() {
    const db = loadLicenses();
    return Object.entries(db.keys).map(([key, info]) => ({
        key,
        ...info
    }));
}

module.exports = {
    validateLicense,
    generateLicense,
    deactivateLicense,
    reactivateLicense,
    listLicenses
};
