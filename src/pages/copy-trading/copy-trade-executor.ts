// Direct multi-account copy execution for the Copy Trading tab.
// Tokens stay in this browser's localStorage and are never sent to Firebase.

const APP_ID = '33UD5Xga7WHSzXFtBYdmr';
const WS_URL = `wss://api.derivws.com/trading/v1/websockets/v3?app_id=${APP_ID}`;
const STORAGE_KEY = 'mw_copy_api_accounts';

type AccountStatus = 'connecting' | 'connected' | 'error';

export interface CopyAccount {
    id: string;
    loginid: string;
    name: string;
    balance: number | null;
    currency: string;
    isDemo: boolean;
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
}

const sessions = new Map<string, AccountSession>();
const managedSockets = new WeakSet<WebSocket>();
const listeners = new Set<(accounts: CopyAccount[]) => void>();
let initialized = false;
let interceptorInstalled = false;
let origProtoSend: ((data: string | ArrayBuffer | Blob) => void) | null = null;
let proposalParams: Record<string, unknown> | null = null;
let messageUnsub: (() => void) | null = null;

function readStored(): StoredAccount[] {
    try {
        const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        return Array.isArray(value) ? value.filter(a => a && a.id && a.token) : [];
    } catch { return []; }
}

function persist() {
    try {
        const records = Array.from(sessions.values()).map(({ ws, pending, nextReqId, status, error, ...record }) => record);
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
        const error = new Error(data.error.message || 'Deriv account request failed');
        if (!session.loginid) {
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
        session.loginid = String(auth.loginid || '');
        session.name = parseName(auth);
        session.currency = String(auth.currency || 'USD');
        session.isDemo = Boolean(auth.is_virtual || String(auth.loginid || '').startsWith('VRTC'));
        session.balance = auth.balance != null ? Number(auth.balance) : session.balance ?? null;
        session.status = 'connected';
        session.error = undefined;
        persist();
        notify();
        request(session, { balance: 1, subscribe: 1 }).catch(() => {});
        return;
    }
    if (data.balance) {
        session.balance = Number(data.balance.balance);
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
    return new Promise((resolve, reject) => {
        let settled = false;
        try {
            session.ws = new WebSocket(WS_URL);
            managedSockets.add(session.ws);
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
            if (!settled) {
                settled = true;
                session.status = 'error';
                session.error = 'Authorization timed out';
                try { session.ws?.close(); } catch {}
                notify();
                reject(new Error(session.error));
            }
        }, 30000);
        session.ws.onopen = () => session.ws?.send(JSON.stringify({ authorize: session.token }));
        session.ws.onmessage = event => {
            try {
                const data = JSON.parse(event.data);
                const wasAuthorized = session.status === 'connected';
                handleSessionMessage(session, data);
                if (!settled && !wasAuthorized && session.status === 'connected') {
                    settled = true;
                    clearTimeout(timeout);
                    persist();
                    resolve(accountView(session));
                }
            } catch {}
        };
        session.onerror = () => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                session.status = 'error';
                session.error = 'Account connection failed';
                notify();
                reject(new Error(session.error));
            }
        };
        session.onclose = () => {
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
    return { ...record, ws: null, status: 'connecting', pending: new Map(), nextReqId: 0 };
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
    failPending(session, new Error('Account removed'));
    try { session.ws?.close(); } catch {}
    sessions.delete(id);
    persist();
    notify();
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
    if (session.status !== 'connected' || !session.ws || session.ws.readyState !== WebSocket.OPEN) return;
    const proposal = await request(session, { proposal: 1, amount: stake, basis: 'stake', ...params });
    if (!proposal?.proposal?.id) throw new Error('No proposal returned');
    await request(session, { buy: proposal.proposal.id, price: proposal.proposal.ask_price });
}

function copyCurrentTrade(stake: number) {
    if (!proposalParams) return;
    const params = { ...proposalParams };
    const activeLoginId = (() => { try { return localStorage.getItem('active_loginid') || ''; } catch { return ''; } })();
    const targets = Array.from(sessions.values()).filter(session => session.status === 'connected' && session.loginid !== activeLoginId);
    if (!targets.length) return;
    Promise.allSettled(targets.map(session => executeOnAccount(session, params, stake)));
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
                if (data?.msg_type === 'buy' && data.buy?.contract_id) copyCurrentTrade(Number(data.buy.buy_price) || 1);
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
    try { if (origProtoSend) (WebSocket as any).prototype.send = origProtoSend; } catch {}
    origProtoSend = null;
}
