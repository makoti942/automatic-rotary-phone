// Vercel serverless function: proxies chat completions to Groq.
// The key lives ONLY in the GROQ_API_KEY environment variable
// (Vercel Dashboard → Project → Settings → Environment Variables),
// never in the repository or the client bundle.
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: { message: 'POST only' } });
        return;
    }
    const key = process.env.GROQ_API_KEY;
    if (!key) {
        res.status(500).json({ error: { message: 'GROQ_API_KEY env var is not configured on this deployment.' } });
        return;
    }
    try {
        const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify(req.body),
        });
        const data = await upstream.json();
        res.status(upstream.status).json(data);
    } catch (e) {
        res.status(502).json({ error: { message: e?.message ?? 'Upstream error' } });
    }
}
