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
    entrySpot: number | null;
    entryTime: number | null;
    resultDigit: number | null;
    exitSpot: number | null;
    exitTime: number | null;
    profit: number | null;
    status: 'open' | 'won' | 'lost';
    openedAt: number;
    settledAt: number | null;
    duration: number;
    tickCount: number;
}

let nextContractId = 910000;
const openTrades = new Map<number, {
    trade: SandboxTradeRecord;
    tickBuffer: Array<{ digit: number; quote: number; time: number }>;
}>();
const seenTicks = new Set<string>();

// Cache proposals by id so proposal-based buys can be resolved locally
const proposalCache = new Map<string, any>();

// Trade spacing: track last settlement time per symbol
const lastSettlementTime = new Map<string, number>();

// Get required delay after settlement based on symbol type
function getTradeDelay(symbol: string): number {
    // 1s volatilities (1HZ10V, 1HZ25V, etc.): 2 seconds
    if (symbol.startsWith('1HZ')) return 2000;
    // Plain volatilities (R_10, R_25, etc.): 4 seconds
    return 4000;
}

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

    // Trade spacing: check if we're still in the delay period after last settlement
    const lastSettle = lastSettlementTime.get(symbol);
    if (lastSettle) {
        const delay = getTradeDelay(symbol);
        if (Date.now() - lastSettle < delay) {
            const remaining = Math.ceil((delay - (Date.now() - lastSettle)) / 1000);
            return { error: { code: 'RateLimited', message: `Sandbox: wait ${remaining}s before next trade on ${symbol}.` } };
        }
    }

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
        entrySpot: null,
        entryTime: null,
        resultDigit: null,
        exitSpot: null,
        exitTime: null,
        profit: null,
        status: 'open',
        openedAt: Date.now(),
        settledAt: null,
        duration,
        tickCount: 0,
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
 * Captures real tick quotes for entry/exit spots.
 */
export function feedSandboxTick(symbol: string, quote: number): void {
    if (openTrades.size === 0) return;
    const digit = lastDigitOfPrice(quote);
    const now = Date.now();

    for (const [id, entry] of openTrades) {
        if (entry.trade.symbol !== symbol) continue;

        // Capture entry spot on first tick
        if (entry.trade.entrySpot === null) {
            entry.trade.entrySpot = quote;
            entry.trade.entryTime = now;
            entry.trade.entryDigit = digit;
        }

        entry.tickBuffer.push({ digit, quote, time: now });
        entry.trade.tickCount = entry.tickBuffer.length;

        if (entry.tickBuffer.length >= entry.trade.duration) {
            const lastTick = entry.tickBuffer[entry.tickBuffer.length - 1];
            const resultDigit = lastTick.digit;
            const won = getWinCondition(entry.trade.contractType, entry.trade.barrier, resultDigit);
            const profit = won ? entry.trade.payout - entry.trade.stake : -entry.trade.stake;
            const currentBal = getSandboxBalance();
            const newBal = currentBal + (won ? entry.trade.payout : 0);

            const settled: SandboxTradeRecord = {
                ...entry.trade,
                resultDigit,
                exitSpot: lastTick.quote,
                exitTime: lastTick.time,
                profit,
                status: won ? 'won' : 'lost',
                settledAt: now,
            };

            openTrades.delete(id);
            setSandboxBalance(newBal);

            // Record settlement time for trade spacing
            lastSettlementTime.set(symbol, now);

            // Dispatch settlement event for UI (manual trade, sandbox context)
            window.dispatchEvent(new CustomEvent('sandbox_trade_settled', {
                detail: settled,
            }));

            // Inject fake POC into DerivAPIBasic's event stream so:
            // 1. Bot engine's OpenContract sees settlement → dispatches sell() → next trade
            // 2. broadcastContract emits bot.contract → results panel records entry/exit ticks
            injectPOCIntoBotEngine(settled);

            // Also dispatch via newSystemMessage for widget engines
            dispatchFakePOC(settled);
        }
    }
}

/**
 * Inject a fake proposal_open_contract message directly into
 * DerivAPIBasic's internal event stream (api_base.api.events.next()).
 * This is the ONLY channel the bot engine's OpenContract listens on.
 * One injection fixes both the trade loop AND results panel tick recording.
 */
