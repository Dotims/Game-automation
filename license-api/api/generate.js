/**
 * License Generation API Endpoint (ADMIN)
 * POST /api/generate
 * 
 * Headers: { "x-admin-key": "YOUR_ADMIN_SECRET" }
 * Body: { user: "UserName", hours: 720 }
 * Returns: { success: boolean, key?: string, expiresAt?: string }
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uxvbousvsrupyhnwdiim.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change-this-secret';

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }
    
    // Check admin authorization
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== ADMIN_SECRET) {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
    }
    
    try {
        const { user, hours, days } = req.body;
        
        if (!user) {
            return res.status(400).json({ success: false, error: 'Missing user name' });
        }
        
        // Calculate expiration
        const totalHours = hours || (days ? days * 24 : 720); // Default 30 days
        const now = new Date();
        const expiresAt = new Date(now.getTime() + (totalHours * 60 * 60 * 1000));
        
        // Generate unique key
        const randomPart = crypto.randomBytes(8).toString('hex').toUpperCase();
        const key = `MARGO-${randomPart}`;
        
        // Initialize Supabase
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
        
        // Insert license
        const { data, error } = await supabase
            .from('licenses')
            .insert({
                key: key,
                user_name: user,
                expires_at: expiresAt.toISOString(),
                active: true,
                ip_history: []
            })
            .select()
            .single();
        
        if (error) {
            console.error('Insert error:', error);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        return res.status(200).json({
            success: true,
            key: key,
            user: user,
            expiresAt: expiresAt.toISOString(),
            hours: totalHours
        });
        
    } catch (err) {
        console.error('Generate license error:', err);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
};
