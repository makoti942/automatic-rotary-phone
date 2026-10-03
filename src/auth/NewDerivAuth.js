import * as sandboxEngine from '@/utils/sandbox-engine';

let requestSequence = 0

function nextRequestId() {
    requestSequence = (requestSequence + 1) % 1000
    return Date.now() * 1000 + requestSequence
}

// Deriv's short-duration Higher/Lower contracts use CALL/PUT with a
// relative barrier. Some Blockly paths provide the same value as a positive
// number, so normalize it at the shared request boundary:
//   Synthetic-index Higher/Lower uses +offset for both CALL and PUT.
// Already-signed barriers are preserved so markets that explicitly provide a
// signed value are not rewritten.
function normalizeRelativeBarrier(out) {
    if (!out || typeof out !== 'object') return out
    const contractType = String(out.contract_type || '').toUpperCase()
    if (contractType !== 'CALL' && contractType !== 'PUT') return out
    const symbol = String(out.underlying_symbol || '')
    const isSyntheticIndex = /^(R_\d+|1HZ\d+V)$/.test(symbol)

    const normalize = value => {
        if (value === undefined || value === null || value === '') return value
        const text = String(value).trim()
        if (!text || text.startsWith('+')) return text
        if (text.startsWith('-')) return isSyntheticIndex ? `+${text.slice(1)}` : text
        const number = Number(text)
        if (!Number.isFinite(number) || number === 0) return value
        return `+${text}`
    }

    if ('barrier' in out) out.barrier = normalize(out.barrier)
    if (out.parameters && typeof out.parameters === 'object' && 'barrier' in out.parameters) {
        out.parameters.barrier = normalize(out.parameters.barrier)
    }
    return out
}

function convertToNewFormat(data) {
    if (!data || typeof data !== 'object') return data
    const out = Array.isArray(data) ? data.map(convertToNewFormat) : { ...data }

    if (out.proposal === 1 && out.symbol) {
        out.underlying_symbol = out.symbol
        delete out.symbol
    }

    if ('buy' in out) {
        out.buy = String(out.buy)
    }

    if (out.parameters && typeof out.parameters === 'object') {
        out.parameters = { ...out.parameters }
        if ('symbol' in out.parameters) {
            out.parameters.underlying_symbol = out.parameters.symbol
            delete out.parameters.symbol
        }
    }

    normalizeRelativeBarrier(out)

    return out
}

function isBuyMessage(msg) {
    return msg && typeof msg === 'object' && ('buy' in msg) && msg.buy !== undefined && msg.buy !== null;
}

export function onNewSystemMessage(callback) {
    if (typeof window === 'undefined') return () => {};
    const handler = (event) => { try { callback(event.detail); } catch (_) {} };
    window.addEventListener('newSystemMessage', handler);
    return () => window.removeEventListener('newSystemMessage', handler);
}

export function isNewLoggedIn() {
    try {
        const activeLoginId = localStorage.getItem('active_loginid');
        if (activeLoginId) return true;
        const acc = JSON.parse(localStorage.getItem('client.accounts') || '{}');
        const ids = JSON.parse(localStorage.getItem('accountsList') || '{}');
        return Object.keys(acc).length > 0 || Object.keys(ids).length > 0;
    } catch { return false; }
}

export async function sendViaNewSystemWithPromise(msg) {
    // Sandbox interception: execute buys locally instead of sending to Deriv
    if (isBuyMessage(msg)) {
        if (sandboxEngine.isSandboxActive()) {
            const fakeResponse = await sandboxEngine.trySandboxBuyAsync(msg);
            if (fakeResponse) {
                if (fakeResponse.error) return Promise.reject(fakeResponse);
                // Dispatch the fake response so any WS listeners also see it
                try {
                    window.dispatchEvent(new CustomEvent('newSystemMessage', {
                        detail: { data: JSON.stringify(fakeResponse) },
                    }));
                } catch (_) {}
                return Promise.resolve(fakeResponse);
            }
        }
    }
    return new Promise((resolve, reject) => {
        if (!window._newSystemWS || window._newSystemWS.readyState !== WebSocket.OPEN) {
            reject(new Error('WebSocket not open'));
            return;
        }
        const msgType = Object.keys(msg).find(k => k !== 'passthrough' && k !== 'req_id');
        const hasExplicitReqId = msg.req_id != null;
        // Date.now() alone collides when Higher and Lower are submitted in
        // the same tick. A collision makes each promise consume the other
        // contract's response (and can report the wrong barrier error).
        const reqId = msg.req_id || nextRequestId();
        const toSend = { ...convertToNewFormat(msg), req_id: reqId };
        const handler = (event) => {
            try {
                const data = JSON.parse(event.detail.data);
                if (data.req_id === reqId) {
                    window.removeEventListener('newSystemMessage', handler);
                    if (data.error) reject(data);
                    else resolve(data);
                }
            } catch (_) {}
        };
        window.addEventListener('newSystemMessage', handler);
        window._newSystemWS.send(JSON.stringify(toSend));
        setTimeout(() => { window.removeEventListener('newSystemMessage', handler); reject(new Error('Timeout')); }, 30000);
    });
}

export function sendViaNewSystem(data) {
    // Sandbox interception: execute buys locally instead of sending to Deriv
    if (isBuyMessage(data)) {
        if (sandboxEngine.isSandboxActive()) {
            const fakeResponse = sandboxEngine.trySandboxBuy(data);
            if (fakeResponse) {
                if (!fakeResponse.error) {
                    try {
                        window.dispatchEvent(new CustomEvent('newSystemMessage', {
                            detail: { data: JSON.stringify(fakeResponse) },
                        }));
                    } catch (_) {}
                }
                return true;
            }
        }
    }
    if (window._newSystemWS?.readyState === WebSocket.OPEN) {
        window._newSystemWS.send(JSON.stringify(convertToNewFormat(data)))
        return true
    }
    return false
}