function injectPOCIntoBotEngine(settled: SandboxTradeRecord): void {
    try {
        const api = (window as any)._derivApi;
        if (!api || !api.events || typeof api.events.next !== 'function') {
            console.warn('[SandboxEngine] _derivApi not available for POC injection');
            return;
        }

        const won = settled.status === 'won';
        const sellPrice = won ? settled.payout : 0;
        const shortcode = `${settled.contractType}${settled.barrier || ''}:${settled.symbol}:${settled.duration}:${settled.stake}`;
        const pocData = {
            msg_type: 'proposal_open_contract',
            proposal_open_contract: {
                contract_id: settled.contractId,
                is_sold: true,
                is_expired: true,
                is_valid_to_sell: false,
                is_virtual: true,
                is_completed: true,
                status: settled.status,
                profit: settled.profit,
                buy_price: settled.stake,
                sell_price: sellPrice,
                payout: settled.payout,
                bid_price: sellPrice,
                currency: 'USD',
                symbol: settled.symbol,
                contract_type: settled.contractType,
                barrier: settled.barrier ? String(settled.barrier) : undefined,
                underlying: settled.symbol,
                display_name: settled.symbol,
                shortcode,
                transaction_ids: {
                    buy: `sandbox_buy_${settled.contractId}`,
                    sell: `sandbox_sell_${settled.contractId}`,
                },
                // Results-panel tick fields — real spot prices, not digits
                entry_spot: settled.entrySpot,
                exit_spot: settled.exitSpot,
                entry_tick: settled.entrySpot,
                exit_tick: settled.exitSpot,
                entry_tick_time: settled.entryTime ? Math.floor(settled.entryTime / 1000) : Math.floor(settled.openedAt / 1000),
                exit_tick_time: settled.exitTime ? Math.floor(settled.exitTime / 1000) : Math.floor((settled.settledAt || Date.now()) / 1000),
                tick_count: settled.tickCount,
                date_start: Math.floor(settled.openedAt / 1000),
                date_expiry: Math.floor((settled.settledAt || Date.now()) / 1000),
            },
        };

        // Push into DerivAPIBasic's event stream — this is what onMessage() listens to
        api.events.next({ name: 'message', data: pocData });
        console.log('[SandboxEngine] Injected POC into bot engine for contract', settled.contractId);
    } catch (e) {
        console.warn('[SandboxEngine] Failed to inject POC into bot engine:', e);
    }
}

/**
 * Dispatch a fake proposal_open_contract message via newSystemMessage.
 * Widget engines listen on newSystemMessage for settlements.
 */
function dispatchFakePOC(settled: SandboxTradeRecord): void {
    try {
        const won = settled.status === 'won';
        const pocData = {
            msg_type: 'proposal_open_contract',
            proposal_open_contract: {
                contract_id: settled.contractId,
                is_sold: true,
                is_virtual: true,
                is_completed: true,
                status: settled.status,
                profit: settled.profit,
                buy_price: settled.stake,
                sell_price: won ? settled.payout : 0,
                payout: settled.payout,
                currency: 'USD',
                symbol: settled.symbol,
                contract_type: settled.contractType,
                barrier: settled.barrier ? String(settled.barrier) : undefined,
                transaction_ids: {
                    buy: `sandbox_buy_${settled.contractId}`,
                    sell: `sandbox_sell_${settled.contractId}`,
                },
                entry_spot: settled.entrySpot,
                exit_spot: settled.exitSpot,
                entry_tick: settled.entrySpot,
                exit_tick: settled.exitSpot,
                entry_tick_time: settled.entryTime ? Math.floor(settled.entryTime / 1000) : Math.floor(settled.openedAt / 1000),
                exit_tick_time: settled.exitTime ? Math.floor(settled.exitTime / 1000) : Math.floor((settled.settledAt || Date.now()) / 1000),
                tick_count: settled.tickCount,
                date_start: Math.floor(settled.openedAt / 1000),
                date_expiry: Math.floor((settled.settledAt || Date.now()) / 1000),
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
