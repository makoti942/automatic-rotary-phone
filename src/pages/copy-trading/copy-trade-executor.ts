import { getFollowers, getFollowerStats, setFollowerStats, clearFollowerStats, dbSet } from './firebase-config';

// ══════════════════════════════════════════════════════════════
// INLINED from @/auth/NewDerivAuth — NEVER import that module
// here or the TDZ crash returns.
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
// Legacy WebSocket for buy_contract_for_multiple_accounts
// (the new API WS doesn't support this call)
// ══════════════════════════════════════════════════════════════

const LEGACY_WS_URL = 'wss://ws.derivws.com/websockets/v3';
let legacyWs: WebSocket | null = null;
let legacyWsReady = false;
let legacyWsQueue: { msg: object; resolve: (v: any) => void; reject: (e: any) => void }[] = [];

function getMasterToken(): string | null {
    try {
        const activeLoginId = localStorage.getItem('active_loginid');
        if (!activeLoginId) return null;
        const clientAccounts = JSON.parse(localStorage.getItem('client.accounts') || '{}');
        if (clientAccounts[activeLoginId]?.token) return clientAccounts[activeLoginId].token;
        const accountsList = JSON.parse(localStorage.getItem('accountsList') || '{}');
        if (accountsList[activeLoginId]) return accountsList[activeLoginId];
        return null;
    } catch { return null; }
}

function getLegacyWs(): Promise<WebSocket> {
    if (legacyWs && legacyWs.readyState === WebSocket.OPEN) {
        return Promise.resolve(legacyWs);
    }
    if (legacyWs && legacyWs.readyState === WebSocket.CONNECTING) {
        return new Promise((resolve, reject) => {
            const check = setInterval(() => {
                if (legacyWs && legacyWs.readyState === WebSocket.OPEN) {
                    clearInterval(check);
                    resolve(legacyWs);
                }
            }, 100);
            setTimeout(() => { clearInterval(check); reject(new Error('Legacy WS connect timeout')); }, 10000);
        });
    }
    return new Promise((resolve, reject) => {
        const token = getMasterToken();
        if (!token) { reject(new Error('No master token')); return; }
        console.log('[CopyTrade] Opening legacy WS...');
        legacyWs = new WebSocket(LEGACY_WS_URL);
        legacyWs.onopen = () => {
            console.log('[CopyTrade] Legacy WS open, authorizing...');
            legacyWs!.send(JSON.stringify({ authorize: token, req_id: 99999 }));
        };
        legacyWs.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.req_id === 99999) {
                    if (data.error) {
                        console.error('[CopyTrade] Legacy WS auth failed:', data.error.message);
                        reject(new Error(data.error.message));
                        return;
                    }
                    console.log('[CopyTrade] Legacy WS authorized OK');
                    legacyWsReady = true;
                    resolve(legacyWs!);
                    while (legacyWsQueue.length > 0) {
                        const queued = legacyWsQueue.shift()!;
                        legacyWs!.send(JSON.stringify(queued.msg));
                        const handler = (e: MessageEvent) => {
                            try {
                                const d = JSON.parse(e.data);
                                if (d.req_id || d.msg_type === 'buy' || d.msg_type === 'error' || d.msg_type === 'buy_contract_for_multiple_accounts') {
                                    legacyWs!.removeEventListener('message', handler);
                                    if (d.error) queued.reject(d);
                                    else queued.resolve(d);
                                }
                            } catch {}
                        };
                        legacyWs!.addEventListener('message', handler);
                    }
                    return;
                }
            } catch {}
        };
        legacyWs.onerror = (err) => { console.error('[CopyTrade] Legacy WS error:', err); legacyWsReady = false; };
        legacyWs.onclose = () => {
            console.log('[CopyTrade] Legacy WS closed');
            legacyWsReady = false;
            legacyWs = null;
            legacyWsQueue.forEach(q => q.reject(new Error('Legacy WS closed')));
            legacyWsQueue = [];
        };
    });
}

async function sendLegacyWs(msg: object): Promise<any> {
    const ws = await getLegacyWs();
    return new Promise((resolve, reject) => {
        const id = Date.now();
        const wrapped = { ...msg as any, req_id: id };
        const handler = (event: MessageEvent) => {
            try {
                const d = JSON.parse(event.data);
                if (d.req_id === id) {
                    ws.removeEventListener('message', handler);
                    if (d.error) reject(d);
                    else resolve(d);
                }
            } catch {}
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify(wrapped));
        setTimeout(() => { ws.removeEventListener('message', handler); reject(new Error('Timeout')); }, 30000);
    });
}

// ══════════════════════════════════════════════════════════════
// Global interceptor — listens for master's buy messages
// and forwards to followers
// ══════════════════════════════════════════════════════════════

let interceptorInstalled = false;
let masterId: string | null = null;
let unsubs: (() => void)[] = [];

export function installCopyTradeInterceptor(mId: string) {
    if (interceptorInstalled) return;
    interceptorInstalled = true;
    masterId = mId;
    console.log('[CopyTrade] Interceptor installed for master:', mId);

    getLegacyWs().catch(err => {
        console.warn('[CopyTrade] Could not pre-connect legacy WS:', err.message);
    });

    const unsub1 = onNewSystemMessageLocal((data: any) => {
        if (data.msg_type === 'buy' && data.buy && data.buy.contract_id) {
            console.log('[CopyTrade] Master trade detected:', data.buy.contract_id, data.buy);
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
    if (legacyWs) {
        legacyWs.close();
        legacyWs = null;
    }
    legacyWsReady = false;
    legacyWsQueue = [];
}

// ══════════════════════════════════════════════════════════════
// Forward trade to followers
// ══════════════════════════════════════════════════════════════

async function forwardTradeToFollowers(buyData: any) {
    if (!masterId) return;

    const followers = await getFollowers(masterId);
    if (!followers || Object.keys(followers).length === 0) {
        console.log('[CopyTrade] No followers found');
        return;
    }

    const entries = Object.entries(followers);
    const validEntries = entries.filter(([, f]) => f.token);
    if (validEntries.length === 0) {
        console.log('[CopyTrade] No followers with tokens');
        return;
    }

    console.log(`[CopyTrade] Forwarding to ${validEntries.length} followers`);

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
        console.log('[CopyTrade] Contract params:', contractParams);
    } catch (err) {
        console.error('[CopyTrade] Failed to get contract details:', err);
        return;
    }

    // Execute on each follower individually via legacy WS
    for (const [fid, follower] of validEntries) {
        try {
            const propResult = await sendLegacyWs({
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
            });
            const proposal = (propResult as any)?.proposal;
            if (proposal) {
                const buyResult = await sendLegacyWs({
                    buy: proposal.id,
                    price: proposal.ask_price,
                });
                console.log(`[CopyTrade] Buy succeeded for ${fid}:`, buyResult);
                await updateFollowerStats(masterId!, fid, contractParams, stake);
            } else {
                console.error(`[CopyTrade] No proposal for ${fid}:`, propResult);
            }
        } catch (indErr) {
            console.error(`[CopyTrade] Buy failed for ${fid}:`, indErr);
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

export async function updateMyBalanceToFirebase(myId: string, balance: number) {
    try {
        await dbSet(`masters/${myId}/balance`, balance);
    } catch {}
}
