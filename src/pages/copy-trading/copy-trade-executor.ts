import { getFollowers, getFollowerStats, setFollowerStats, clearFollowerStats, dbSet, pushFollowerTrade } from './firebase-config';

// ══════════════════════════════════════════════════════════════
// INLINED from @/auth/NewDerivAuth — NEVER import that module
// ══════════════════════════════════════════════════════════════

function convertToNewFormat(data: any): any {
    if (!data || typeof data !== 'object') return data;
    const out = Array.isArray(data) ? data.map(convertToNewFormat) : { ...data };
    if (out.proposal === 1 && out.symbol) { out.underlying_symbol = out.symbol; delete out.symbol; }
    if ('buy' in out) { out.buy = String(out.buy); }
    if (out.parameters && typeof out.parameters === 'object') {
        out.parameters = { ...out.parameters };
        if ('symbol' in out.parameters) { out.parameters.underlying_symbol = out.parameters.symbol; delete out.parameters.symbol; }
    }
    return out;
}

function parseEventDetail(detail: any): any {
    if (!detail) return null;
    if (typeof detail === 'string') { try { return JSON.parse(detail); } catch { return null; } }
    if (detail.data && typeof detail.data === 'string') { try { return JSON.parse(detail.data); } catch { return null; } }
    return detail;
}

function onNewSystemMessageLocal(cb: (data: any) => void): () => void {
    if (typeof window === 'undefined') return () => {};
    const handler = (event: Event) => {
        try { const parsed = parseEventDetail((event as CustomEvent).detail); if (parsed) cb(parsed); } catch (_) {}
    };
    window.addEventListener('newSystemMessage', handler);
    return () => window.removeEventListener('newSystemMessage', handler);
}

function sendViaNewSystemLocal(msg: any): Promise<any> {
    return new Promise((resolve, reject) => {
        const ws = (window as any)._newSystemWS;
        if (!ws || ws.readyState !== WebSocket.OPEN) { reject(new Error('WebSocket not open')); return; }
        const reqId = msg.req_id || Date.now();
        const toSend = { ...convertToNewFormat(msg), req_id: reqId };
        const msgType = Object.keys(msg).find(k => k !== 'passthrough' && k !== 'req_id');
        const handler = (event: Event) => {
            try {
                const parsed = parseEventDetail((event as CustomEvent).detail);
                if (!parsed) return;
                if (parsed.req_id === reqId || (msgType && parsed.msg_type === msgType)) {
                    window.removeEventListener('newSystemMessage', handler);
                    if (parsed.error) reject(parsed); else resolve(parsed);
                }
            } catch (_) {}
        };
        window.addEventListener('newSystemMessage', handler);
        ws.send(JSON.stringify(toSend));
        setTimeout(() => { window.removeEventListener('newSystemMessage', handler); reject(new Error('Timeout')); }, 30000);
    });
}

// ══════════════════════════════════════════════════════════════
// Per-follower trade via DIRECT TOKEN AUTH (fast, instant)
// 1. Open WS to Deriv
// 2. Authorize with follower's API token
// 3. Send proposal → buy
// No OTP, no REST call — direct WebSocket trading
// ══════════════════════════════════════════════════════════════

const APP_ID = '33UD5Xga7WHSzXFtBYdmr';
const WS_URL = `wss://api.derivws.com/trading/v1/websockets/v3?app_id=${APP_ID}`;

