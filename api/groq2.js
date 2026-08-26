// Vercel serverless function: second AI key for dual-validation.
// Uses GROQ_API_KEY_2 so TPM limits are independent per key.
// Leads with a different model than groq.js for cross-validation.
const MODELS = [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'qwen/qwen3.8-27b',
    'qwen/qwen3.6-27b',
];

const MODEL_GONE = /does not exist|decommission|not found|do not have access/i;
const REASONING_MODELS = /gpt-oss/i;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: { message: 'POST only' } });
        return;
    }
    const key = process.env.GROQ_API_KEY_2;
    if (!key) {
        res.status(404).json({ error: { message: 'GROQ_API_KEY_2 not configured — dual mode disabled.' } });
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
            if (!MODEL_GONE.test(msg)) break;
        } catch (e) {
            lastErr = { error: { message: e?.message ?? 'Upstream error' } };
        }
    }
    res.status(502).json(lastErr ?? { error: { message: 'No Groq model available on key 2.' } });
}
