import { useState, useEffect, useRef, useCallback } from 'react';
import { onNewSystemMessage, sendViaNewSystem, sendViaNewSystemWithPromise } from '@/auth/NewDerivAuth';

export interface SymbolInfo {
    display_name: string;
    symbol: string;
    pip_size: number;
}

export interface TickInfo {
    quote: number;
    epoch: number;
}

export interface ProposalInfo {
    askPrice: number;
    payout: number;
    id: string;
}

export interface BuyResult {
    contract_id: number;
    buyPrice: number;
    payout: number;
    balanceAfter: number;
}

export interface ContractPosition {
    contract_id: number;
    symbol: string;
    contract_type: string;
    buy_price: number;
    payout: number;
    is_sold: boolean;
    sell_price: number | null;
    profit: number | null;
    entry_tick: number | null;
    exit_tick: number | null;
    date_start: number;
}

export interface TradeFlash {
    digit: number;
    win: boolean;
    key: number;
}

function lastDigitOfPrice(v: number | string): number {
    const digits = String(v).match(/\d/g);
    return digits && digits.length ? Number(digits[digits.length - 1]) : 0;
}

export type TradeType = 'matches-differs' | 'over-under' | 'even-odd';
export type ContractMode = 'DIGITMATCH' | 'DIGITDIFF' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD';

const VOLATILITY_SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];

// Fallback symbols used when active_symbols API returns no results
const FALLBACK_SYMBOLS = VOLATILITY_SYMBOLS.map(s => ({
    display_name: s,
    symbol: s,
    pip_size: s.startsWith('1HZ') ? 2 : s === 'R_100' ? 2 : s === 'R_75' ? 4 : s === 'R_50' ? 4 : s === 'R_25' ? 3 : 3,
}));

function getDigit(price: number, pip: number): number {
    return Number(Number(price).toFixed(pip).slice(-1));
}

function computeDigitCounts(prices: number[], pipSize: number): number[] {
    const counts = Array(10).fill(0);
    prices.forEach(p => {
        const d = getDigit(p, pipSize);
        if (d >= 0 && d <= 9) counts[d]++;
    });
    return counts;
}

function calcDigitPcts(ticks: number[]): number[] {
    const counts = new Array(10).fill(0);
    ticks.forEach(d => { if (d >= 0 && d <= 9) counts[d]++; });
    const total = counts.reduce((a, v) => a + v, 0);
    return total > 0 ? counts.map(c => (c / total) * 100) : counts;
}

// Standard digit-stats formula: pct(digit) = occurrences / sample_size * 100.
// Sample = ALL loaded ticks (last 1000).
const STATS_WINDOW = 1000;

/** Returns counts (from all loaded prices), growth (recent-30 vs all), and total digits. */
function computeDigitGrowth(prices: number[], pipSize: number): { counts: number[]; growth: number[]; total: number } {
    const allDigits = prices.map(p => getDigit(p, pipSize)).filter(d => d >= 0 && d <= 9);
    const recentDigits = prices.slice(-30).map(p => getDigit(p, pipSize)).filter(d => d >= 0 && d <= 9);
    const allPcts = calcDigitPcts(allDigits);
    const recentPcts = calcDigitPcts(recentDigits);
    const growth = allPcts.map((p, i) => parseFloat((recentPcts[i] - p).toFixed(1)));
    const counts = Array(10).fill(0);
    allDigits.slice(-STATS_WINDOW).forEach(d => {
        counts[d]++;
    });
    return { counts, growth, total: Math.min(allDigits.length, STATS_WINDOW) };
}

