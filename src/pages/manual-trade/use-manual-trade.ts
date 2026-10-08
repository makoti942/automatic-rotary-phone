import { useState, useEffect, useRef, useCallback } from 'react';
import { onNewSystemMessage, sendViaNewSystem, sendViaNewSystemWithPromise } from '@/auth/NewDerivAuth';
import { useSandbox } from '@/components/layout/header/sandbox-context';
import { calcPayout } from '@/utils/sandbox-payout';

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

export interface TradeNotification {
    type: 'opened' | 'closed' | 'error';
    contractId?: number;
    contractType?: string;
    stake?: number;
    payout?: number;
    profit?: number;
    exitDigit?: number;
    win?: boolean;
    message?: string;
    key: number;
}

export interface ActiveTrade {
    contractId: number;
    contractType: ContractMode;
    selectedDigit: number;
    stake: number;
    openedAt: number;
}

export interface SessionTrade {
    contractId: number;
    symbol: string;
    contractType: ContractMode;
    stake: number;
    profit: number | null;
    status: 'open' | 'won' | 'lost';
    executedAt: number;
    closedAt?: number;
    entryDigit?: number;
    exitDigit?: number;
}

const SESSION_TRADES_KEY = 'manual-trade-session-history';

function readSessionTrades(): SessionTrade[] {
    if (typeof window === 'undefined') return [];
    try {
        const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        if (navigation?.type === 'reload') {
            sessionStorage.removeItem(SESSION_TRADES_KEY);
            return [];
        }
        const saved = sessionStorage.getItem(SESSION_TRADES_KEY);
        return saved ? JSON.parse(saved) : [];
    } catch { return []; }
}

function lastDigitOfPrice(v: number | string): number {
    const digits = String(v).match(/\d/g);
    return digits && digits.length ? Number(digits[digits.length - 1]) : 0;
}

export type TradeType = 'matches-differs' | 'over-under' | 'even-odd' | 'rise-fall';
export type ContractMode = 'DIGITMATCH' | 'DIGITDIFF' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD' | 'CALL' | 'PUT';

const VOLATILITY_SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];

