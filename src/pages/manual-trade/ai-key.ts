/**
 * Re-exports the Groq API key from ./ai-key.local.ts which is GITIGNORED,
 * so your key never reaches GitHub. A static import is required — dynamic
 * require() gets stripped by the bundler in the browser.
 *
 * Fresh clone? Copy ai-key.local.sample.ts to ai-key.local.ts and paste
 * your Groq key inside.
 */
export { GROQ_API_KEY } from './ai-key.local';
