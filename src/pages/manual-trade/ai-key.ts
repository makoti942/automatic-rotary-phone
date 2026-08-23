/**
 * Resolves the Groq API key without ever committing it:
 * the real key lives in ./ai-key.local.ts which is gitignored.
 * Fresh clones build fine with an empty key (AI panel will say so).
 */
let key = '';
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    key = require('./ai-key.local').GROQ_API_KEY ?? '';
} catch (_) {
    key = '';
}
export const GROQ_API_KEY: string = key;
