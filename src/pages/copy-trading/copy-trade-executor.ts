// Direct multi-account copy execution for the Copy Trading tab.
// Tokens stay in this browser's localStorage and are never sent to Firebase.

import { DerivWSAccountsService, type DerivAccount } from '@/services/derivws-accounts.service';

const APP_ID = '33UD5Xga7WHSzXFtBYdmr';
// Personal API tokens use Deriv's public WebSocket API. The /trading/v1
// endpoint is for the newer OAuth/OTP flow and does not accept a normal
// authorize message containing an API token.
const STORAGE_KEY = 'mw_copy_api_accounts';

type AccountStatus = 'connecting' | 'connected' | 'error';

export interface CopyAccount {
    id: string;
    loginid: string;
    name: string;
    balance: number | null;
    currency: string;
    isDemo: boolean;
    availableAccounts: Array<{
        loginid: string;
        accountType: 'demo' | 'real';
        currency: string;
    }>;
    status: AccountStatus;
    tokenHint: string;
    error?: string;
}

interface StoredAccount {
    id: string;
    token: string;
    loginid?: string;
    name?: string;
    balance?: number | null;
    currency?: string;
    isDemo?: boolean;
}

interface PendingRequest {
    resolve: (data: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

interface AccountSession extends StoredAccount {
    ws: WebSocket | null;
    status: AccountStatus;
    error?: string;
    pending: Map<number, PendingRequest>;
    nextReqId: number;
    availableAccounts?: DerivAccount[];
    connectionId: number;
}

async function resolveTokenAccount(token: string, previousLoginId?: string): Promise<{ account: DerivAccount; accounts: DerivAccount[]; websocketUrl: string }> {
    const accounts = await DerivWSAccountsService.fetchAccountsList(token, false);
    const account =
        (previousLoginId && accounts.find(item => item.account_id === previousLoginId)) ||
        accounts.find(item => item.account_type === 'demo') ||
        accounts[0];
    if (!account) throw new Error('No Deriv account is available for this token.');
    const websocketUrl = await DerivWSAccountsService.fetchOTPWebSocketURL(token, account.account_id);
    return { account, accounts, websocketUrl };
}

const sessions = new Map<string, AccountSession>();
const managedSockets = new WeakSet<WebSocket>();
const listeners = new Set<(accounts: CopyAccount[]) => void>();
let initialized = false;
let interceptorInstalled = false;
let origProtoSend: ((data: string | ArrayBuffer | Blob) => void) | null = null;
let proposalParams: Record<string, unknown> | null = null;
const proposalParamsById = new Map<string, Record<string, unknown>>();
let messageUnsub: (() => void) | null = null;

function readStored(): StoredAccount[] {
    try {
        const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        return Array.isArray(value) ? value.filter(a => a && a.id && a.token) : [];
    } catch { return []; }
}

function persist() {
    try {
        const records = Array.from(sessions.values()).map(({ ws, pending, nextReqId, status, error, availableAccounts, connectionId, ...record }) => record);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch {}
}

function accountView(session: AccountSession): CopyAccount {
    return {
        id: session.id,
        loginid: session.loginid || 'Authorizing…',
        name: session.name || 'Authorizing account…',
        balance: session.balance ?? null,
        currency: session.currency || 'USD',
        isDemo: !!session.isDemo,
        availableAccounts: (session.availableAccounts || []).map(account => ({
            loginid: account.account_id,
            accountType: account.account_type,
            currency: account.currency,
        })),
        status: session.status,
        tokenHint: `••••${session.token.slice(-4)}`,
        error: session.error,
    };
}

function notify() {
    const value = Array.from(sessions.values()).map(accountView);
    listeners.forEach(listener => listener(value));
}

function parseName(authorize: any): string {
    return authorize?.fullname || [authorize?.first_name, authorize?.last_name].filter(Boolean).join(' ') || authorize?.loginid || 'Deriv account';
}

function failPending(session: AccountSession, error: Error) {
    session.pending.forEach(request => {
        clearTimeout(request.timer);
        request.reject(error);
    });
    session.pending.clear();
}

function request(session: AccountSession, message: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
        if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
            reject(new Error('Account connection is not ready'));
            return;
        }
        const reqId = ++session.nextReqId;
        const timer = setTimeout(() => {
            session.pending.delete(reqId);
            reject(new Error('Account request timed out'));
        }, 30000);
        session.pending.set(reqId, { resolve, reject, timer });
        session.ws.send(JSON.stringify({ ...message, req_id: reqId }));
    });
}

