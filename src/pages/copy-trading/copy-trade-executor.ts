import { getFollowers, getFollowerStats, setFollowerStats, clearFollowerStats, dbSet } from './firebase-config';

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
// Per-follower WS via legacy endpoint with token in URL
// ══════════════════════════════════════════════════════════════

const APP_ID = '33UD5Xga7WHSzXFtBYdmr';
const WS_DEMO = 'wss://api.derivws.com/trading/v1/options/ws/demo';
const WS_REAL = 'wss://api.derivws.com/trading/v1/options/ws';

async function buyOnFollowerAccount(
    followerToken: string,
    contractParams: Record<string, unknown>,
    stake: number,
    isDemo: boolean
): Promise<any> {
    const tag = followerToken.slice(-4);
    const wsBase = isDemo ? WS_DEMO : WS_REAL;
    const wsUrl = `${wsBase}?app_id=${APP_ID}&token=${followerToken}`;
    console.log(`[CopyTrade] Opening follower WS ...${tag} (${isDemo ? 'DEMO' : 'REAL'})`);
    const ws = new WebSocket(wsUrl);

    return new Promise((resolve, reject) => {
        let done = false;
        const cleanup = () => { done = true; try { ws.close(); } catch {} };
        const timeout = setTimeout(() => { cleanup(); if (!done) reject(new Error('Follower buy timeout')); }, 30000);

        ws.onopen = () => {
            console.log(`[CopyTrade] ...${tag} WS open, getting proposal...`);
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
                subscribe: 0,
                req_id: 1,
            }));
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
                if (data.req_id === 1 && data.proposal) {
                    console.log(`[CopyTrade] ...${tag} proposal: ${data.proposal.id}, buying...`);
                    ws.send(JSON.stringify({ buy: data.proposal.id, price: data.proposal.ask_price, req_id: 2 }));
                }
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

export function installCopyTradeInterceptor(mId: string) {
    if (interceptorInstalled) return;
    interceptorInstalled = true;
    masterId = mId;
    countedContractIds = new Set();
    console.log('[CopyTrade] Interceptor installed for master:', mId);

    const unsub1 = onNewSystemMessageLocal((data: any) => {
        if (data.msg_type === 'buy' && data.buy && data.buy.contract_id) {
            console.log('[CopyTrade] Master trade detected:', data.buy.contract_id);
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
}

// ══════════════════════════════════════════════════════════════
// Forward trade to followers
// Extract contract params from the buy response itself (don't
// query proposal_open_contract — it fails for sold contracts)
// ══════════════════════════════════════════════════════════════

async function forwardTradeToFollowers(buyData: any) {
    if (!masterId) return;

    const followers = await getFollowers(masterId);
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

    // Extract contract params from buy data — the buy response has everything we need
    // buyData = { contract_id, buy_price, payout, contract_type, ... }
    // We also try to get more details via proposal_open_contract but handle failure gracefully
    let contractParams: Record<string, unknown>;
    let stake = Number(buyData.buy_price) || 1;

    // Try to get full details from proposal_open_contract
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
                underlying_symbol: contract.underlying || '1HZ100V',
            };
            if (contract.barrier) contractParams.barrier = contract.barrier;
            console.log('[CopyTrade] Contract params (from POC):', JSON.stringify(contractParams));
            await executeOnFollowers(entries, contractParams, stake, masterId);
            return;
        }
    } catch (err) {
        console.log('[CopyTrade] POC query failed, using buy data directly');
    }

    // Fallback: build params from buy data
    contractParams = {
        amount: stake,
        basis: 'stake',
        contract_type: buyData.contract_type || 'CALL',
        currency: buyData.currency || 'USD',
        duration: buyData.duration || 1,
        duration_unit: buyData.duration_unit || 't',
        underlying_symbol: buyData.underlying || '1HZ100V',
    };
    if (buyData.barrier) contractParams.barrier = buyData.barrier;
    console.log('[CopyTrade] Contract params (from buy):', JSON.stringify(contractParams));
    await executeOnFollowers(entries, contractParams, stake, masterId);
}

async function executeOnFollowers(
    entries: [string, any][],
    contractParams: Record<string, unknown>,
    stake: number,
    mId: string
) {
    for (const [fid, follower] of entries) {
        try {
            const isDemo = follower.is_demo !== false;
            const buyResult = await buyOnFollowerAccount(follower.token, contractParams, stake, isDemo);
            console.log(`[CopyTrade] SUCCESS for ${fid} (${follower.name}):`, buyResult.contract_id);
            await updateFollowerStats(mId, fid, contractParams, stake);
        } catch (err: any) {
            console.error(`[CopyTrade] FAILED for ${fid} (${follower.name}):`, err.message || err);
        }
    }
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

export function queryBalance(): Promise<number | null> {
    return sendViaNewSystemLocal({ balance: 1, subscribe: 0 })
        .then((res: any) => res?.balance ? Number(res.balance.balance) : null)
        .catch(() => null);
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
