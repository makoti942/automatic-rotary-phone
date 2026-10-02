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

// Cache proposals by id so proposal-based buys can be resolved locally
const proposalCache = new Map<string, any>();

export function isSandboxActive(): boolean {
    try { return localStorage.getItem('sandbox_active') === 'true'; } catch { return false; }
}

export function getSandboxBalance(): number {
    try { return Number(localStorage.getItem('sandbox_balance') || '0'); } catch { return 0; }
}

/**
 * Get a sandbox trade record by contract ID (for proposal_open_contract polling).
 * Returns null if not found or already settled.
 */
export function getSandboxTrade(contractId: number): SandboxTradeRecord | null {
    const entry = openTrades.get(contractId);
    return entry ? entry.trade : null;
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
    } else if (msg.buy && !msg.parameters && msg.price) {
        // api_base.api.send({ buy: proposalId, price: askPrice }) — proposal mode
        // Look up the cached proposal to get trade parameters
        const proposalId = String(msg.buy);
        const cached = proposalCache.get(proposalId);
        if (cached) {
            contractType = cached.contract_type || '';
            barrier = Number(cached.barrier || 0);
            stake = Number(msg.price || cached.ask_price || 0);
            symbol = cached.underlying_symbol || cached.symbol || '';
            duration = Number(cached.duration || 1);
        } else {
            // No cached proposal — can't resolve trade parameters
            return { error: { code: 'InvalidParameter', message: 'Sandbox: proposal not found for buy.' } };
        }
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

            // Emit bot.contract event so bot builder results panel updates
            emitBotContractEvent(settled);

            // Dispatch fake proposal_open_contract via newSystemMessage
            // so widget engines (which listen on newSystemMessage) can see settlements
            dispatchFakePOC(settled);
        }
    }
}

/**
 * Emit a bot.contract event via the global observer so the bot builder's
 * results panel (run-panel-store, transactions, summary-card) receives it.
 * This bridges sandbox settlements into the bot engine's expected event stream.
 */
function emitBotContractEvent(settled: SandboxTradeRecord): void {
    try {
        // Dynamically import to avoid circular deps at module load time
        // The observer is a simple singleton — access via global
        const observer = (window as any).__botObserver || null;
        if (observer && typeof observer.emit === 'function') {
            const contractData = {
                accountID: 'sandbox',
                contract_id: settled.contractId,
                is_sold: true,
                is_virtual: true,
                profit: settled.profit,
                sell_price: settled.status === 'won' ? settled.payout : 0,
                buy_price: settled.stake,
                entry_tick: settled.entryDigit,
                exit_tick: settled.resultDigit,
                symbol: settled.symbol,
                contract_type: settled.contractType,
                barrier: settled.barrier ? String(settled.barrier) : undefined,
                transaction_ids: { buy: `sandbox_buy_${settled.contractId}`, sell: `sandbox_sell_${settled.contractId}` },
                date_start: Math.floor(settled.openedAt / 1000),
                date_expiry: Math.floor((settled.settledAt || Date.now()) / 1000),
                status: settled.status,
            };
            observer.emit('bot.contract', contractData);
            observer.emit('contract.status', {
                id: 'contract.sold',
                data: contractData.transaction_ids.sell,
                contract: contractData,
            });
        }
    } catch (e) {
        console.warn('[SandboxEngine] Failed to emit bot.contract:', e);
    }
}

/**
 * Dispatch a fake proposal_open_contract message via newSystemMessage.
 * Widget engines listen on newSystemMessage for settlements — this bridges
 * sandbox settlements into their expected event stream.
 */
function dispatchFakePOC(settled: SandboxTradeRecord): void {
    try {
        const pocData = {
            msg_type: 'proposal_open_contract',
            proposal_open_contract: {
                contract_id: settled.contractId,
                is_sold: true,
                is_virtual: true,
                profit: settled.profit,
                sell_price: settled.status === 'won' ? settled.payout : 0,
                buy_price: settled.stake,
                entry_tick: settled.entryDigit,
                exit_tick: settled.resultDigit,
                symbol: settled.symbol,
                contract_type: settled.contractType,
                barrier: settled.barrier ? String(settled.barrier) : undefined,
                transaction_ids: { buy: `sandbox_buy_${settled.contractId}`, sell: `sandbox_sell_${settled.contractId}` },
                date_start: Math.floor(settled.openedAt / 1000),
                date_expiry: Math.floor((settled.settledAt || Date.now()) / 1000),
                status: settled.status,
            },
        };
        window.dispatchEvent(new CustomEvent('newSystemMessage', {
            detail: { data: JSON.stringify(pocData) },
        }));
    } catch (e) {
        console.warn('[SandboxEngine] Failed to dispatch fake POC:', e);
    }
}

// Cache proposals from newSystemMessage so proposal-based buys can be resolved
function cacheProposal(data: any): void {
    if (data.msg_type === 'proposal' && data.proposal && data.proposal.id) {
        proposalCache.set(String(data.proposal.id), data.proposal);
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
            // Cache proposals for proposal-based buys
            cacheProposal(data);
        } catch {}
    });
}