const MT_LS_KEY = 'mw_manual_trade_cfg';
function loadMtCfg() {
    try { return JSON.parse(localStorage.getItem(MT_LS_KEY) || '{}'); } catch { return {}; }
}
function saveMtCfg(cfg: Record<string, any>) {
    try { localStorage.setItem(MT_LS_KEY, JSON.stringify(cfg)); } catch {}
}

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
    const _cfg = loadMtCfg();
    const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
    const [activeSymbol, setActiveSymbol] = useState(_cfg.activeSymbol || 'R_100');
    const [currentTick, setCurrentTick] = useState<TickInfo | null>(null);
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const [digitCounts, setDigitCounts] = useState<number[]>(Array(10).fill(0));
    const [digitGrowth, setDigitGrowth] = useState<number[]>(Array(10).fill(0));
    const [digitTotal, setDigitTotal] = useState(0);
    const [pipSize, setPipSize] = useState(2);
    const [tradeType, setTradeTypeState] = useState<TradeType>(_cfg.tradeType || 'matches-differs');
    const [contractMode, setContractMode] = useState<ContractMode>(_cfg.contractMode || 'DIGITMATCH');
    const [selectedDigit, setSelectedDigit] = useState(_cfg.selectedDigit ?? 5);
    const [stake, setStake] = useState(_cfg.stake || '10');
    const [duration, setDuration] = useState(_cfg.duration || 1);
    const [proposalPayouts, setProposalPayouts] = useState<Partial<Record<ContractMode, number>>>({});
    const [isProposalLoading, setIsProposalLoading] = useState(false);
    const [isBuying, setIsBuying] = useState(false);
    const [isWaitingEntry, setIsWaitingEntry] = useState(false);
    const [buyResult, setBuyResult] = useState<BuyResult | null>(null);
    const [buyError, setBuyError] = useState<string | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error] = useState<string | null>(null);
    const [tradeFlash, setTradeFlash] = useState<TradeFlash | null>(null);
    const { isSandbox, executeSandboxTrade } = useSandbox();
    // Mirror isSandbox into a ref so buyWithMode's closure always sees the
    // current value — isSandbox is NOT in buyWithMode's dependency array.
    const isSandboxRef = useRef(isSandbox);
    isSandboxRef.current = isSandbox;
    const [notifications, setNotifications] = useState<TradeNotification[]>([]);
    const [exitDigit, setExitDigit] = useState<number | null>(null);
    const [activeTrade, setActiveTrade] = useState<ActiveTrade | null>(null);
    const [tradeHistory, setTradeHistory] = useState<SessionTrade[]>(readSessionTrades);

    const [entryDigitEnabled, setEntryDigitEnabled] = useState(_cfg.entryDigitEnabled ?? false);
    const [entryDigitValue, setEntryDigitValue] = useState(_cfg.entryDigitValue ?? 5);
    const [entryTimeout, setEntryTimeout] = useState(_cfg.entryTimeout ?? 120);

    const entryDigitRef = useRef(entryDigitValue);
    entryDigitRef.current = entryDigitValue;
    const entryTimeoutRef = useRef(entryTimeout);
    entryTimeoutRef.current = entryTimeout;
    const entryEnabledRef = useRef(entryDigitEnabled);
    entryEnabledRef.current = entryDigitEnabled;
    const lastDigitRef = useRef<number | null>(null);

    const subIdRef = useRef<string | null>(null);
    const proposalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const quoteBatchRef = useRef(0);
    const mountedRef = useRef(true);

    // Persist config to localStorage
    useEffect(() => {
        saveMtCfg({ activeSymbol, tradeType, contractMode, selectedDigit, stake, duration, entryDigitEnabled, entryDigitValue, entryTimeout });
    }, [activeSymbol, tradeType, contractMode, selectedDigit, stake, duration, entryDigitEnabled, entryDigitValue]);
    useEffect(() => {
        return () => { saveMtCfg({ activeSymbol, tradeType, contractMode, selectedDigit, stake, duration, entryDigitEnabled, entryDigitValue, entryTimeout }); };
    }, [activeSymbol, tradeType, contractMode, selectedDigit, stake, duration, entryDigitEnabled, entryDigitValue]);
    const pipRef = useRef(pipSize);
    const pricesRef = useRef<number[]>([]);
    const symbolRef = useRef(activeSymbol);
    const lastTickTimeRef = useRef(Date.now());
    const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const reqIdRef = useRef(0);
    const fetchReqIdRef = useRef(0);
    const subReqIdRef = useRef(0);
    const seenSoldRef = useRef<Set<string>>(new Set());
    const pocLoadedRef = useRef(false);
    const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isBuyingRef = useRef(false);
    const cancelEntryRef = useRef(false);
    const pocSubReqIdRef = useRef(0);
    const pocSubIdRef = useRef<string | null>(null);
    const exitDigitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const trackedContractsRef = useRef<Set<string>>(new Set());
    const buyHandledByWsRef = useRef(false);
    const pendingBuyModeRef = useRef<ContractMode | null>(null);

    useEffect(() => {
        try { sessionStorage.setItem(SESSION_TRADES_KEY, JSON.stringify(tradeHistory)); } catch {}
    }, [tradeHistory]);

    pipRef.current = pipSize;
    symbolRef.current = activeSymbol;
    lastDigitRef.current = lastDigit;

    useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

    // Listen for sandbox trade settlements (from sandbox engine)
    useEffect(() => {
        const handler = (e: Event) => {
            const settled = (e as CustomEvent).detail;
            if (!mountedRef.current || !settled) return;
            const settledId = Number(settled.contractId);
            const profit = Number(settled.profit ?? 0);
            const won = settled.status === 'won';
            const exitDigitVal = settled.resultDigit != null ? Number(settled.resultDigit) : -1;

            setActiveTrade(null);
            setTradeHistory(previous => previous.map(trade => trade.contractId === settledId ? {
                ...trade,
                profit,
                status: won ? 'won' : 'lost',
                closedAt: Date.now(),
                exitDigit: exitDigitVal >= 0 ? exitDigitVal : undefined,
            } : trade));

            const flash: TradeFlash = {
                digit: exitDigitVal,
                win: won,
                key: Date.now(),
            };
            setTradeFlash(flash);
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
            flashTimerRef.current = setTimeout(() => {
                if (mountedRef.current) setTradeFlash(null);
            }, 4000);
            if (exitDigitVal >= 0) setExitDigit(exitDigitVal);
            if (exitDigitTimerRef.current) clearTimeout(exitDigitTimerRef.current);
            exitDigitTimerRef.current = setTimeout(() => {
                if (mountedRef.current) setExitDigit(null);
            }, 3000);

            const notif: TradeNotification = {
                type: 'closed',
                contractId: settledId,
                profit,
                exitDigit: exitDigitVal >= 0 ? exitDigitVal : undefined,
                win: won,
                stake: settled.stake,
                key: Date.now(),
            };
            setNotifications(p => [...p, notif]);
            setTimeout(() => setNotifications(p => p.filter(n => n.key !== notif.key)), 3000);
        };
        window.addEventListener('sandbox_trade_settled', handler);
        return () => window.removeEventListener('sandbox_trade_settled', handler);
    }, []);

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
                    // Same for the contract-settlement stream: if someone else
                    // already subscribes to proposal_open_contract, their pushes
                    // still reach us through the shared bus (passive mode).
                    if (data.echo_req?.req_id === pocSubReqIdRef.current) {
                        pocSubReqIdRef.current = 0;
                    }
                    return;
                }
                // Capture the contract-stream subscription id we own, so
                // cleanup never forgets another component's subscription.
                if (data.subscription?.id && data.echo_req?.req_id === pocSubReqIdRef.current) {
                    pocSubIdRef.current = data.subscription.id;
                    pocSubReqIdRef.current = 0;
                    return;
                }
                if (data.msg_type === 'tick' && data.tick) {
                    if (data.tick.symbol !== symbolRef.current) return;
                    const quote = Number(data.tick.quote);
                    if (!isNaN(quote)) {
                        lastTickTimeRef.current = Date.now();
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
                if (data.msg_type === 'buy') {
                    setIsBuying(false);
                    if (data.buy) {
                        const contractId = Number(data.buy.contract_id);
                        const wasAlreadyTracked = trackedContractsRef.current.has(String(contractId));
                        buyHandledByWsRef.current = true;
                        setBuyResult({
                            contract_id: contractId,
                            buyPrice: Number(data.buy.buy_price),
                            payout: Number(data.buy.payout),
                            balanceAfter: Number(data.buy.balance_after),
                        });
                        setBuyError(null);
                        setNotifications(p => p.filter(n => n.type !== 'error'));
                        if (!wasAlreadyTracked) {
                            trackedContractsRef.current.add(String(contractId));
                            const buyMode = pendingBuyModeRef.current || 'DIGITMATCH';
                            setTradeHistory(previous => [...previous, {
                                contractId,
                                symbol: symbolRef.current,
                                contractType: buyMode,
                                stake: Number(data.buy.buy_price),
                                profit: null,
                                status: 'open',
                                executedAt: Date.now(),
                            }]);
                            const notif: TradeNotification = {
                                type: 'opened',
                                contractId,
                                contractType: buyMode,
                                stake: Number(data.buy.buy_price),
                                payout: Number(data.buy.payout),
                                key: Date.now(),
                            };
                            setNotifications(p => [...p, notif]);
                            setTimeout(() => setNotifications(p => p.filter(n => n.key !== notif.key)), 3000);
                            sendViaNewSystem({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });
                        }
                    } else if (data.error) {
                        setBuyError(data.error.message ?? 'Buy failed');
                    }
                    return;
                }
                if (data.msg_type === 'proposal_open_contract') {
                    const list = Array.isArray(data.proposal_open_contract)
                        ? data.proposal_open_contract
                        : [data.proposal_open_contract];

                    // The instant a tracked contract settles, flash its EXIT
                    // digit green (win) / red (loss). Contracts already sold on
                    // first load are recorded silently — only fresh settlements
                    // flash.
                    let freshFlash: TradeFlash | null = null;
                    let settledContract: any = null;
                    list.forEach((poc: any) => {
                        const contractKey = String(poc?.contract_id ?? '');
                        const closedStatuses = ['sold', 'won', 'lost', 'closed', 'expired'];
                        const isSold = poc?.is_sold === true || Number(poc?.is_sold) === 1 || closedStatuses.includes(String(poc?.status ?? '').toLowerCase());
                        const hasSellValue = poc?.sell_price != null || poc?.sell_time != null || poc?.exit_tick != null;
                        const entryValue = poc?.entry_tick ?? poc?.entry_tick_display ?? poc?.entry_spot ?? poc?.entry_price;
                        const entryDigit = entryValue == null ? undefined : lastDigitOfPrice(entryValue);
                        if (entryDigit !== undefined && trackedContractsRef.current.has(contractKey)) {
                            setTradeHistory(previous => previous.map(trade => trade.contractId === Number(poc.contract_id) && trade.entryDigit === undefined ? {
                                ...trade,
                                entryDigit,
                            } : trade));
                        }
                        if ((!isSold && !hasSellValue) || !trackedContractsRef.current.has(contractKey)) return;
                        const key = String(poc.contract_id);
                        if (seenSoldRef.current.has(key)) return;
                        seenSoldRef.current.add(key);
                        trackedContractsRef.current.delete(key);
                        const exitValue = poc.exit_tick ?? poc.exit_tick_display ?? poc.exit_spot ?? poc.exit_price;
                        freshFlash = {
                            digit: exitValue == null ? -1 : lastDigitOfPrice(exitValue),
                            win: Number(poc.profit ?? 0) > 0,
                            key: Date.now(),
                        };
                        settledContract = poc;
                    });
                    if (seenSoldRef.current.size > 500) seenSoldRef.current = new Set();
                    pocLoadedRef.current = true;

                    if (freshFlash && settledContract) {
                        setActiveTrade(null);
                        const settledId = Number(settledContract.contract_id);
                        const settledProfit = Number(settledContract.profit ?? 0);
                        setTradeHistory(previous => previous.map(trade => trade.contractId === settledId ? {
                            ...trade,
                            profit: settledProfit,
                            status: settledProfit > 0 ? 'won' : 'lost',
                            closedAt: Date.now(),
                            exitDigit: freshFlash?.digit >= 0 ? freshFlash.digit : undefined,
                        } : trade));
                        setTradeFlash(freshFlash);
                        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
                        flashTimerRef.current = setTimeout(() => {
                            if (mountedRef.current) setTradeFlash(null);
                        }, 4000);
                        if (freshFlash.digit >= 0) setExitDigit(freshFlash.digit);
                        if (exitDigitTimerRef.current) clearTimeout(exitDigitTimerRef.current);
                        exitDigitTimerRef.current = setTimeout(() => {
                            if (mountedRef.current) setExitDigit(null);
                        }, 3000);
                        const profit = Number(settledContract.profit ?? 0);
                        const closedNotif: TradeNotification = {
                            type: 'closed',
                            contractId: settledContract.contract_id,
                            profit,
                            exitDigit: freshFlash.digit >= 0 ? freshFlash.digit : undefined,
                            win: profit > 0,
                            stake: settledContract.buy_price ? Number(settledContract.buy_price) : undefined,
                            key: Date.now(),
                        };
                        setNotifications(p => [...p, closedNotif]);
                        setTimeout(() => setNotifications(p => p.filter(n => n.key !== closedNotif.key)), 3000);
                    }
                    return;
                }
                if (data.msg_type === 'sell') {
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

    // Fetch symbols on mount + subscribe to the account-wide contract stream
    // (pushes every proposal_open_contract update — this is what powers the
    // instant win/loss exit-digit flash; a one-shot fetch never pushes).
    useEffect(() => {
        sendViaNewSystem({ active_symbols: 'brief' });
        const pocId = ++reqIdRef.current;
        pocSubReqIdRef.current = pocId;
        sendViaNewSystem({ proposal_open_contract: 1, subscribe: 1, req_id: pocId });
        const t = setTimeout(() => {
            if (mountedRef.current) {
                setSymbols(prev => prev.length > 0 ? prev : FALLBACK_SYMBOLS);
                setIsLoading(false);
            }
        }, 10000);
        return () => {
            clearTimeout(t);
            if (pocSubIdRef.current) {
                sendViaNewSystem({ forget: pocSubIdRef.current });
                pocSubIdRef.current = null;
            }
        };
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

    // Heartbeat: detect stale ticks and resubscribe
    const resubscribeTicks = useCallback(() => {
        if (!symbolRef.current) return;
        if (subIdRef.current) {
            sendViaNewSystem({ forget: subIdRef.current });
            subIdRef.current = null;
        }
        subReqIdRef.current = 0;
        const subId = ++reqIdRef.current;
        subReqIdRef.current = subId;
        sendViaNewSystem({
            ticks_history: symbolRef.current,
            count: 1,
            end: 'latest',
            style: 'ticks',
            subscribe: 1,
            req_id: subId,
        });
        lastTickTimeRef.current = Date.now();
    }, []);

    useEffect(() => {
        lastTickTimeRef.current = Date.now();
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(() => {
            if (!mountedRef.current) return;
            const elapsed = Date.now() - lastTickTimeRef.current;
            if (elapsed > 8000) {
                resubscribeTicks();
            }
        }, 5000);
        return () => { if (heartbeatRef.current) clearInterval(heartbeatRef.current); };
    }, [activeSymbol, resubscribeTicks]);

    // Reconnect: when WS comes back online, resubscribe ticks
    useEffect(() => {
        const check = setInterval(() => {
            if (window._newSystemWS?.readyState === WebSocket.OPEN && mountedRef.current) {
                const elapsed = Date.now() - lastTickTimeRef.current;
                if (elapsed > 8000) {
                    resubscribeTicks();
                }
            }
        }, 3000);
        return () => clearInterval(check);
    }, [resubscribeTicks]);

    // The bulk seed may land before active_symbols delivers the real pip size —
    // recompute stats whenever it changes so digits are never mis-parsed.
    useEffect(() => {
        if (pricesRef.current.length === 0) return;
        const stats = computeDigitGrowth(pricesRef.current, pipSize);
        setDigitCounts(stats.counts);
        setDigitGrowth(stats.growth);
        setDigitTotal(stats.total);
    }, [pipSize]);

    const setTradeType = useCallback((type: TradeType) => {
        setTradeTypeState(type);
        switch (type) {
            case 'matches-differs': setContractMode('DIGITMATCH'); break;
            case 'over-under': setContractMode('DIGITOVER'); break;
            case 'even-odd': setContractMode('DIGITEVEN'); break;
            case 'rise-fall': setContractMode('CALL'); break;
        }
    }, []);

    // Request a separate live proposal for each action button. A Matches
    // proposal and a Differs proposal, for example, have different odds.
    useEffect(() => {
        const amount = parseFloat(stake);
        if (!amount || amount <= 0 || !duration || !activeSymbol) {
            setProposalPayouts({});
            return;
        }
        const quoteModes: ContractMode[] = tradeType === 'matches-differs'
            ? ['DIGITMATCH', 'DIGITDIFF']
            : tradeType === 'over-under'
                ? ['DIGITOVER', 'DIGITUNDER']
                : tradeType === 'even-odd'
                    ? ['DIGITEVEN', 'DIGITODD']
                    : ['CALL', 'PUT'];
        if (proposalTimerRef.current) clearTimeout(proposalTimerRef.current);
        const batchId = ++quoteBatchRef.current;
        setProposalPayouts({});
        setIsProposalLoading(!isSandbox && isConnected);
        proposalTimerRef.current = setTimeout(() => {
            if (isSandbox) {
                const sandboxPayouts = quoteModes.reduce<Partial<Record<ContractMode, number>>>((result, mode) => {
                    result[mode] = Math.round(calcPayout(mode, selectedDigit, amount) * 100) / 100;
                    return result;
                }, {});
                setProposalPayouts(sandboxPayouts);
                setIsProposalLoading(false);
                return;
            }
            if (!isConnected) {
                setIsProposalLoading(false);
                return;
            }
            setIsProposalLoading(true);
            Promise.all(quoteModes.map(async mode => {
                const requestId = ++reqIdRef.current;
                const params: Record<string, unknown> = {
                    proposal: 1, amount, basis: 'stake', contract_type: mode,
                    currency: 'USD', duration, duration_unit: 't', symbol: activeSymbol, req_id: requestId,
                };
                if (!['DIGITEVEN', 'DIGITODD', 'CALL', 'PUT'].includes(mode)) params.barrier = selectedDigit;
                try {
                    const response: any = await sendViaNewSystemWithPromise(params);
                    const payout = Number(response?.proposal?.payout);
                    return [mode, Number.isFinite(payout) ? Math.round(payout * 100) / 100 : null] as const;
                } catch {
                    return [mode, null] as const;
                }
            })).then(results => {
                if (quoteBatchRef.current !== batchId) return;
                const payouts: Partial<Record<ContractMode, number>> = {};
                results.forEach(([mode, payout]) => { if (payout !== null) payouts[mode] = payout; });
                setProposalPayouts(payouts);
                setIsProposalLoading(false);
            });
        }, 120);
        return () => {
            if (proposalTimerRef.current) clearTimeout(proposalTimerRef.current);
        };
    }, [activeSymbol, contractMode, duration, isConnected, isSandbox, selectedDigit, stake, tradeType]);

    // One-click execution: Deriv accepts buy(parameters) directly. Avoid the
    // old proposal -> buy round trip because it added a visible delay after
    // the user pressed the execution button.
    const cancelEntryWait = useCallback(() => {
        cancelEntryRef.current = true;
    }, []);

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

        if (entryEnabledRef.current && mode.startsWith('DIGIT')) {
            const targetDigit = entryDigitRef.current;
            cancelEntryRef.current = false;
            setIsWaitingEntry(true);
            while (lastDigitRef.current !== targetDigit) {
                if (cancelEntryRef.current) {
                    isBuyingRef.current = false;
                    if (mountedRef.current) { setIsBuying(false); setIsWaitingEntry(false); }
                    setBuyError('Trade cancelled — waiting for entry digit.');
                    return;
                }
                await new Promise(r => setTimeout(r, 100));
            }
            if (mountedRef.current) setIsWaitingEntry(false);
        }

        // Sandbox mode: execute locally, don't send to Deriv
        // Use ref because isSandbox is not in this callback's dependency array
        if (isSandboxRef.current) {
            const trade = executeSandboxTrade({
                symbol: activeSymbol,
                contractType: mode,
                barrier: !['DIGITEVEN', 'DIGITODD', 'CALL', 'PUT'].includes(mode) ? selectedDigit : 0,
                stake: amount,
                duration,
                entryDigit: lastDigitRef.current ?? 0,
            });
            if (trade) {
                setBuyResult({
                    contract_id: trade.contractId,
                    buyPrice: trade.stake,
                    payout: trade.payout,
                    balanceAfter: 0,
                });
                setBuyError(null);
                setActiveTrade({
                    contractId: trade.contractId,
                    contractType: mode,
                    selectedDigit,
                    stake: trade.stake,
                    openedAt: trade.openedAt,
                });
                        setTradeHistory(previous => [...previous, {
                            contractId: trade.contractId,
                            symbol: activeSymbol,
                    contractType: mode,
                    stake: trade.stake,
                    profit: null,
                            status: 'open',
                            executedAt: trade.openedAt,
                            entryDigit: trade.entryDigit,
                        }]);
            } else {
                setBuyError('Sandbox: insufficient balance or trade already open.');
            }
            isBuyingRef.current = false;
            if (mountedRef.current) setIsBuying(false);
            return;
        }

        try {
            const params: any = {
                amount,
                basis: 'stake',
                contract_type: mode,
                currency: 'USD',
                duration,
                duration_unit: 't',
                symbol: activeSymbol,
            };
            if (!['DIGITEVEN', 'DIGITODD', 'CALL', 'PUT'].includes(mode)) params.barrier = selectedDigit;

            const buyReqId = ++reqIdRef.current;
            buyHandledByWsRef.current = false;
            pendingBuyModeRef.current = mode;
            const buyRes: any = await sendViaNewSystemWithPromise({ buy: 1, price: amount, parameters: params, req_id: buyReqId });
            if (buyRes?.buy) {
                const contractId = Number(buyRes.buy.contract_id);
                if (!buyHandledByWsRef.current) {
                    trackedContractsRef.current.add(String(contractId));
                    setBuyResult({
                        contract_id: contractId,
                        buyPrice: Number(buyRes.buy.buy_price),
                        payout: Number(buyRes.buy.payout),
                        balanceAfter: Number(buyRes.buy.balance_after),
                    });
                    setBuyError(null);
                    setActiveTrade({
                        contractId,
                        contractType: mode,
                        selectedDigit,
                        stake: Number(buyRes.buy.buy_price),
                        openedAt: Date.now(),
                    });
                    setTradeHistory(previous => [...previous, {
                        contractId,
                        symbol: activeSymbol,
                        contractType: mode,
                        stake: Number(buyRes.buy.buy_price),
                        profit: null,
                        status: 'open',
                        executedAt: Date.now(),
                    }]);
                    const notif: TradeNotification = {
                        type: 'opened',
                        contractId,
                        contractType: mode,
                        stake: Number(buyRes.buy.buy_price),
                        payout: Number(buyRes.buy.payout),
                        key: Date.now(),
                    };
                    setNotifications(p => [...p, notif]);
                    setTimeout(() => setNotifications(p => p.filter(n => n.key !== notif.key)), 3000);
                    sendViaNewSystem({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });
                } else {
                    setBuyResult({
                        contract_id: contractId,
                        buyPrice: Number(buyRes.buy.buy_price),
                        payout: Number(buyRes.buy.payout),
                        balanceAfter: Number(buyRes.buy.balance_after),
                    });
                    setActiveTrade({
                        contractId,
                        contractType: mode,
                        selectedDigit,
                        stake: Number(buyRes.buy.buy_price),
                        openedAt: Date.now(),
                    });
                }
            } else {
                throw new Error(buyRes?.error?.message ?? 'Buy failed.');
            }
        } catch (e: any) {
            if (buyHandledByWsRef.current) {
                isBuyingRef.current = false;
                if (mountedRef.current) setIsBuying(false);
                return;
            }
            const msg = e?.error?.message ?? e?.message ?? 'Trade failed.';
            setBuyError(msg);
            const errNotif: TradeNotification = { type: 'error', message: msg, key: Date.now() };
            setNotifications(p => [...p, errNotif]);
            setTimeout(() => setNotifications(p => p.filter(n => n.key !== errNotif.key)), 3000);
        } finally {
            isBuyingRef.current = false;
            if (mountedRef.current) setIsBuying(false);
        }
    }, [stake, duration, activeSymbol, selectedDigit]);

    const clearBuyResult = useCallback(() => {
        setBuyResult(null);
        setBuyError(null);
    }, []);

    const clearTradeHistory = useCallback(() => {
        setTradeHistory([]);
        try { sessionStorage.removeItem(SESSION_TRADES_KEY); } catch {}
    }, []);

    return {
        symbols, activeSymbol, setActiveSymbol,
        currentTick, lastDigit, digitCounts, digitGrowth, digitTotal, pipSize,
        tradeType, setTradeType,
        contractMode, setContractMode,
        selectedDigit, setSelectedDigit,
        stake, setStake, duration, setDuration,
        buyWithMode, isBuying, buyResult, buyError, clearBuyResult,
        proposalPayouts, isProposalLoading,
        isConnected, isLoading, tradeFlash,
        notifications, exitDigit, activeTrade, tradeHistory, clearTradeHistory,
        entryDigitEnabled, setEntryDigitEnabled, entryDigitValue, setEntryDigitValue,
        entryTimeout, setEntryTimeout, isWaitingEntry, cancelEntryWait,
    };
}