function handleSessionMessage(session: AccountSession, data: any) {
    if (data.error) {
        const error = new Error(data.error.message || data.error.code || 'Deriv account request failed');
        console.warn('[CopyTrading] Deriv response error for', session.loginid, data.error, data.echo_req || '');
        if (session.status !== 'connected') {
            session.status = 'error';
            session.error = error.message;
            notify();
        }
        if (data.req_id && session.pending.has(data.req_id)) {
            const pending = session.pending.get(data.req_id)!;
            clearTimeout(pending.timer);
            session.pending.delete(data.req_id);
            pending.reject(error);
        }
        return;
    }
    if (data.authorize) {
        const auth = data.authorize;
        session.loginid = String(auth.loginid || session.loginid || '');
        session.name = parseName(auth);
        session.currency = String(auth.currency || 'USD');
        session.isDemo = auth.is_virtual != null
            ? Boolean(auth.is_virtual)
            : Boolean(session.isDemo || String(auth.loginid || session.loginid).startsWith('VRTC'));
        session.balance = auth.balance != null ? Number(auth.balance) : session.balance ?? null;
        session.status = 'connected';
        session.error = undefined;
        persist();
        notify();
        return;
    }
    if (data.balance) {
        const balance = Number(data.balance.balance);
        if (Number.isFinite(balance)) session.balance = balance;
        session.currency = String(data.balance.currency || session.currency || 'USD');
        persist();
        notify();
    }
    if (data.req_id && session.pending.has(data.req_id)) {
        const pending = session.pending.get(data.req_id)!;
        clearTimeout(pending.timer);
        session.pending.delete(data.req_id);
        pending.resolve(data);
    }
}

function connect(session: AccountSession): Promise<CopyAccount> {
    return new Promise(async (resolve, reject) => {
        const connectionId = ++session.connectionId;
        let settled = false;
        let account: DerivAccount;
        let accounts: DerivAccount[];
        let websocketUrl: string;
        try {
            ({ account, accounts, websocketUrl } = await resolveTokenAccount(session.token, session.loginid));
            if (connectionId !== session.connectionId) {
                reject(new Error('Account connection was replaced.'));
                return;
            }
            session.availableAccounts = accounts;
            session.loginid = account.account_id;
            session.currency = account.currency || 'USD';
            const balance = Number(account.balance);
            session.balance = Number.isFinite(balance) ? balance : null;
            session.isDemo = account.account_type === 'demo';
        } catch (error: any) {
            if (connectionId !== session.connectionId) {
                reject(new Error('Account connection was replaced.'));
                return;
            }
            session.status = 'error';
            session.error = error?.message || 'Unable to validate API token';
            notify();
            reject(new Error(session.error));
            return;
        }
        try {
            const ws = new WebSocket(websocketUrl);
            session.ws = ws;
            managedSockets.add(ws);
        }
        catch (error: any) {
            session.status = 'error';
            session.error = error?.message || 'Unable to open account connection';
            notify();
            reject(error);
            return;
        }
        session.status = 'connecting';
        session.error = undefined;
        notify();
        const timeout = setTimeout(() => {
            if (!settled && connectionId === session.connectionId) {
                settled = true;
                session.status = 'error';
                session.error = 'Authorization timed out';
                try { session.ws?.close(); } catch {}
                notify();
                reject(new Error(session.error));
            }
        }, 30000);
        const ws = session.ws!;
        ws.onopen = () => {
            if (connectionId !== session.connectionId || session.ws !== ws) return;
            // The OTP in websocketUrl already authenticates this socket.
            session.status = 'connected';
            session.name = session.name || 'Deriv account';
            session.error = undefined;
            persist();
            notify();
            request(session, { balance: 1, subscribe: 1 }).catch(error => {
                console.warn('[CopyTrading] Balance subscription failed for', session.loginid, error);
            });
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                resolve(accountView(session));
            }
        };
        ws.onmessage = event => {
            if (connectionId !== session.connectionId || session.ws !== ws) return;
            try {
                const data = JSON.parse(event.data);
                const wasAuthorized = session.status === 'connected';
                handleSessionMessage(session, data);
                if (!settled && session.status === 'error') {
                    settled = true;
                    clearTimeout(timeout);
                    reject(new Error(session.error || 'Deriv account request failed'));
                } else if (!settled && !wasAuthorized && session.status === 'connected') {
                    settled = true;
                    clearTimeout(timeout);
                    persist();
                    resolve(accountView(session));
                }
            } catch (error: any) {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                    session.status = 'error';
                    session.error = error?.message || 'Invalid response from Deriv';
                    notify();
                    reject(new Error(session.error));
                }
            }
        };
        ws.onerror = () => {
            if (connectionId !== session.connectionId || session.ws !== ws) return;
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                session.status = 'error';
                session.error = 'Account connection failed';
                notify();
                reject(new Error(session.error));
            }
        };
        ws.onclose = () => {
            if (connectionId !== session.connectionId || session.ws !== ws) return;
            failPending(session, new Error('Account connection closed'));
            if (session.status === 'connected') {
                session.status = 'error';
                session.error = 'Connection closed';
                notify();
            }
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                reject(new Error(session.error || 'Account connection closed'));
            }
        };
    });
}