async function buyOnFollowerAccount(
    followerToken: string,
    accountId: string,
    contractParams: Record<string, unknown>,
    stake: number
): Promise<any> {
    const tag = accountId.slice(-4);
    const ws = new WebSocket(WS_URL);

    return new Promise((resolve, reject) => {
        let done = false;
        const cleanup = () => { done = true; try { ws.close(); } catch {} };
        const timeout = setTimeout(() => { cleanup(); if (!done) reject(new Error('Follower buy timeout')); }, 30000);

        ws.onopen = () => {
            console.log(`[CopyTrade] ...${tag} WS open, authorizing...`);
            ws.send(JSON.stringify({ authorize: followerToken }));
        };

        ws.onmessage = (event) => {
            if (done) return;
            try {
                const data = JSON.parse(event.data);
                if (data.error) {
                    console.error(`[CopyTrade] ...${tag} error:`, data.error.message);
                    cleanup();
                    clearTimeout(timeout);
                    reject(new Error(data.error.message));
                    return;
                }
                // Step 1: Authorized → send proposal
                if (data.authorize) {
                    console.log(`[CopyTrade] ...${tag} authorized, sending proposal: ${contractParams.contract_type}...`);
                    ws.send(JSON.stringify({
                        proposal: 1,
                        amount: stake,
                        basis: 'stake',
                        contract_type: contractParams.contract_type,
                        currency: contractParams.currency,
                        duration: contractParams.duration,
                        duration_unit: contractParams.duration_unit,
                        underlying_symbol: contractParams.underlying_symbol,
                        barrier: contractParams.barrier,
                        req_id: 1,
                    }));
                    return;
                }
                // Step 2: Proposal received → buy
                if (data.req_id === 1 && data.proposal) {
                    console.log(`[CopyTrade] ...${tag} proposal: ${data.proposal.id}, buying...`);
                    ws.send(JSON.stringify({ buy: data.proposal.id, price: data.proposal.ask_price, req_id: 2 }));
                    return;
                }
                // Step 3: Buy success → resolve
                if (data.req_id === 2 && data.buy) {
                    console.log(`[CopyTrade] ...${tag} BUY SUCCESS:`, data.buy.contract_id);
                    cleanup();
                    clearTimeout(timeout);
                    resolve(data.buy);
                }
            } catch {}
        };

        ws.onerror = (err) => {
            console.error(`[CopyTrade] ...${tag} WS error:`, err);
            cleanup();
            clearTimeout(timeout);
            if (!done) reject(new Error('Follower WS connection failed'));
        };

        ws.onclose = () => {
            if (!done) {
                cleanup();
                clearTimeout(timeout);
                reject(new Error('Follower WS closed'));
            }
        };
    });
}

// ══════════════════════════════════════════════════════════════
// Global interceptor
// ══════════════════════════════════════════════════════════════

let interceptorInstalled = false;
let masterId: string | null = null;
let unsubs: (() => void)[] = [];
let countedContractIds: Set<string> = new Set();
let cachedFollowers: Record<string, any> = {};
let lastProposalParams: Record<string, any> | null = null;
let origWsSend: ((data: string) => void) | null = null;

export function refreshCachedFollowers(f: Record<string, any>) {
    cachedFollowers = f;
}

function extractProposalParams(msg: any): Record<string, unknown> | null {
    // Flatten: params may be top-level or inside "parameters" object
    const raw = msg;
    const p = (raw.parameters && typeof raw.parameters === 'object')
        ? { ...raw, ...raw.parameters }
        : raw;
    if (!p.contract_type || p.amount == null || !p.basis) return null;
    const params: Record<string, unknown> = {
        amount: Number(p.amount) || 1,
        basis: p.basis || 'stake',
        contract_type: p.contract_type,
        currency: p.currency || 'USD',
        duration: p.duration || 1,
        duration_unit: p.duration_unit || 't',
        underlying_symbol: p.underlying_symbol || p.symbol || '1HZ100V',
    };
    if (p.barrier != null) params.barrier = p.barrier;
    if (p.barrier2 != null) params.barrier2 = p.barrier2;
    return params;
}

