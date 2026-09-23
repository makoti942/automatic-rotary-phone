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

export function refreshCachedFollowers(f: Record<string, any>) {
    cachedFollowers = f;
}

export function installCopyTradeInterceptor(mId: string) {
    if (interceptorInstalled) return;
    interceptorInstalled = true;
    masterId = mId;
    countedContractIds = new Set();
    cachedFollowers = {};
    lastProposalParams = null;
    console.log('[CopyTrade] Interceptor installed for master:', mId);

    // Pre-cache followers from Firebase
    getFollowers(mId).then(f => { if (f) cachedFollowers = f; }).catch(() => {});

    // Intercept ALL incoming WS messages to capture proposal params
    const unsub1 = onNewSystemMessageLocal((data: any) => {
        // Capture proposal responses — echo_req has the EXACT contract_type, barrier, etc.
        // Only capture TRADE proposals (have amount + basis + contract_type), not tick/indicator requests
        if (data.msg_type === 'proposal' && data.proposal && data.proposal.id) {
            const req = data.echo_req || data.proposal;
            const flat = (req.parameters && typeof req.parameters === 'object')
                ? { ...req, ...req.parameters }
                : req;
            // Must have ALL trade fields — skip tick subscriptions, indicator requests, etc.
            if (flat.contract_type && flat.amount != null && flat.basis) {
                lastProposalParams = { ...flat };
                delete lastProposalParams.req_id;
                delete lastProposalParams.passthrough;
                console.log('[CopyTrade] Captured TRADE proposal:', flat.contract_type,
                    '| barrier:', flat.barrier ?? 'none',
                    '| id:', data.proposal.id);
            }
        }
        // Detect buy — guard against duplicate contract_ids
        if (data.msg_type === 'buy' && data.buy && data.buy.contract_id) {
            const cid = String(data.buy.contract_id);
            if (countedContractIds.has(cid)) {
                console.log('[CopyTrade] Duplicate buy detected, skipping:', cid);
                return;
            }
            countedContractIds.add(cid);
            // Keep set size manageable
            if (countedContractIds.size > 500) {
                const arr = Array.from(countedContractIds);
                countedContractIds = new Set(arr.slice(-200));
            }
            console.log('[CopyTrade] Master trade detected:', cid,
                '| contract_type:', lastProposalParams?.contract_type || 'NONE');
            forwardTradeToFollowers(data.buy);
        }
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
}

// ══════════════════════════════════════════════════════════════
// Forward trade to followers
// Extract contract params from the buy response itself (don't
// query proposal_open_contract — it fails for sold contracts)
// ══════════════════════════════════════════════════════════════

async function forwardTradeToFollowers(buyData: any) {
    if (!masterId) return;

    // Use cached followers (instant) — refresh in background
    let followers = cachedFollowers;
    getFollowers(masterId).then(f => { if (f) cachedFollowers = f; }).catch(() => {});

    if (!followers || Object.keys(followers).length === 0) {
        console.log('[CopyTrade] No followers found');
        return;
    }

    const entries = Object.entries(followers).filter(([, f]) => f.token);
    if (entries.length === 0) {
        console.log('[CopyTrade] No followers with tokens');
        return;
    }

    console.log(`[CopyTrade] Forwarding to ${entries.length} followers`);

    // Use the CAPTURED proposal params — these are the EXACT params the bot used
    // (DIGITUNDER, barrier, duration, underlying, etc.)
    let contractParams: Record<string, unknown>;
    let stake = Number(buyData.buy_price) || 1;

    if (lastProposalParams) {
        // Flatten: params may be top-level or inside "parameters" object
        const raw = lastProposalParams;
        const p = (raw.parameters && typeof raw.parameters === 'object') ? { ...raw, ...raw.parameters } : raw;
        contractParams = {
            amount: Number(p.amount) || stake,
            basis: p.basis || 'stake',
            contract_type: p.contract_type || 'CALL',
            currency: p.currency || 'USD',
            duration: p.duration || 1,
            duration_unit: p.duration_unit || 't',
            underlying_symbol: p.underlying_symbol || p.symbol || '1HZ100V',
        };
        if (p.barrier != null) contractParams.barrier = p.barrier;
        if (p.barrier2 != null) contractParams.barrier2 = p.barrier2;
        console.log('[CopyTrade] Contract params (from captured proposal):', JSON.stringify(contractParams));
    } else {
        // Fallback: try POC, then buy data
        console.log('[CopyTrade] No captured proposal, trying fallback');
        try {
            const pocResult = await sendViaNewSystemLocal({
                proposal_open_contract: 1,
                contract_id: buyData.contract_id,
                subscribe: 0,
            });
            const contract = (pocResult as any)?.proposal_open_contract;
            if (contract) {
                contractParams = {
                    amount: stake,
                    basis: 'stake',
                    contract_type: contract.contract_type || buyData.contract_type || 'CALL',
                    currency: contract.currency || 'USD',
                    duration: contract.duration || 1,
                    duration_unit: contract.duration_unit || 't',
                    underlying_symbol: contract.underlying || buyData.underlying || '1HZ100V',
                };
                if (contract.barrier) contractParams.barrier = contract.barrier;
            } else {
                contractParams = {
                    amount: stake, basis: 'stake',
                    contract_type: buyData.contract_type || 'CALL',
                    currency: buyData.currency || 'USD',
                    duration: buyData.duration || 1,
                    duration_unit: buyData.duration_unit || 't',
                    underlying_symbol: buyData.underlying || '1HZ100V',
                };
                if (buyData.barrier) contractParams.barrier = buyData.barrier;
            }
        } catch {
            contractParams = {
                amount: stake, basis: 'stake',
                contract_type: buyData.contract_type || 'CALL',
                currency: buyData.currency || 'USD',
                duration: buyData.duration || 1,
                duration_unit: buyData.duration_unit || 't',
                underlying_symbol: buyData.underlying || '1HZ100V',
            };
            if (buyData.barrier) contractParams.barrier = buyData.barrier;
        }
        console.log('[CopyTrade] Contract params (fallback):', JSON.stringify(contractParams));
    }

    // OTP per-follower — one contract per follower, sequential
    await executeOnFollowers(entries, contractParams, stake, masterId);
}

async function executeOnFollowers(
    entries: [string, any][],
    contractParams: Record<string, unknown>,
    stake: number,
    mId: string
) {
    const tradeTime = Date.now();
    const tradeType = String(contractParams.contract_type || 'UNKNOWN');

    // Push pending trades IMMEDIATELY for all followers (instant appearance)
    for (const [fid] of entries) {
        pushFollowerTrade(mId, fid, {
            id: `${tradeTime}_${fid}`,
            type: tradeType,
            stake,
            pnl: 0,
            time: tradeTime,
            status: 'pending',
        });
    }

    // Execute ALL followers in PARALLEL for speed
    await Promise.all(entries.map(async ([fid, follower]) => {
        try {
            const accountId = follower.account_id;
            if (!accountId) {
                console.error(`[CopyTrade] Skipping ${fid} — no account_id`);
                return;
            }
            const buyResult = await buyOnFollowerAccount(follower.token, accountId, contractParams, stake);
            console.log(`[CopyTrade] SUCCESS for ${fid} (${follower.name}):`, buyResult.contract_id);

            // Update trade with real contract_id
            pushFollowerTrade(mId, fid, {
                id: buyResult.contract_id,
                type: tradeType,
                stake,
                pnl: 0,
                time: tradeTime,
                status: 'pending',
            });

            // Get balance from buy response OR query via OTP
            if (buyResult.balance != null) {
                dbSet(`masters/${mId}/followers/${fid}/balance`, Number(buyResult.balance));
            } else {
                // Fallback: query balance via OTP (fire-and-forget)
                queryAndSaveFollowerBalance(mId, fid, follower.token, accountId);
            }

            updateFollowerStats(mId, fid, contractParams, stake);
        } catch (err: any) {
            console.error(`[CopyTrade] FAILED for ${fid} (${follower.name}):`, err.message || err);
        }
    }));
}

async function queryAndSaveFollowerBalance(
    mId: string, fid: string, token: string, accountId: string
) {
    try {
        const ws = new WebSocket(WS_URL);
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('bal timeout')); }, 10000);
            ws.onopen = () => {
                ws.send(JSON.stringify({ authorize: token }));
            };
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.authorize) {
                        ws.send(JSON.stringify({ balance: 1, subscribe: 0, req_id: 99 }));
                    }
                    if (data.req_id === 99 && data.balance) {
                        const bal = Number(data.balance.balance);
                        console.log(`[CopyTrade] ...${fid.slice(-4)} balance: ${bal}`);
                        dbSet(`masters/${mId}/followers/${fid}/balance`, bal);
                        clearTimeout(timeout);
                        ws.close();
                        resolve();
                    }
                    if (data.error) {
                        clearTimeout(timeout);
                        ws.close();
                        reject(new Error(data.error.message));
                    }
                } catch {}
            };
            ws.onerror = () => { clearTimeout(timeout); reject(new Error('bal ws error')); };
        });
    } catch {}
}

async function updateFollowerStats(
    mId: string,
    followerId: string,
    contractParams: Record<string, unknown>,
    stake: number
) {
    try {
        const existing = await getFollowerStats(mId, followerId);
        const stats: import('./firebase-config').FollowerStats = existing || {
            totalTrades: 0, wins: 0, losses: 0, totalPnl: 0, contracts: [],
        };
        stats.totalTrades += 1;
        stats.contracts.unshift({
            id: `${Date.now()}`,
            type: String(contractParams.contract_type || 'UNKNOWN'),
            stake,
            pnl: 0,
            time: Date.now(),
        });
        stats.contracts = stats.contracts.slice(0, 50);
        await setFollowerStats(mId, followerId, stats);
    } catch (err) {
        console.error('[CopyTrade] Failed to update follower stats:', err);
    }
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