function createSession(record: StoredAccount): AccountSession {
    return { ...record, ws: null, status: 'connecting', pending: new Map(), nextReqId: 0, connectionId: 0 };
}

export async function initializeCopyAccounts(): Promise<void> {
    if (!initialized) {
        initialized = true;
        readStored().forEach(record => {
            if (!sessions.has(record.id)) sessions.set(record.id, createSession(record));
        });
        notify();
        await Promise.allSettled(Array.from(sessions.values()).map(connect));
    }
    installCopyTradeInterceptor();
}

export function subscribeCopyAccounts(listener: (accounts: CopyAccount[]) => void): () => void {
    listeners.add(listener);
    listener(Array.from(sessions.values()).map(accountView));
    return () => listeners.delete(listener);
}

export async function addCopyToken(token: string): Promise<CopyAccount> {
    const cleanToken = token.trim();
    if (!cleanToken) throw new Error('Enter an API token first.');
    if (Array.from(sessions.values()).some(account => account.token === cleanToken)) {
        throw new Error('This API token is already connected.');
    }
    const id = `copy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const session = createSession({ id, token: cleanToken });
    sessions.set(id, session);
    notify();
    try {
        const account = await connect(session);
        persist();
        return account;
    } catch (error) {
        sessions.delete(id);
        notify();
        throw error;
    }
}

export function removeCopyToken(id: string) {
    const session = sessions.get(id);
    if (!session) return;
    session.connectionId += 1;
    failPending(session, new Error('Account removed'));
    const ws = session.ws;
    session.ws = null;
    if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try { ws.close(); } catch {}
    }
    sessions.delete(id);
    persist();
    notify();
}

export async function switchCopyAccount(id: string, loginid: string): Promise<CopyAccount> {
    const session = sessions.get(id);
    if (!session) throw new Error('Connected account was not found.');
    const selected = session.availableAccounts?.find(account => account.account_id === loginid);
    if (!selected) throw new Error('That account is not available for this API token.');
    if (session.loginid === selected.account_id && session.status === 'connected') return accountView(session);

    session.connectionId += 1;
    failPending(session, new Error('Switching the selected account.'));
    const previousWs = session.ws;
    session.ws = null;
    if (previousWs) {
        previousWs.onopen = null;
        previousWs.onmessage = null;
        previousWs.onerror = null;
        previousWs.onclose = null;
        try { previousWs.close(); } catch {}
    }

    session.loginid = selected.account_id;
    session.currency = selected.currency || 'USD';
    const balance = Number(selected.balance);
    session.balance = Number.isFinite(balance) ? balance : null;
    session.isDemo = selected.account_type === 'demo';
    session.status = 'connecting';
    session.error = undefined;
    persist();
    notify();

    try {
        return await connect(session);
    } catch (error: any) {
        session.status = 'error';
        session.error = error?.message || 'Could not switch the target account.';
        notify();
        throw error;
    }
}

function convertProposalParams(message: any): Record<string, unknown> | null {
    const p = message?.parameters && typeof message.parameters === 'object' ? { ...message, ...message.parameters } : message;
    if (!p?.contract_type || p.amount == null || !p.basis) return null;
    const params: Record<string, unknown> = {
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

async function executeOnAccount(session: AccountSession, params: Record<string, unknown>, stake: number) {
    if (session.status !== 'connected' || !session.ws || session.ws.readyState !== WebSocket.OPEN) {
        throw new Error('Target account connection is not ready.');
    }
    // Use Deriv's direct-buy form. A proposal round-trip per account adds
    // visible latency and makes the copied contracts enter at different ticks.
    const buy = await request(session, {
        buy: '1',
        price: stake,
        parameters: { ...params, currency: session.currency || params.currency, amount: stake, basis: 'stake' },
    });
    if (!buy?.buy) throw new Error(buy?.error?.message || 'Buy was rejected');
    // Keep the single balance stream established at connect; request a one-shot
    // snapshot after each purchase instead of creating duplicate subscriptions.
    try {
        await request(session, { balance: 1 });
    } catch (error) {
        console.warn('[CopyTrading] Buy succeeded but balance refresh failed for', session.loginid, error);
    }
    return String(buy.buy.contract_id || '');
}
function copyCurrentTrade(stake: number, sourceParams?: Record<string, unknown> | null) {
    const params = sourceParams ? { ...sourceParams } : proposalParams ? { ...proposalParams } : null;
    if (!params || !Number.isFinite(stake) || stake <= 0) return;
    const activeLoginId = (() => { try { return localStorage.getItem('active_loginid') || ''; } catch { return ''; } })();
    const targets = Array.from(sessions.values()).filter(session => session.status === 'connected' && session.loginid !== activeLoginId);
    if (!targets.length) {
        console.info('[CopyTrading] No eligible follower accounts; connected targets may match the active source account.');
        return;
    }
    Promise.allSettled(targets.map(async session => {
        try {
            const contractId = await executeOnAccount(session, params, stake);
            session.error = undefined;
            notify();
            console.info('[CopyTrading] Trade copied to', session.loginid, contractId ? `contract ${contractId}` : '');
        } catch (error) {
            console.error('[CopyTrading] Trade copy failed for', session.loginid, error);
            session.error = error instanceof Error ? error.message : 'Trade copy failed';
            notify();
        }
    }));
}

export function installCopyTradeInterceptor() {
    if (interceptorInstalled) return;
    interceptorInstalled = true;
    try {
        const Proto = (WebSocket as any).prototype;
        origProtoSend = Proto.send;
        Proto.send = function (data: string | ArrayBuffer | Blob) {
            try {
                if (typeof data === 'string' && !managedSockets.has(this as WebSocket)) {
                    const message = JSON.parse(data);
                    if (message.proposal === 1) {
                        const params = convertProposalParams(message);
                        if (params) proposalParams = params;
                    }
                    if (message.buy !== undefined && message.buy !== null) {
                        const params = proposalParamsById.get(String(message.buy)) || convertProposalParams(message) || proposalParams;
                        const stake = Number(message.parameters?.amount ?? message.price ?? params?.amount);
                        if (params) copyCurrentTrade(stake, params);
                    }
                }
            } catch {}
            return origProtoSend!.call(this, data);
        };
    } catch {}
    if (typeof window !== 'undefined') {
        const handler = (event: Event) => {
            try {
                const raw = (event as CustomEvent).detail;
                const data = typeof raw?.data === 'string' ? JSON.parse(raw.data) : raw;
                const proposalId = data?.proposal?.id;
                const params = proposalId && convertProposalParams(data?.echo_req);
                if (proposalId && params) proposalParamsById.set(String(proposalId), params);
            } catch {}
        };
        window.addEventListener('newSystemMessage', handler);
        messageUnsub = () => window.removeEventListener('newSystemMessage', handler);
    }
}

export function uninstallCopyTradeInterceptor() {
    messageUnsub?.();
    messageUnsub = null;
    interceptorInstalled = false;
    proposalParams = null;
    proposalParamsById.clear();
    try { if (origProtoSend) (WebSocket as any).prototype.send = origProtoSend; } catch {}
    origProtoSend = null;
}