export function useManualTrade() {
    const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
    const [activeSymbol, setActiveSymbol] = useState('R_100');
    const [currentTick, setCurrentTick] = useState<TickInfo | null>(null);
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const [digitCounts, setDigitCounts] = useState<number[]>(Array(10).fill(0));
    const [digitGrowth, setDigitGrowth] = useState<number[]>(Array(10).fill(0));
    const [digitTotal, setDigitTotal] = useState(0);
    const [pipSize, setPipSize] = useState(2);
    const [tradeType, setTradeTypeState] = useState<TradeType>('matches-differs');
    const [contractMode, setContractMode] = useState<ContractMode>('DIGITMATCH');
    const [selectedDigit, setSelectedDigit] = useState(5);
    const [stake, setStake] = useState('10');
    const [duration, setDuration] = useState(1);
    const [proposal, setProposal] = useState<ProposalInfo | null>(null);
    const [isProposalLoading, setIsProposalLoading] = useState(false);
    const [isBuying, setIsBuying] = useState(false);
    const [buyResult, setBuyResult] = useState<BuyResult | null>(null);
    const [buyError, setBuyError] = useState<string | null>(null);
    const [positions, setPositions] = useState<ContractPosition[]>([]);
    const [isConnected, setIsConnected] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error] = useState<string | null>(null);
    const [tradeFlash, setTradeFlash] = useState<TradeFlash | null>(null);

    const subIdRef = useRef<string | null>(null);
    const proposalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mountedRef = useRef(true);
    const pipRef = useRef(pipSize);
    const pricesRef = useRef<number[]>([]);
    const symbolRef = useRef(activeSymbol);
    const reqIdRef = useRef(0);
    const fetchReqIdRef = useRef(0);
    const subReqIdRef = useRef(0);
    const seenSoldRef = useRef<Set<string>>(new Set());
    const pocLoadedRef = useRef(false);
    const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isBuyingRef = useRef(false);

    pipRef.current = pipSize;
    symbolRef.current = activeSymbol;

    useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

    // Subscribe to WS messages
    useEffect(() => {
        const unsub = onNewSystemMessage((event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.error) {
                    // Our live subscribe was rejected because another component
                    // (bot / analysis tab) already streams this symbol on the
                    // shared socket — fall back to sharing its stream.
                    if (data.echo_req?.req_id === subReqIdRef.current) {
                        subReqIdRef.current = 0;
                    }
                    return;
                }
                if (data.msg_type === 'tick' && data.tick) {
                    // Only accept ticks for OUR symbol, whichever subscription
                    // (ours or a shared one) delivered them.
                    if (data.tick.symbol !== symbolRef.current) return;
                    const quote = Number(data.tick.quote);
                    if (!isNaN(quote)) {
                        setCurrentTick({ quote, epoch: data.tick.epoch });
                        setLastDigit(getDigit(quote, pipRef.current));
                        pricesRef.current = [...pricesRef.current.slice(-999), quote];
                        if (pricesRef.current.length > 0) {
                            const stats = computeDigitGrowth(pricesRef.current, pipRef.current);
                            setDigitCounts(stats.counts);
                            setDigitGrowth(stats.growth);
                            setDigitTotal(stats.total);
                        }
                    }
                    return;
                }
                if (data.msg_type === 'history' && data.history?.prices) {
                    // Only accept the bulk seed from our own plain history fetch
                    // (the subscribe request also answers with history — ignore it).
                    if (data.echo_req?.req_id !== fetchReqIdRef.current) return;
                    const p = data.history.prices.map(Number).filter((v: number) => !isNaN(v));
                    if (p.length > 0) {
                        pricesRef.current = p;
                        const stats = computeDigitGrowth(p, pipRef.current);
                        setDigitCounts(stats.counts);
                        setDigitGrowth(stats.growth);
                        setDigitTotal(stats.total);
                    }
                    return;
                }
                // Capture the subscription id ONLY for a subscription we own,
                // so cleanup never forgets another component's stream.
                if (data.subscription?.id && data.echo_req?.req_id === subReqIdRef.current && !subIdRef.current) {
                    subIdRef.current = data.subscription.id;
                    return;
                }
                if (data.msg_type === 'proposal') {
                    setIsProposalLoading(false);
                    setProposal(data.proposal ? {
                        askPrice: Number(data.proposal.ask_price),
                        payout: Number(data.proposal.payout),
                        id: data.proposal.id,
                    } : null);
                    return;
                }
                if (data.msg_type === 'buy') {
                    setIsBuying(false);
                    if (data.buy) {
                        setBuyResult({
                            contract_id: data.buy.contract_id,
                            buyPrice: Number(data.buy.buy_price),
                            payout: Number(data.buy.payout),
                            balanceAfter: Number(data.buy.balance_after),
                        });
                        setBuyError(null);
                    } else if (data.error) {
                        setBuyError(data.error.message ?? 'Buy failed');
                    }
                    return;
                }
                if (data.msg_type === 'proposal_open_contract') {
                    const list = Array.isArray(data.proposal_open_contract)
                        ? data.proposal_open_contract
                        : [data.proposal_open_contract];
                    const mapped = list.map((poc: any) => ({
                        contract_id: poc.contract_id,
                        symbol: poc.underlying_symbol ?? poc.symbol,
                        contract_type: poc.contract_type,
                        buy_price: Number(poc.buy_price),
                        payout: Number(poc.payout),
                        is_sold: poc.is_sold,
                        sell_price: poc.sell_price ? Number(poc.sell_price) : null,
                        profit: poc.profit !== undefined && poc.profit !== null ? Number(poc.profit) : null,
                        entry_tick: poc.entry_tick ?? null,
                        exit_tick: poc.exit_tick ?? null,
                        date_start: poc.date_start,
                    }));

                    // The instant a tracked contract settles, flash its EXIT
                    // digit green (win) / red (loss). Contracts already sold on
                    // first load are recorded silently — only fresh settlements
                    // flash.
                    let freshFlash: TradeFlash | null = null;
                    mapped.forEach(p => {
                        if (!p.is_sold || p.exit_tick === null) return;
                        const key = String(p.contract_id);
                        if (seenSoldRef.current.has(key)) return;
                        seenSoldRef.current.add(key);
                        if (pocLoadedRef.current && p.profit !== null && mountedRef.current) {
                            freshFlash = {
                                digit: lastDigitOfPrice(p.exit_tick),
                                win: p.profit > 0,
                                key: Date.now(),
                            };
                        }
                    });
                    if (seenSoldRef.current.size > 500) seenSoldRef.current = new Set();
                    pocLoadedRef.current = true;

                    setPositions(mapped);

                    if (freshFlash) {
                        setTradeFlash(freshFlash);
                        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
                        flashTimerRef.current = setTimeout(() => {
                            if (mountedRef.current) setTradeFlash(null);
                        }, 4000);
                    }
                    return;
                }
                if (data.msg_type === 'sell') {
                    sendViaNewSystem({ proposal_open_contract: 1, limit: 20 });
                    return;
                }
                if (data.msg_type === 'active_symbols' && data.active_symbols) {
                    const volidx = data.active_symbols
                        .filter((s: any) => s.symbol_type === 'volidx')
                        .map((s: any) => ({
                            display_name: s.display_name ?? s.symbol,
                            symbol: s.symbol,
                            pip_size: s.pip_size ?? 2,
                        }));
                    if (volidx.length > 0) setSymbols(volidx);
                    else setSymbols(FALLBACK_SYMBOLS);
                    setIsLoading(false);
                    return;
                }
                if (data.error && data.msg_type === 'proposal') {
                    setIsProposalLoading(false);
                    setProposal(null);
                }
            } catch (_) {}
        });
        return unsub;
    }, []);

    // Connection check
    useEffect(() => {
        const check = setInterval(() => {
            setIsConnected(window._newSystemWS?.readyState === WebSocket.OPEN);
        }, 1000);
        return () => clearInterval(check);
    }, []);

    // Fetch symbols + positions on mount
    useEffect(() => {
        sendViaNewSystem({ active_symbols: 'brief' });
        sendViaNewSystem({ proposal_open_contract: 1, limit: 20 });
        const t = setTimeout(() => {
            if (mountedRef.current) {
                setSymbols(prev => prev.length > 0 ? prev : FALLBACK_SYMBOLS);
                setIsLoading(false);
            }
        }, 10000);
        return () => clearTimeout(t);
    }, []);

    // Subscribe/Unsubscribe ticks on symbol change
    useEffect(() => {
        if (subIdRef.current) {
            sendViaNewSystem({ forget: subIdRef.current });
            subIdRef.current = null;
        }
        subReqIdRef.current = 0;

        setCurrentTick(null);
        setLastDigit(null);
        setDigitCounts(Array(10).fill(0));
        setDigitGrowth(Array(10).fill(0));
        setDigitTotal(0);

        const sym = symbols.find(s => s.symbol === activeSymbol);
        if (sym) setPipSize(sym.pip_size ?? 2);

        // 1) Bulk seed: plain history fetch (no subscribe) — can never collide
        //    with another component's subscription, so all ticks arrive at once.
        const fetchId = ++reqIdRef.current;
        fetchReqIdRef.current = fetchId;
        sendViaNewSystem({
            ticks_history: activeSymbol,
            count: 1000,
            end: 'latest',
            style: 'ticks',
            req_id: fetchId,
        });

        // 2) Own live stream; on AlreadySubscribed we passively share the
        //    existing one (ticks are accepted by symbol regardless of source).
        const subId = ++reqIdRef.current;
        subReqIdRef.current = subId;
        sendViaNewSystem({
            ticks_history: activeSymbol,
            count: 1,
            end: 'latest',
            style: 'ticks',
            subscribe: 1,
            req_id: subId,
        });

        return () => {
            if (subIdRef.current) {
                sendViaNewSystem({ forget: subIdRef.current });
                subIdRef.current = null;
            }
        };
    }, [activeSymbol]);

    // The bulk seed may land before active_symbols delivers the real pip size —
    // recompute stats whenever it changes so digits are never mis-parsed.
    useEffect(() => {
        if (pricesRef.current.length === 0) return;
        const stats = computeDigitGrowth(pricesRef.current, pipSize);
        setDigitCounts(stats.counts);
        setDigitGrowth(stats.growth);
        setDigitTotal(stats.total);
    }, [pipSize]);

    // Request proposal when trade params change
    useEffect(() => {
        if (proposalTimerRef.current) clearTimeout(proposalTimerRef.current);
        setProposal(null);
        const amount = parseFloat(stake);
        if (!amount || amount <= 0 || !duration) { setIsProposalLoading(false); return; }
        setIsProposalLoading(true);
        proposalTimerRef.current = setTimeout(() => {
            const needsBarrier = contractMode !== 'DIGITEVEN' && contractMode !== 'DIGITODD';
            const params: any = {
                proposal: 1,
                amount,
                basis: 'stake',
                contract_type: contractMode,
                currency: 'USD',
                duration,
                duration_unit: 't',
                symbol: activeSymbol,
            };
            if (needsBarrier) params.barrier = selectedDigit;
            sendViaNewSystem(params);
            setTimeout(() => { if (mountedRef.current) setIsProposalLoading(false); }, 5000);
        }, 300);
        return () => { if (proposalTimerRef.current) clearTimeout(proposalTimerRef.current); };
    }, [contractMode, selectedDigit, stake, duration, activeSymbol]);

    const setTradeType = useCallback((type: TradeType) => {
        setTradeTypeState(type);
        switch (type) {
            case 'matches-differs': setContractMode('DIGITMATCH'); break;
            case 'over-under': setContractMode('DIGITOVER'); break;
            case 'even-odd': setContractMode('DIGITEVEN'); break;
        }
    }, []);

    const buyContract = useCallback(() => {
        if (!proposal || isBuying) return;
        setIsBuying(true);
        setBuyError(null);
        sendViaNewSystem({ buy: proposal.id, price: proposal.askPrice });
        setTimeout(() => { if (mountedRef.current) setIsBuying(false); }, 10000);
    }, [proposal, isBuying]);

    // One-click execution: fetch a fresh proposal for THIS mode and buy it
    // immediately — no separate mode-selection step.
    const buyWithMode = useCallback(async (mode: ContractMode) => {
        if (isBuyingRef.current) return;
        const amount = parseFloat(stake);
        if (!amount || amount <= 0 || !duration) {
            setBuyError('Enter a valid stake and duration first.');
            return;
        }
        isBuyingRef.current = true;
        setIsBuying(true);
        setBuyError(null);
        try {
            const params: any = {
                proposal: 1,
                amount,
                basis: 'stake',
                contract_type: mode,
                currency: 'USD',
                duration,
                duration_unit: 't',
                symbol: activeSymbol,
            };
            if (mode !== 'DIGITEVEN' && mode !== 'DIGITODD') params.barrier = selectedDigit;

            const propRes: any = await sendViaNewSystemWithPromise(params);
            const prop = propRes?.proposal;
            if (!prop?.id) {
                throw new Error(propRes?.error?.message ?? 'Could not get price.');
            }
            setProposal({
                askPrice: Number(prop.ask_price),
                payout: Number(prop.payout),
                id: prop.id,
            });

            const buyRes: any = await sendViaNewSystemWithPromise({ buy: prop.id, price: prop.ask_price });
            if (buyRes?.buy) {
                setBuyResult({
                    contract_id: buyRes.buy.contract_id,
                    buyPrice: Number(buyRes.buy.buy_price),
                    payout: Number(buyRes.buy.payout),
                    balanceAfter: Number(buyRes.buy.balance_after),
                });
                setBuyError(null);
                sendViaNewSystem({ proposal_open_contract: 1, limit: 20 });
            } else {
                throw new Error(buyRes?.error?.message ?? 'Buy failed.');
            }
        } catch (e: any) {
            const msg = e?.error?.message ?? e?.message ?? 'Trade failed.';
            setBuyError(msg);
        } finally {
            isBuyingRef.current = false;
            if (mountedRef.current) setIsBuying(false);
        }
    }, [stake, duration, activeSymbol, selectedDigit]);

    const fetchPositions = useCallback(() => {
        sendViaNewSystem({ proposal_open_contract: 1, limit: 20 });
    }, []);

    const sellContract = useCallback((contractId: number) => {
        sendViaNewSystem({ sell: contractId, price: 0 });
    }, []);

    const clearBuyResult = useCallback(() => {
        setBuyResult(null);
        setBuyError(null);
    }, []);

    return {
        symbols, activeSymbol, setActiveSymbol,
        currentTick, lastDigit, digitCounts, digitGrowth, digitTotal, pipSize,
        tradeType, setTradeType,
        contractMode, setContractMode,
        selectedDigit, setSelectedDigit,
        stake, setStake, duration, setDuration,
        proposal, isProposalLoading,
        buyContract, buyWithMode, isBuying, buyResult, buyError, clearBuyResult,
        positions, sellContract, fetchPositions,
        isConnected, isLoading, error, tradeFlash,
    };
}
