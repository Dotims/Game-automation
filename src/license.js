/**
 * License Management Module - MargoBot
 * Online validation with external time source
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Path to license database
const LICENSES_FILE = path.join(__dirname, '..', 'licenses.json');

// Cache for external time (refresh every 5 minutes)
let cachedTime = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches current time from external API (prevents system time manipulation)
 * @returns {Promise<Date>} Current date from external source
 */
async function getExternalTime() {
    // Return cached time if still valid
    if (cachedTime && (Date.now() - cacheTimestamp) < CACHE_DURATION) {
        // Adjust cached time by elapsed time since cache
        const elapsed = Date.now() - cacheTimestamp;
        return new Date(cachedTime.getTime() + elapsed);
    }

    return new Promise((resolve, reject) => {
        // Primary: worldtimeapi.org
        const options = {
            hostname: 'worldtimeapi.org',
            path: '/api/timezone/Europe/Warsaw',
            method: 'GET',
            timeout: 5000
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const externalDate = new Date(json.datetime);
                    cachedTime = externalDate;
                    cacheTimestamp = Date.now();
                    resolve(externalDate);
                } catch (e) {
                    // Fallback to system time (with warning)
                    console.warn('⚠️ License: Could not parse external time, using system time');
                    resolve(new Date());
                }
            });
        });

        req.on('error', (e) => {
            console.warn('⚠️ License: External time API error, using system time:', e.message);
            resolve(new Date());
        });

        req.on('timeout', () => {
            req.destroy();
            console.warn('⚠️ License: External time API timeout, using system time');
            resolve(new Date());
        });

        req.end();
    });
}

/**
 * Loads license database
 * @returns {Object} License database
 */
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

/**
 * Saves license database
 * @param {Object} db License database
 */
function saveLicenses(db) {
    try {
        fs.writeFileSync(LICENSES_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (e) {
        console.error('❌ License: Failed to save licenses.json:', e.message);
    }
}

/**
 * Generates a new license key
 * @param {string} userId User identifier
 * @param {number} hours Hours until expiration
 * @returns {Object} { key, expiresAt }
 */
function generateLicense(userId, hours) {
    const db = loadLicenses();
    
    // Generate unique key
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

/**
 * Validates a license key
 * @param {string} key License key to validate
 * @returns {Promise<Object>} { valid, reason, info }
 */
async function validateLicense(key) {
    if (!key || typeof key !== 'string') {
        return { valid: false, reason: 'Nie podano klucza licencji' };
    }
    
    const db = loadLicenses();
    const normalizedKey = key.trim().toUpperCase();
    
    // Check if key exists
    if (!db.keys[normalizedKey]) {
        return { valid: false, reason: 'Nieprawidłowy klucz licencji' };
    }
    
    const license = db.keys[normalizedKey];
    
    // Check if active
    if (!license.active) {
        return { valid: false, reason: 'Licencja została dezaktywowana' };
    }
    
    // Check expiration (using external time)
    const currentTime = await getExternalTime();
    const expiresAt = new Date(license.expiresAt);
    
    if (currentTime > expiresAt) {
        return { 
            valid: false, 
            reason: `Licencja wygasła ${expiresAt.toLocaleDateString('pl-PL')}` 
        };
    }
    
    // Calculate time remaining
    const msRemaining = expiresAt - currentTime;
    const hoursRemaining = Math.ceil(msRemaining / (60 * 60 * 1000));
    const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
    
    return { 
        valid: true, 
        info: {
            user: license.user,
            expiresAt: expiresAt,
            daysRemaining: daysRemaining,
            hoursRemaining: hoursRemaining
        }
    };
}

/**
 * Deactivates a license key
 * @param {string} key License key to deactivate
 * @returns {boolean} Success
 */
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

/**
 * Reactivates a license key
 * @param {string} key License key to reactivate
 * @returns {boolean} Success
 */
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

/**
 * Lists all licenses
 * @returns {Array} Array of license info
 */
function listLicenses() {
    const db = loadLicenses();
    return Object.entries(db.keys).map(([key, info]) => ({
        key,
        ...info
    }));
}

module.exports = {
    getExternalTime,
    validateLicense,
    generateLicense,
    deactivateLicense,
    reactivateLicense,
    listLicenses
};
