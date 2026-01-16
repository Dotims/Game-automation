/**
 * License Validation API Endpoint with Response Signing
 * POST /api/validate
 * 
 * Body: { key: "MARGO-XXXXX" }
 * Returns: { valid: boolean, reason?: string, info?: {...}, signature: string, timestamp: number }
 * 
 * The response is signed with HMAC-SHA256 to prevent fake server attacks
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Supabase config (use environment variables in production)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uxvbousvsrupyhnwdiim.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Response signing secret - MUST match the one in bot's license.js
// This is the key that prevents fake API servers
const RESPONSE_SECRET = process.env.RESPONSE_SECRET || 'MARGO-SIGN-KEY-2026';

/**
 * Signs the response data with HMAC-SHA256
 */
function signResponse(data, timestamp) {
    const payload = JSON.stringify(data) + timestamp.toString();
    const signature = crypto
        .createHmac('sha256', RESPONSE_SECRET)
        .update(payload)
        .digest('hex');
    return signature;
}

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ valid: false, reason: 'Method not allowed', signature: '', timestamp: 0 });
    }
    
    try {
        const { key } = req.body;
        
        if (!key || typeof key !== 'string') {
            const responseData = { valid: false, reason: 'Nie podano klucza licencji' };
            const timestamp = Date.now();
            const signature = signResponse(responseData, timestamp);
            return res.status(400).json({ ...responseData, signature, timestamp });
        }
        
        // Initialize Supabase
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
        
        // Normalize key
        const normalizedKey = key.trim().toUpperCase();
        
        // Get client IP
        const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() 
            || req.headers['x-real-ip'] 
            || req.connection?.remoteAddress 
            || 'unknown';
        
        // Fetch license from database
        const { data: license, error } = await supabase
            .from('licenses')
            .select('*')
            .eq('key', normalizedKey)
            .single();
        
        if (error || !license) {
            const responseData = { valid: false, reason: 'Nieprawidłowy klucz licencji' };
            const timestamp = Date.now();
            const signature = signResponse(responseData, timestamp);
            return res.status(200).json({ ...responseData, signature, timestamp });
        }
        
        // Check if active
        if (!license.active) {
            const responseData = { valid: false, reason: 'Licencja została dezaktywowana' };
            const timestamp = Date.now();
            const signature = signResponse(responseData, timestamp);
            return res.status(200).json({ ...responseData, signature, timestamp });
        }
        
        // Check expiration
        const now = new Date();
        const expiresAt = new Date(license.expires_at);
        
        if (now > expiresAt) {
            const responseData = { valid: false, reason: `Licencja wygasła ${expiresAt.toLocaleDateString('pl-PL')}` };
            const timestamp = Date.now();
            const signature = signResponse(responseData, timestamp);
            return res.status(200).json({ ...responseData, signature, timestamp });
        }
        
        // Calculate time remaining
        const msRemaining = expiresAt - now;
        const hoursRemaining = Math.ceil(msRemaining / (60 * 60 * 1000));
        const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
        
        // Update last_used, last_ip, and ip_history
        // Format: "IP - DD.MM.YYYY - HH:MM" - only add new entry if IP is new
        const ipHistory = license.ip_history || [];
        
        // Check if this IP already exists in history (check only the IP part before " - ")
        const ipAlreadyLogged = ipHistory.some(entry => {
            const entryIP = entry.split(' - ')[0];
            return entryIP === clientIP;
        });
        
        if (!ipAlreadyLogged) {
            // New IP detected - add entry with timestamp
            const nowDate = now.toLocaleDateString('pl-PL', { 
                day: '2-digit', 
                month: '2-digit', 
                year: 'numeric' 
            });
            const nowTime = now.toLocaleTimeString('pl-PL', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false
            });
            const newEntry = `${clientIP} - ${nowDate} - ${nowTime}`;
            ipHistory.push(newEntry);
        }
        
        await supabase
            .from('licenses')
            .update({
                last_used: now.toISOString(),
                last_ip: clientIP,
                ip_history: ipHistory
            })
            .eq('key', normalizedKey);
        
        // Build and sign successful response
        const responseData = {
            valid: true,
            info: {
                user: license.user_name,
                expiresAt: expiresAt.toISOString(),
                daysRemaining,
                hoursRemaining
            }
        };
        const timestamp = Date.now();
        const signature = signResponse(responseData, timestamp);
        
        return res.status(200).json({ ...responseData, signature, timestamp });
        
    } catch (err) {
        console.error('License validation error:', err);
        const responseData = { valid: false, reason: 'Błąd serwera walidacji' };
        const timestamp = Date.now();
        const signature = signResponse(responseData, timestamp);
        return res.status(500).json({ ...responseData, signature, timestamp });
    }
};
