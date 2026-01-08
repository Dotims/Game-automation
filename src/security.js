/**
 * Security Module - MargoBot
 * Anti-debugging and binary integrity verification
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// ============================================
// ANTI-DEBUGGING PROTECTION
// ============================================

let debugCheckInterval = null;
let debugDetected = false;

/**
 * Starts anti-debugging protection
 * Detects if someone is using a debugger to analyze the code
 */
function startAntiDebug() {
    // Check 1: Timing-based debugger detection
    debugCheckInterval = setInterval(() => {
        const start = Date.now();
        
        // This line pauses execution if debugger is attached
        // eslint-disable-next-line no-debugger
        debugger;
        
        const elapsed = Date.now() - start;
        
        // If debugger is attached, this takes >100ms
        if (elapsed > 100) {
            debugDetected = true;
            console.error('\n⛔ SECURITY VIOLATION: Debugger detected!');
            console.error('   Bot cannot run with debugging tools attached.');
            console.error('   Please close all debugging software and restart.\n');
            
            // Graceful shutdown
            setTimeout(() => {
                process.exit(1);
            }, 1000);
        }
    }, 5000); // Check every 5 seconds
    
    // Check 2: Inspector detection (Node.js specific)
    try {
        const inspector = require('inspector');
        if (inspector.url()) {
            debugDetected = true;
            console.error('\n⛔ SECURITY VIOLATION: Node inspector detected!');
            process.exit(1);
        }
    } catch (e) {
        // Inspector not available, which is fine
    }
    
    // Check 3: Environment variable checks
    const suspiciousEnvVars = ['NODE_OPTIONS', 'NODE_DEBUG', 'DEBUG'];
    for (const envVar of suspiciousEnvVars) {
        if (process.env[envVar] && process.env[envVar].includes('inspect')) {
            debugDetected = true;
            console.error(`\n⛔ SECURITY VIOLATION: Suspicious environment variable ${envVar} detected!`);
            process.exit(1);
        }
    }
}

/**
 * Stops anti-debugging checks (for clean shutdown)
 */
function stopAntiDebug() {
    if (debugCheckInterval) {
        clearInterval(debugCheckInterval);
        debugCheckInterval = null;
    }
}

/**
 * Check if debug was detected
 */
function isDebugDetected() {
    return debugDetected;
}

// ============================================
// BINARY INTEGRITY VERIFICATION (CHECKSUM)
// ============================================

/**
 * Calculates SHA256 hash of the current executable
 * Used to detect if someone modified the binary
 * @returns {string|null} Hash of executable or null if not packaged
 */
function getExecutableHash() {
    try {
        // process.execPath is the path to the pkg binary
        const execPath = process.execPath;
        
        // Check if we're running as packaged binary
        // pkg sets process.pkg when running as packaged app
        if (!process.pkg) {
            // Running as regular node script, not packaged
            return null;
        }
        
        const fileBuffer = fs.readFileSync(execPath);
        const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        
        return hash;
    } catch (e) {
        console.error('Security: Could not calculate executable hash:', e.message);
        return null;
    }
}

/**
 * Verifies that the executable hasn't been tampered with
 * @param {string[]} validHashes - Array of valid SHA256 hashes
 * @returns {Object} { valid: boolean, hash: string, reason: string }
 */
function verifyBinaryIntegrity(validHashes = []) {
    const currentHash = getExecutableHash();
    
    // Not packaged - skip check (development mode)
    if (currentHash === null) {
        return { 
            valid: true, 
            hash: null, 
            reason: 'Development mode - integrity check skipped',
            isDevelopment: true
        };
    }
    
    // No valid hashes provided - just return current hash
    if (!validHashes || validHashes.length === 0) {
        return {
            valid: true,
            hash: currentHash,
            reason: 'No reference hashes configured',
            isDevelopment: false
        };
    }
    
    // Check if current hash matches any valid hash
    const isValid = validHashes.includes(currentHash);
    
    return {
        valid: isValid,
        hash: currentHash,
        reason: isValid ? 'Binary integrity verified' : 'BINARY MODIFIED - integrity check failed!',
        isDevelopment: false
    };
}

/**
 * Gets system fingerprint for logging/tracking
 * @returns {Object} System info
 */
function getSystemFingerprint() {
    const os = require('os');
    
    return {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        cpuModel: os.cpus()[0]?.model || 'unknown',
        totalMemory: Math.round(os.totalmem() / (1024 * 1024 * 1024)) + 'GB'
    };
}

module.exports = {
    startAntiDebug,
    stopAntiDebug,
    isDebugDetected,
    getExecutableHash,
    verifyBinaryIntegrity,
    getSystemFingerprint
};
