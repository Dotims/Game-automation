/**
 * License Management Module - MargoBot
 * Online validation via Vercel API + Supabase
 * With response signature verification (anti-fake-server protection)
 */

const https = require('https');
const crypto = require('crypto');

// API Configuration
const LICENSE_API_URL = 'margobot-api.vercel.app';

// Response signing secret - MUST match the one on server
// This prevents fake API servers from working
const RESPONSE_SECRET = 'MARGO-SIGN-KEY-2026';

// Maximum age of response (5 minutes) - prevents replay attacks
const MAX_RESPONSE_AGE = 5 * 60 * 1000;

/**
 * Verifies the signature of an API response
 * @param {Object} response - Full response from API
 * @returns {boolean} True if signature is valid
 */
function verifyResponseSignature(response) {
    const { signature, timestamp, ...data } = response;
    
    // Check if signature and timestamp exist
    if (!signature || !timestamp) {
        console.error('License API: Missing signature or timestamp');
        return false;
    }
    
    // Check if response is not too old (prevent replay attacks)
    const age = Date.now() - timestamp;
    if (age > MAX_RESPONSE_AGE || age < -60000) { // Allow 1 min clock skew
        console.error('License API: Response too old or from future');
        return false;
    }
    
    // Recalculate signature
    const payload = JSON.stringify(data) + timestamp.toString();
    const expectedSignature = crypto
        .createHmac('sha256', RESPONSE_SECRET)
        .update(payload)
        .digest('hex');
    
    // Compare signatures
    if (signature !== expectedSignature) {
        console.error('License API: Invalid signature - possible fake server!');
        return false;
    }
    
    return true;
}

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
                    
                    // VERIFY SIGNATURE - reject if invalid
                    if (!verifyResponseSignature(result)) {
                        resolve({ 
                            valid: false, 
                            reason: 'Błąd weryfikacji serwera licencji (nieprawidłowy podpis)' 
                        });
                        return;
                    }
                    
                    // Remove signature fields before returning
                    const { signature, timestamp, ...cleanResult } = result;
                    resolve(cleanResult);
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
// crypto already imported at top of file
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
