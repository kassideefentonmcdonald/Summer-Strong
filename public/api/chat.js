// api/chat.js
// Vercel Serverless Function — proxies requests to Anthropic API
// so your API key is never exposed to the browser.
//
// ─── SETUP ───────────────────────────────────────────────────────────────
// 1. In your Vercel project dashboard → Settings → Environment Variables
//    Add:  ANTHROPIC_API_KEY = sk-ant-xxxxxxxxxxxxxxxx
// 2. Place this file at:  /api/chat.js  in your project root
// 3. Deploy — Vercel auto-detects files in /api as serverless functions
// ─────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const { system, messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: system || '',
        messages,
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('Anthropic API error:', errText);
      return res.status(anthropicRes.status).json({ error: 'Upstream API error' });
    }

    const data = await anthropicRes.json();
    return res.status(200).json(data);

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