// Buy ONE follower: open WS → auth → proposal → buy (all in one connection)
async function buyOnFollower(
    follower: any,
    contractParams: Record<string, unknown>,
    stake: number
): Promise<{ contractId: string; balance?: number } | null> {
    const tag = follower.account_id?.slice(-4) || '?';
    const ws = new WebSocket(WS_URL);

    return new Promise((resolve) => {
        let done = false;
        const cleanup = () => { done = true; try { ws.close(); } catch {} };
        const timeout = setTimeout(() => { cleanup(); resolve(null); }, 20000);

        ws.onopen = () => {
            ws.send(JSON.stringify({ authorize: follower.token }));
        };

        ws.onmessage = (event) => {
            if (done) return;
            try {
                const data = JSON.parse(event.data);
                if (data.error) {
                    console.error(`[CopyTrade] ...${tag} error:`, data.error.message);
                    cleanup(); clearTimeout(timeout); resolve(null);
                    return;
                }
                if (data.authorize) {
                    ws.send(JSON.stringify({
                        proposal: 1,
                        amount: stake,
                        basis: 'stake',
                        contract_type: contractParams.contract_type,
                        currency: contractParams.currency,
                        duration: contractParams.duration,
                        duration_unit: contractParams.duration_unit,
                        underlying_symbol: contractParams.underlying_symbol,
                        barrier: contractParams.barrier,
                        req_id: 1,
                    }));
                    return;
                }
                if (data.req_id === 1 && data.proposal) {
                    console.log(`[CopyTrade] ...${tag} proposal ${data.proposal.id}, buying ${contractParams.contract_type}...`);
                    ws.send(JSON.stringify({ buy: data.proposal.id, price: data.proposal.ask_price, req_id: 2 }));
                    return;
                }
                if (data.req_id === 2 && data.buy) {
                    console.log(`[CopyTrade] ...${tag} BUY OK:`, data.buy.contract_id);
                    cleanup(); clearTimeout(timeout);
                    resolve({ contractId: data.buy.contract_id, balance: data.buy.balance });
                }
            } catch {}
        };

        ws.onerror = () => { cleanup(); clearTimeout(timeout); resolve(null); };
        ws.onclose = () => { if (!done) { cleanup(); clearTimeout(timeout); resolve(null); } };
    });
}

export function installCopyTradeInterceptor(mId: string) {
    if (interceptorInstalled) return;
    interceptorInstalled = true;
    masterId = mId;
    countedContractIds = new Set();
    cachedFollowers = {};
    lastProposalParams = null;
    console.log('[CopyTrade] Interceptor installed for master:', mId);

    getFollowers(mId).then(f => { if (f) cachedFollowers = f; }).catch(() => {});

    // Monkey-patch master WS.send to capture OUTGOING proposal requests
    // The bot's proposals don't fire newSystemMessage events, so we intercept
    // them at the send() level. This gives us the exact contract params BEFORE
    // the buy happens — zero delay.
    try {
        const patchWs = () => {
            const ws = (window as any)._newSystemWS;
            if (!ws || origWsSend) return;
            origWsSend = ws.send.bind(ws);
            ws.send = (raw: string) => {
                try {
                    const msg = JSON.parse(raw);
                    if (msg.proposal === 1) {
                        const params = extractProposalParams(msg);
                        if (params) {
                            lastProposalParams = params;
                            console.log('[CopyTrade] Intercepted proposal:', params.contract_type,
                                '| barrier:', (params as any).barrier ?? 'none');
                        }
                    }
                } catch {}
                origWsSend!(raw);
            };
        };
        patchWs();
        // Also retry every 2s in case _newSystemWS isn't ready yet
        const retryInterval = setInterval(() => {
            if (interceptorInstalled) patchWs();
            else clearInterval(retryInterval);
        }, 2000);
    } catch {}

    const unsub1 = onNewSystemMessageLocal((data: any) => {
        if (data.msg_type !== 'buy' || !data.buy || !data.buy.contract_id) return;

        const cid = String(data.buy.contract_id);
        if (countedContractIds.has(cid)) return;
        countedContractIds.add(cid);
        if (countedContractIds.size > 500) {
            const arr = Array.from(countedContractIds);
            countedContractIds = new Set(arr.slice(-200));
        }

        const stake = Number(data.buy.buy_price) || 1;
        console.log('[CopyTrade] Master BUY:', cid, '| stake:', stake);

        const entries = Object.entries(cachedFollowers).filter(([, f]) => f.token);
        if (entries.length === 0) { console.log('[CopyTrade] No followers'); return; }

        // Use captured proposal params (from monkey-patch) OR fall back to POC
        const useParams = async (): Promise<Record<string, unknown> | null> => {
            // Fast path: use intercepted proposal params (instant)
            if (lastProposalParams) {
                console.log('[CopyTrade] Using intercepted proposal params');
                return { ...lastProposalParams, amount: stake };
            }
            // Slow path: query POC
            console.log('[CopyTrade] No intercepted params, querying POC...');
            try {
                const res = await sendViaNewSystemLocal({
                    proposal_open_contract: 1,
                    contract_id: cid,
                    subscribe: 0,
                });
                const c = res?.proposal_open_contract;
                if (!c) return null;
                return {
                    contract_type: c.contract_type || 'CALL',
                    currency: c.currency || 'USD',
                    duration: c.duration || 1,
                    duration_unit: c.duration_unit || 't',
                    underlying_symbol: c.underlying || '1HZ100V',
                    barrier: c.barrier,
                    barrier2: c.barrier2,
                    amount: stake,
                };
            } catch { return null; }
        };

        (async () => {
            const contractParams = await useParams();
            if (!contractParams) {
                console.log('[CopyTrade] Could not determine contract params');
                return;
            }

            console.log(`[CopyTrade] Contract: ${contractParams.contract_type} | barrier: ${(contractParams as any).barrier ?? 'none'} | ${entries.length} followers`);

            // Push pending trades
            const tradeTime = Date.now();
            for (const [fid] of entries) {
                pushFollowerTrade(mId, fid, {
                    id: `pending_${tradeTime}_${fid}`,
                    type: String(contractParams.contract_type),
                    stake,
                    pnl: 0,
                    time: tradeTime,
                    status: 'pending',
                });
            }

            // Buy all followers simultaneously
            await Promise.all(entries.map(async ([fid, follower]) => {
                try {
                    const result = await buyOnFollower(follower, contractParams, stake);
                    if (result) {
                        pushFollowerTrade(mId, fid, {
                            id: result.contractId,
                            type: String(contractParams.contract_type),
                            stake,
                            pnl: 0,
                            time: tradeTime,
                            status: 'pending',
                        });
                        if (result.balance != null) {
                            dbSet(`masters/${mId}/followers/${fid}/balance`, Number(result.balance));
                        }
                    }
                } catch (err: any) {
                    console.error(`[CopyTrade] ${fid} failed:`, err.message);
                }
            }));
        })();
    });
    unsubs.push(unsub1);
}

