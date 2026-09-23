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

// Parallel execution: when master's PROPOSAL is detected, start follower
// proposals IMMEDIATELY. When master BUYs, followers buy too.
// This eliminates the delay — followers run at the same time as master.
interface FollowerProposalState {
    ws: WebSocket;
    proposalId: string;
    askPrice: string;
    accountId: string;
    name: string;
    fid: string;
    stake: number;
    contractParams: Record<string, unknown>;
}
let pendingFollowers: Map<string, FollowerProposalState> = new Map();
let activeBuy = false;

export function refreshCachedFollowers(f: Record<string, any>) {
    cachedFollowers = f;
}

function buildContractParams(raw: Record<string, any>, stake: number): Record<string, unknown> {
    const p = (raw.parameters && typeof raw.parameters === 'object') ? { ...raw, ...raw.parameters } : raw;
    const params: Record<string, unknown> = {
        amount: Number(p.amount) || stake,
        basis: p.basis || 'stake',
        contract_type: p.contract_type || 'CALL',
        currency: p.currency || 'USD',
        duration: p.duration || 1,
        duration_unit: p.duration_unit || 't',
        underlying_symbol: p.underlying_symbol || p.symbol || '1HZ100V',
    };
    if (p.barrier != null) params.barrier = p.barrier;
    if (p.barrier2 != null) params.barrier2 = p.barrier2;
    return params;
}

// Open WS → auth → send proposal for ONE follower
function openFollowerForTrade(
    fid: string,
    follower: any,
    contractParams: Record<string, unknown>,
    stake: number
) {
    const tag = fid.slice(-4);
    try {
        const ws = new WebSocket(WS_URL);
        const state: Partial<FollowerProposalState> = { ws, accountId: follower.account_id, name: follower.name, fid, stake, contractParams };

        ws.onopen = () => {
            ws.send(JSON.stringify({ authorize: follower.token }));
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.error) {
                    console.error(`[CopyTrade] ...${tag} error during proposal:`, data.error.message);
                    try { ws.close(); } catch {}
                    return;
                }
                // Authorized → send proposal
                if (data.authorize) {
                    console.log(`[CopyTrade] ...${tag} (${follower.name}) authorized, sending proposal: ${contractParams.contract_type}...`);
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
                // Proposal ready → store for instant buy when master buys
                if (data.req_id === 1 && data.proposal) {
                    console.log(`[CopyTrade] ...${tag} proposal ready: ${data.proposal.id}, waiting for master to buy...`);
                    state.proposalId = data.proposal.id;
                    state.askPrice = data.proposal.ask_price;
                    pendingFollowers.set(fid, state as FollowerProposalState);
                    return;
                }
                // Buy success
                if (data.req_id === 2 && data.buy) {
                    console.log(`[CopyTrade] ...${tag} BUY SUCCESS:`, data.buy.contract_id);
                    // Update trade record
                    pushFollowerTrade(masterId!, fid, {
                        id: data.buy.contract_id,
                        type: String(contractParams.contract_type),
                        stake,
                        pnl: 0,
                        time: Date.now(),
                        status: 'pending',
                    });
                    if (data.buy.balance != null) {
                        dbSet(`masters/${masterId}/followers/${fid}/balance`, Number(data.buy.balance));
                    } else {
                        queryAndSaveFollowerBalance(masterId!, fid, follower.token, follower.account_id);
                    }
                    try { ws.close(); } catch {}
                }
            } catch {}
        };

        ws.onerror = () => { try { ws.close(); } catch {} };
        ws.onclose = () => { pendingFollowers.delete(fid); };
    } catch {}
}

// Send buy to ALL followers that have proposals ready
function buyOnAllReadyFollowers() {
    if (pendingFollowers.size === 0) {
        console.log('[CopyTrade] No follower proposals ready to buy');
        return;
    }
    console.log(`[CopyTrade] Buying on ${pendingFollowers.size} followers simultaneously...`);
    for (const [fid, state] of pendingFollowers) {
        try {
            console.log(`[CopyTrade] ...${fid.slice(-4)} (${state.name}) buying with proposal ${state.proposalId}...`);
            state.ws.send(JSON.stringify({
                buy: state.proposalId,
                price: state.askPrice,
                req_id: 2,
            }));
        } catch (err) {
            console.error(`[CopyTrade] ...${fid.slice(-4)} buy failed:`, err);
        }
    }
    pendingFollowers.clear();
}

export function installCopyTradeInterceptor(mId: string) {
    if (interceptorInstalled) return;
    interceptorInstalled = true;
    masterId = mId;
    countedContractIds = new Set();
    cachedFollowers = {};
    lastProposalParams = null;
    pendingFollowers.clear();
    activeBuy = false;
    console.log('[CopyTrade] Interceptor installed for master:', mId);

    // Pre-cache followers from Firebase
    getFollowers(mId).then(f => { if (f) cachedFollowers = f; }).catch(() => {});

    const unsub1 = onNewSystemMessageLocal((data: any) => {
        // ── PROPOSAL detected: start follower proposals IMMEDIATELY ──
        if (data.msg_type === 'proposal' && data.proposal && data.proposal.id) {
            const req = data.echo_req || data.proposal;
            const flat = (req.parameters && typeof req.parameters === 'object')
                ? { ...req, ...req.parameters }
                : req;
            if (flat.contract_type && flat.amount != null && flat.basis) {
                lastProposalParams = { ...flat };
                delete lastProposalParams.req_id;
                delete lastProposalParams.passthrough;
                const stake = Number(flat.amount) || 1;
                const contractParams = buildContractParams(flat, stake);

                console.log('[CopyTrade] TRADE proposal detected:', flat.contract_type,
                    '| barrier:', flat.barrier ?? 'none',
                    '| Starting follower proposals NOW...');

                // Start ALL follower proposals in parallel — don't wait for master to buy
                const entries = Object.entries(cachedFollowers).filter(([, f]) => f.token);
                activeBuy = true;
                for (const [fid, follower] of entries) {
                    openFollowerForTrade(fid, follower, contractParams, stake);
                }
            }
            return;
        }

        // ── BUY detected: buy on all followers that have proposals ready ──
        if (data.msg_type === 'buy' && data.buy && data.buy.contract_id) {
            const cid = String(data.buy.contract_id);
            if (countedContractIds.has(cid)) {
                console.log('[CopyTrade] Duplicate buy detected, skipping:', cid);
                return;
            }
            countedContractIds.add(cid);
            if (countedContractIds.size > 500) {
                const arr = Array.from(countedContractIds);
                countedContractIds = new Set(arr.slice(-200));
            }
            console.log('[CopyTrade] Master BUY detected:', cid, '| Buying on', pendingFollowers.size, 'ready followers...');
            buyOnAllReadyFollowers();
            activeBuy = false;
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
    for (const [, state] of pendingFollowers) {
        try { state.ws.close(); } catch {}
    }
    pendingFollowers.clear();
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
