/**
 * License Validation API Endpoint
 * POST /api/validate
 * 
 * Body: { key: "MARGO-XXXXX" }
 * Returns: { valid: boolean, reason?: string, info?: {...} }
 */

const { createClient } = require('@supabase/supabase-js');

// Supabase config (use environment variables in production)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uxvbousvsrupyhnwdiim.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY; // Secret key from Vercel env vars

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ valid: false, reason: 'Method not allowed' });
    }
    
    try {
        const { key } = req.body;
        
        if (!key || typeof key !== 'string') {
            return res.status(400).json({ valid: false, reason: 'Nie podano klucza licencji' });
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
            return res.status(200).json({ valid: false, reason: 'Nieprawidłowy klucz licencji' });
        }
        
        // Check if active
        if (!license.active) {
            return res.status(200).json({ valid: false, reason: 'Licencja została dezaktywowana' });
        }
        
        // Check expiration
        const now = new Date();
        const expiresAt = new Date(license.expires_at);
        
        if (now > expiresAt) {
            return res.status(200).json({ 
                valid: false, 
                reason: `Licencja wygasła ${expiresAt.toLocaleDateString('pl-PL')}` 
            });
        }
        
        // Calculate time remaining
        const msRemaining = expiresAt - now;
        const hoursRemaining = Math.ceil(msRemaining / (60 * 60 * 1000));
        const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
        
        // Update last_used, last_ip, and ip_history
        const ipHistory = license.ip_history || [];
        if (!ipHistory.includes(clientIP)) {
            ipHistory.push(clientIP);
        }
        
        await supabase
            .from('licenses')
            .update({
                last_used: now.toISOString(),
                last_ip: clientIP,
                ip_history: ipHistory
            })
            .eq('key', normalizedKey);
        
        // Return success
        return res.status(200).json({
            valid: true,
            info: {
                user: license.user_name,
                expiresAt: expiresAt.toISOString(),
                daysRemaining,
                hoursRemaining
            }
        });
        
    } catch (err) {
        console.error('License validation error:', err);
        return res.status(500).json({ valid: false, reason: 'Błąd serwera walidacji' });
    }
};