export function uninstallCopyTradeInterceptor() {
    interceptorInstalled = false;
    masterId = null;
    unsubs.forEach(u => u());
    unsubs = [];
    countedContractIds = new Set();
    cachedFollowers = {};
    lastProposalParams = null;
    // Restore original send
    try {
        const ws = (window as any)._newSystemWS;
        if (ws && origWsSend) { ws.send = origWsSend; }
    } catch {}
    origWsSend = null;
}

// ══════════════════════════════════════════════════════════════
// Public helpers
// ══════════════════════════════════════════════════════════════

export function subscribeBalance(): Promise<void> {
    return sendViaNewSystemLocal({ balance: 1, subscribe: 1 }).then(() => {});
}

export function subscribeOpenContracts(): Promise<void> {
    return sendViaNewSystemLocal({ proposal_open_contract: 1, subscribe: 1 }).then(() => {});
}

export function onTradeMessage(cb: (data: any) => void): () => void {
    return onNewSystemMessageLocal(cb);
}

export async function resetFollowerStats(followerId: string) {
    if (!masterId) return;
    await clearFollowerStats(masterId, followerId);
}

export async function saveMyBalance(masterId: string, followerId: string, balance: number) {
    try {
        // Only save if follower entry still exists (wasn't removed)
        const res = await fetch(`https://makoti-6ba23-default-rtdb.firebaseio.com/masters/${masterId}/followers/${followerId}/token.json`);
        if (res.ok) {
            const token = await res.json();
            if (token) {
                await dbSet(`masters/${masterId}/followers/${followerId}/balance`, balance);
            }
        }
    } catch {}
}

export function hasContractBeenCounted(contractId: string): boolean {
    return countedContractIds.has(contractId);
}

export function markContractCounted(contractId: string) {
    countedContractIds.add(contractId);
}
