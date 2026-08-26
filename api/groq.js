// Vercel serverless function: proxies chat completions to Groq.
// The key lives ONLY in the GROQ_API_KEY environment variable
// (Vercel Dashboard → Project → Settings → Environment Variables),
// never in the repository or the client bundle.
//
// Model chain: if Groq deprecates a model, the next one takes over
// automatically instead of breaking deployments.
const MODELS = [
    'qwen/qwen3.8-27b',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'qwen/qwen3.6-27b',
];

const MODEL_GONE = /does not exist|decommission|not found|do not have access/i;
const REASONING_MODELS = /gpt-oss/i;

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
    let lastErr = null;
    for (const model of MODELS) {
        try {
            const body = {
                ...req.body,
                model,
            };
            delete body.signal;
            // reasoning_effort only supported by gpt-oss models
            if (!REASONING_MODELS.test(model)) delete body.reasoning_effort;
            const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
                body: JSON.stringify(body),
            });
            const data = await upstream.json();
            if (upstream.ok && !data.error) {
                res.status(200).json(data);
                return;
            }
            lastErr = data;
            const msg = data?.error?.message ?? '';
            if (!MODEL_GONE.test(msg)) break; // rate limit / real error → surface it
            // else: model gone → fall through to next candidate
        } catch (e) {
            lastErr = { error: { message: e?.message ?? 'Upstream error' } };
        }
    }
    res.status(502).json(lastErr ?? { error: { message: 'No Groq model available.' } });
}
