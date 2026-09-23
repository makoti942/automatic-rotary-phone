import {
    getFollowers,
    getFollowerStats,
    setFollowerStats,
    clearFollowerStats,
    type FollowerStats,
} from './firebase-config';

// ══════════════════════════════════════════════════════════════
// INLINED from @/auth/NewDerivAuth — NEVER import that module
// ══════════════════════════════════════════════════════════════

function convertToNewFormat(data: any): any {
    if (!data || typeof data !== 'object') return data;
    const out = Array.isArray(data) ? data.map(convertToNewFormat) : { ...data };
    if (out.proposal === 1 && out.symbol) {
        out.underlying_symbol = out.symbol;
        delete out.symbol;
    }
    if ('buy' in out) {
        out.buy = String(out.buy);
    }
    if (out.parameters && typeof out.parameters === 'object') {
        out.parameters = { ...out.parameters };
        if ('symbol' in out.parameters) {
            out.parameters.underlying_symbol = out.parameters.symbol;
            delete out.parameters.symbol;
        }
    }
    return out;
}

function parseEventDetail(detail: any): any {
    if (!detail) return null;
    if (typeof detail === 'string') {
        try { return JSON.parse(detail); } catch { return null; }
    }
    if (detail.data && typeof detail.data === 'string') {
        try { return JSON.parse(detail.data); } catch { return null; }
    }
    return detail;
}

function onNewSystemMessageLocal(cb: (data: any) => void): () => void {
    if (typeof window === 'undefined') return () => {};
    const handler = (event: Event) => {
        try {
            const parsed = parseEventDetail((event as CustomEvent).detail);
            if (parsed) cb(parsed);
        } catch (_) {}
    };
    window.addEventListener('newSystemMessage', handler);
    return () => window.removeEventListener('newSystemMessage', handler);
}

function sendViaNewSystemLocal(msg: any): Promise<any> {
    return new Promise((resolve, reject) => {
        const ws = (window as any)._newSystemWS;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            reject(new Error('WebSocket not open'));
            return;
        }
        const reqId = msg.req_id || Date.now();
        const toSend = { ...convertToNewFormat(msg), req_id: reqId };
        const msgType = Object.keys(msg).find(k => k !== 'passthrough' && k !== 'req_id');
        const handler = (event: Event) => {
            try {
                const parsed = parseEventDetail((event as CustomEvent).detail);
                if (!parsed) return;
                if (parsed.req_id === reqId || (msgType && parsed.msg_type === msgType)) {
                    window.removeEventListener('newSystemMessage', handler);
                    if (parsed.error) reject(parsed);
                    else resolve(parsed);
                }
            } catch (_) {}
        };
        window.addEventListener('newSystemMessage', handler);
        ws.send(JSON.stringify(toSend));
        setTimeout(() => {
            window.removeEventListener('newSystemMessage', handler);
            reject(new Error('Timeout'));
        }, 30000);
    });
}

// ══════════════════════════════════════════════════════════════
// Per-follower WebSocket execution
// Each follower gets their own WS connection with their token
// ══════════════════════════════════════════════════════════════

const APP_ID = '33UD5Xga7WHSzXFtBYdmr';
const WS_BASE = 'wss://ws.derivws.com/websockets/v3';

