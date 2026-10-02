// Standalone sandbox trade engine — works outside React.
// Intercepts buy requests when sandbox is active and executes them locally.
// Used by sendViaNewSystemWithPromise / sendViaNewSystem / api_base.api.send.

import { calcPayout, getWinCondition } from '@/utils/sandbox-payout';

export interface SandboxTradeRecord {
    contractId: number;
    symbol: string;
    contractType: string;
    barrier: number;
    stake: number;
    payout: number;
    entryDigit: number;
    resultDigit: number | null;
    profit: number | null;
    status: 'open' | 'won' | 'lost';
    openedAt: number;
    settledAt: number | null;
    duration: number;
}

let nextContractId = 910000;
const openTrades = new Map<number, { trade: SandboxTradeRecord; tickBuffer: number[] }>();
const seenTicks = new Set<string>();

export function isSandboxActive(): boolean {
    try { return localStorage.getItem('sandbox_active') === 'true'; } catch { return false; }
}

export function getSandboxBalance(): number {
    try { return Number(localStorage.getItem('sandbox_balance') || '0'); } catch { return 0; }
}

function setSandboxBalance(v: number) {
    try { localStorage.setItem('sandbox_balance', String(v)); } catch {}
    window.dispatchEvent(new CustomEvent('sandbox_state_changed', {
        detail: { isSandbox: true, sandboxBalance: v },
    }));
}

function lastDigitOfPrice(v: number | string): number {
    const digits = String(v).match(/\d/g);
    return digits && digits.length ? Number(digits[digits.length - 1]) : 0;
}

/**
 * Attempt to execute a trade locally. Returns a fake Deriv buy response
 * or null if sandbox is inactive / trade rejected.
 */
export function trySandboxBuy(msg: any): any | null {
    if (!isSandboxActive()) return null;

    // Extract buy parameters from various message shapes
    let contractType = '';
    let barrier = 0;
    let stake = 0;
    let symbol = '';
    let duration = 1;

    if (msg.buy && msg.parameters) {
        // sendViaNewSystemWithPromise({ buy: 1, price: amt, parameters: {...} })
        contractType = msg.parameters.contract_type || '';
        barrier = Number(msg.parameters.barrier || 0);
        stake = Number(msg.price || msg.parameters.amount || 0);
        symbol = msg.parameters.underlying_symbol || msg.parameters.symbol || '';
        duration = Number(msg.parameters.duration || 1);
    } else if (msg.buy && typeof msg.buy === 'object') {
        // api_base.api.send({ buy: proposalId, price: askPrice }) — proposal mode
        // We can't resolve the proposal here; reject with a clear error.
        return { error: { code: 'InvalidParameter', message: 'Sandbox: proposal-based buys not supported. Use direct buy.' } };
    } else if (msg.parameters && msg.parameters.contract_type) {
        contractType = msg.parameters.contract_type;
        barrier = Number(msg.parameters.barrier || 0);
        stake = Number(msg.parameters.amount || msg.parameters.price || 0);
        symbol = msg.parameters.underlying_symbol || msg.parameters.symbol || '';
        duration = Number(msg.parameters.duration || 1);
    }

    if (!contractType || !stake || stake <= 0) return null;
    if (!symbol) return null;

    const balance = getSandboxBalance();
    if (balance < stake) {
        return { error: { code: 'InsufficientBalance', message: 'Sandbox: insufficient paper balance.' } };
    }

    const payout = calcPayout(contractType, barrier, stake);
    const newBalance = balance - stake;
    const contractId = nextContractId++;

    const trade: SandboxTradeRecord = {
        contractId,
        symbol,
        contractType,
        barrier,
        stake,
        payout,
        entryDigit: 0,
        resultDigit: null,
        profit: null,
        status: 'open',
        openedAt: Date.now(),
        settledAt: null,
        duration,
    };

    openTrades.set(contractId, { trade, tickBuffer: [] });
    setSandboxBalance(newBalance);

    // Dispatch a tick listener for this trade
    // (global tick handler below will settle it)

    // Return a fake Deriv buy response
    return {
        msg_type: 'buy',
        buy: {
            contract_id: contractId,
            buy_price: stake,
            payout: payout,
            balance_after: newBalance,
            currency: 'USD',
        },
        echo_req: { buy: '1', price: stake },
    };
}

/**
 * Feed a tick into the sandbox engine. Settles any open trade whose
 * symbol matches and whose duration has been reached.
 */
export function feedSandboxTick(symbol: string, quote: number): void {
    if (openTrades.size === 0) return;
    const digit = lastDigitOfPrice(quote);

    for (const [id, entry] of openTrades) {
        if (entry.trade.symbol !== symbol) continue;
        entry.tickBuffer.push(digit);

        if (entry.tickBuffer.length >= entry.trade.duration) {
            const resultDigit = entry.tickBuffer[entry.tickBuffer.length - 1];
            const won = getWinCondition(entry.trade.contractType, entry.trade.barrier, resultDigit);
            const profit = won ? entry.trade.payout - entry.trade.stake : -entry.trade.stake;
            const currentBal = getSandboxBalance();
            const newBal = currentBal + (won ? entry.trade.payout : 0);

            const settled: SandboxTradeRecord = {
                ...entry.trade,
                resultDigit,
                profit,
                status: won ? 'won' : 'lost',
                settledAt: Date.now(),
            };

            openTrades.delete(id);
            setSandboxBalance(newBal);

            // Dispatch settlement event for UI
            window.dispatchEvent(new CustomEvent('sandbox_trade_settled', {
                detail: settled,
            }));
        }
    }
}

// Global tick listener — feeds every tick to the sandbox engine
if (typeof window !== 'undefined') {
    window.addEventListener('newSystemMessage', (event: any) => {
        try {
            const raw = event?.detail?.data;
            if (!raw) return;
            const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (data.tick && data.tick.symbol && data.tick.quote != null) {
                feedSandboxTick(data.tick.symbol, Number(data.tick.quote));
            }
        } catch {}
    });
}
