/**
 * RMS Multitool — License validation endpoint for Lemon Squeezy
 *
 * Deploy to Vercel. In Vercel project settings → Environment Variables, add:
 *   LEMONSQUEEZY_API_KEY = your Lemon Squeezy API key (Settings → API in Lemon Squeezy dashboard)
 *
 * Request:  POST /api/validate   Body: { "code": "USER_LICENSE_KEY" }
 * Response: { "valid": true, "type": "unlock" }  or  { "valid": false, "error": "..." }
 */

const LEMON_VALIDATE_URL = 'https://api.lemonsqueezy.com/v1/licenses/validate';

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
}

export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ valid: false });
    }

    const apiKey = process.env.LEMONSQUEEZY_API_KEY || '';
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!code) {
        return res.status(200).json({ valid: false, error: 'No code provided' });
    }

    try {
        const formBody = new URLSearchParams({ license_key: code }).toString();
        const baseHeaders = {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
        };

        // Lemon Squeezy License API docs show validate without Authorization. Try no-auth first (works for test keys).
        let lsRes = await fetch(LEMON_VALIDATE_URL, {
            method: 'POST',
            headers: baseHeaders,
            body: formBody,
        });
        if (lsRes.status === 401 && apiKey) {
            lsRes = await fetch(LEMON_VALIDATE_URL, {
                method: 'POST',
                headers: { ...baseHeaders, 'Authorization': `Bearer ${apiKey}` },
                body: formBody,
            });
        }

        const data = await lsRes.json().catch(() => ({}));

        if (data.valid === true) {
            return res.status(200).json({ valid: true, type: 'unlock' });
        }
        const msg = typeof data.error === 'string' ? data.error : (data.error && data.error.message) || (!lsRes.ok ? `API ${lsRes.status}` : null);
        return res.status(200).json({ valid: false, error: msg || 'Invalid or expired license key' });
    } catch (err) {
        console.error('License validate error:', err);
        return res.status(200).json({ valid: false, error: err.message || 'Server error' });
    }
}