async function buyOnFollowerAccount(
    followerToken: string,
    contractParams: Record<string, unknown>,
    stake: number
): Promise<any> {
    return new Promise((resolve, reject) => {
        const wsUrl = `${WS_BASE}?app_id=${APP_ID}&token=${followerToken}`;
        console.log(`[CopyTrade] Opening follower WS for token ending ...${followerToken.slice(-4)}`);
        const ws = new WebSocket(wsUrl);
        let authorized = false;
        let tradeComplete = false;

        const cleanup = () => {
            try { ws.close(); } catch {}
        };

        const timeout = setTimeout(() => {
            cleanup();
            if (!tradeComplete) reject(new Error('Follower buy timeout'));
        }, 30000);

        ws.onopen = () => {
            console.log(`[CopyTrade] Follower WS open, getting proposal...`);
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
            try {
                const data = JSON.parse(event.data);

                // Handle proposal response
                if (data.req_id === 1 && data.proposal) {
                    console.log(`[CopyTrade] Got proposal: ${data.proposal.id}, buying...`);
                    ws.send(JSON.stringify({
                        buy: data.proposal.id,
                        price: data.proposal.ask_price,
                        req_id: 2,
                    }));
                }

                // Handle buy response
                if (data.req_id === 2) {
                    if (data.error) {
                        console.error(`[CopyTrade] Follower buy error:`, data.error.message);
                        tradeComplete = true;
                        clearTimeout(timeout);
                        cleanup();
                        reject(new Error(data.error.message));
                    } else if (data.buy) {
                        console.log(`[CopyTrade] Follower buy success:`, data.buy.contract_id);
                        tradeComplete = true;
                        clearTimeout(timeout);
                        cleanup();
                        resolve(data.buy);
                    }
                }
            } catch {}
        };

        ws.onerror = (err) => {
            console.error(`[CopyTrade] Follower WS error:`, err);
            tradeComplete = true;
            clearTimeout(timeout);
            cleanup();
            reject(new Error('Follower WS error'));
        };

        ws.onclose = () => {
            if (!tradeComplete) {
                tradeComplete = true;
                clearTimeout(timeout);
                reject(new Error('Follower WS closed unexpectedly'));
            }
        };
    });
}

// ══════════════════════════════════════════════════════════════
// Global interceptor — listens for master's buy messages
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
// Forward trade to followers via per-follower WS
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

    // Get master contract details
    let contractParams: Record<string, unknown> = {};
    let stake = 1;
    try {
        const pocResult = await sendViaNewSystemLocal({
            proposal_open_contract: 1,
            contract_id: buyData.contract_id,
            subscribe: 0,
        });
        const contract = (pocResult as any)?.proposal_open_contract;
        if (!contract) {
            console.error('[CopyTrade] Could not get contract details for', buyData.contract_id);
            return;
        }
        stake = Number(buyData.buy_price) || Number(contract.buy_price) || 1;

        contractParams = {
            amount: stake,
            basis: 'stake',
            contract_type: contract.contract_type || 'DIGITUNDER',
            currency: contract.currency || 'USD',
            duration: contract.duration || 1,
            duration_unit: contract.duration_unit || 't',
            underlying_symbol: contract.underlying || '1HZ100V',
        };
        if (contract.barrier) {
            contractParams.barrier = contract.barrier;
        }
        console.log('[CopyTrade] Contract params:', JSON.stringify(contractParams));
    } catch (err) {
        console.error('[CopyTrade] Failed to get contract details:', err);
        return;
    }

    // Execute on each follower via separate WS
    for (const [fid, follower] of entries) {
        try {
            const buyResult = await buyOnFollowerAccount(follower.token, contractParams, stake);
            console.log(`[CopyTrade] SUCCESS for ${fid} (${follower.name}):`, buyResult.contract_id);
            await updateFollowerStats(masterId, fid, contractParams, stake);
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
        const stats: FollowerStats = existing || {
            totalTrades: 0,
            wins: 0,
            losses: 0,
            totalPnl: 0,
            contracts: [],
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
// Public helpers used by copy-trading.tsx
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

export function hasContractBeenCounted(contractId: string): boolean {
    return countedContractIds.has(contractId);
}

export function markContractCounted(contractId: string) {
    countedContractIds.add(contractId);
}

export async function saveMyBalance(masterId: string, followerId: string, balance: number) {
    try {
        const { dbSet } = await import('./firebase-config');
        await dbSet(`masters/${masterId}/followers/${followerId}/balance`, balance);
    } catch {}
}
