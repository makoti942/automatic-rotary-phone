import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_SYMBOLS, PIP_SIZES, SYMBOL_LABELS } from './makoti-ws';
import { onNewSystemMessage, sendViaNewSystemWithPromise } from '@/auth/NewDerivAuth';
import { useStore } from '@/hooks/useStore';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import {
    AUTOMATED_FREQUENCY_WINDOW,
    AUTOMATED_TRIGGER_WINDOW,
    calculateDigitPercentages,
    findWinningDigitTrigger,
    selectAutomatedMarkets,
    RECOVERY_SAMPLE_SIZE,
    TOP_DIGIT_COUNT,
    nextAutomatedStage,
    selectRecoveryCandidate,
} from './under-even-odd-utils.mjs';

type Phase = 'idle' | 'entry' | 'normal' | 'scanning' | 'pattern' | 'settling' | 'automated';
type Side = 'even' | 'odd';
type AutoStage = 'differs' | 'over1' | 'under8';
interface OpenTrade { symbol: string; stake: number; kind: 'under' | 'parity' | 'automated'; contract: string; autoStage?: AutoStage; entryEpoch?: number; localOutcome?: 'win' | 'loss'; }
interface QualifiedMarket { symbol: string; pairPct: number; digitPcts: number[]; lowDigits: number[]; triggerDigit: number; triggerOccurrences: number; triggerConfidence: number; lastHistoricalDigit: number; lastHistoricalEpoch?: number; }
interface RecoveryPick { symbol: string; side: Side; evenPct: number; oddPct: number; digitPcts: number[]; topDigits: number[]; losingTopCount: number; trailingOpposite: number; lastEpoch?: number; }
const FALLBACK_SYMBOLS = ALL_SYMBOLS;
const BASE = { stake: '0.35', entryDigit: '2', martingale: '2' };
const isEven = (d: number) => d % 2 === 0;
const parityContractFor = (side: Side) => (side === 'even' ? 'DIGITEVEN' : 'DIGITODD');
const manualTradeDigitOf = (quote: unknown, symbol: string, pipSizes: Record<string, number>) => {
    const pip = pipSizes[symbol] || PIP_SIZES[symbol] || 2;
    return Number(Number(quote).toFixed(pip).slice(-1));
};
const withTimeout = <T,>(promise: Promise<T>, ms: number) => Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('request timeout')), ms))]);
const pipDigits = (value: unknown) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 2;
    if (Number.isInteger(n) && n >= 1) return n;
    const text = n.toString();
    if (/e-/i.test(text)) return Number(text.split('e-')[1]) || 2;
    return (text.split('.')[1] || '').length || 2;
};

export const UnderEvenOddAuto: React.FC = () => {
    const { transactions } = useStore();
    const [stake, setStake] = useState(() => localStorage.getItem('mw_ueo_stake') || BASE.stake);
    const [entryDigit, setEntryDigit] = useState(() => localStorage.getItem('mw_ueo_entry') || BASE.entryDigit);
    const [martingale, setMartingale] = useState(() => localStorage.getItem('mw_ueo_martingale') || BASE.martingale);
    const [takeProfit, setTakeProfit] = useState(() => localStorage.getItem('mw_ueo_take_profit') || '');
    const [stopLoss, setStopLoss] = useState(() => localStorage.getItem('mw_ueo_stop_loss') || '');
    const [normalSymbol, setNormalSymbol] = useState(() => localStorage.getItem('mw_ueo_market') || '1HZ25V');
    const [availableSymbols, setAvailableSymbols] = useState<string[]>(FALLBACK_SYMBOLS);
    const [automated, setAutomated] = useState(() => localStorage.getItem('mw_ueo_automated') === 'true');
    const [recoveryEachTick, setRecoveryEachTick] = useState(() => localStorage.getItem('mw_ueo_recovery_each_tick') === 'true');
    const [oppositeTrigger, setOppositeTrigger] = useState(() => localStorage.getItem('mw_ueo_opposite_trigger') || '5');
    const [allVolatilityPattern, setAllVolatilityPattern] = useState(() => localStorage.getItem('mw_ueo_all_volatility_pattern') === 'true');
    const [tradeOppositeParity, setTradeOppositeParity] = useState(() => localStorage.getItem('mw_ueo_trade_opposite_parity') === 'true');
    const [running, setRunning] = useState(false);
    const [phase, setPhase] = useState<Phase>('idle');
    const [autoStage, setAutoStage] = useState<AutoStage>('differs');
    const [qualifiedMarkets, setQualifiedMarkets] = useState<QualifiedMarket[]>([]);
    const [normalCount, setNormalCount] = useState(0);
    const [selected, setSelected] = useState<RecoveryPick | null>(null);
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const [evenPct, setEvenPct] = useState(0);
    const [oddPct, setOddPct] = useState(0);
    const [lossBalance, setLossBalance] = useState(0);
    const [sessionProfit, setSessionProfit] = useState(0);
    const [riskAlert, setRiskAlert] = useState<{ kind: 'take-profit' | 'stop-loss'; amount: number } | null>(null);
    const [currentStake, setCurrentStake] = useState(Number(stake) || 0.35);
    const [logs, setLogs] = useState<string[]>([]);
    const [switchHelp, setSwitchHelp] = useState<string | null>(null);
    const runningRef = useRef(false);
    const phaseRef = useRef<Phase>('idle');
    const automatedRef = useRef(automated);
    const autoStageRef = useRef<AutoStage>('differs');
    const digitStreaksRef = useRef<Record<string, { digit: number; count: number }>>({});
    const automatedMarketsRef = useRef<Record<string, QualifiedMarket>>({});
    const automatedTriggerPendingRef = useRef<Record<string, number>>({});
    const processedTickKeysRef = useRef<Record<string, Set<string>>>({});
    const automatedTickIndexRef = useRef<Record<string, number>>({});
    const qualifiedMarketsRef = useRef<Set<string>>(new Set());
    const autoScanRunningRef = useRef(false);
    const recoveryEachTickRef = useRef(recoveryEachTick);
    const allVolatilityPatternRef = useRef(allVolatilityPattern);
    const tradeOppositeParityRef = useRef(tradeOppositeParity);
    const allVolatilityStreaksRef = useRef<Record<string, { side: Side; count: number }>>({});
    const localParityTradeRef = useRef<{ symbol: string; side: Side; stake: number; entryEpoch: number } | null>(null);
    const localRecoveryCompleteRef = useRef(false);
    const lastRecoveryEntryEpochRef = useRef<number | null>(null);
    const localOutcomeByEntryRef = useRef<Map<string, 'win' | 'loss'>>(new Map());
    const recoveryBuyInFlightRef = useRef<{ symbol: string; contract: string; entryEpoch?: number } | null>(null);
    const normalSymbolRef = useRef(normalSymbol);
    const stakeRef = useRef(Number(stake) || 0.35);
    const normalStartedRef = useRef(false);
    const normalCountRef = useRef(0);
    const lossRef = useRef(0);
    const sessionProfitRef = useRef(0);
    const riskTriggeredRef = useRef(false);
    const lossStreakRef = useRef(0);
    const currentStakeRef = useRef(Number(stake) || 0.35);
    const entryDigitRef = useRef(Number(entryDigit) || 2);
    const selectedRef = useRef<RecoveryPick | null>(null);
    const buffersRef = useRef<Record<string, number[]>>({});
    const openRef = useRef<Map<string, OpenTrade>>(new Map());
    const oppositeRef = useRef(0);
    const oppositeTriggerRef = useRef(Math.max(1, Number(oppositeTrigger) || 5));
    const freshRecoveryPatternRef = useRef(false);
    const recoveryNeedsFreshScanRef = useRef(false);
    const recoveryLockedSymbolRef = useRef<string | null>(null);
    const recoveryArmedRef = useRef(false);
    const lastEpochRef = useRef<number | undefined>();
    const scanRunningRef = useRef(false);
    const availableSymbolsRef = useRef<string[]>(FALLBACK_SYMBOLS);
    const pipSizesRef = useRef<Record<string, number>>({ ...PIP_SIZES });
    const labelsRef = useRef<Record<string, string>>({ ...SYMBOL_LABELS });
    const subscribedTickSymbolsRef = useRef<Set<string>>(new Set());
    const tickSubscriptionSocketRef = useRef<WebSocket | null>(null);
    const addLog = useCallback((message: string) => {
        const line = `${new Date().toLocaleTimeString()} ${message}`;
        setLogs(prev => [...prev.slice(-119), line]);
    }, []);
    const setPhaseSafe = useCallback((next: Phase) => { phaseRef.current = next; setPhase(next); }, []);
    const setAutoStageSafe = useCallback((next: AutoStage) => { autoStageRef.current = next; setAutoStage(next); }, []);
    const oppositeSide = (side: Side): Side => side === 'even' ? 'odd' : 'even';
    const recoveryEntrySide = (side: Side): Side => tradeOppositeParityRef.current ? oppositeSide(side) : side;
    const notify = useCallback((message: string) => {
        addLog(message);
        globalObserver.emit('ui.log.notify', {
            className: 'journal__text--info',
            message: `[UNDER→EVEN/ODD] ${message}`,
            sound: 'silent',
        });
        try { window.dispatchEvent(new CustomEvent('makoti:notification', { detail: message })); } catch {}
    }, [addLog]);
    const loadActiveSymbols = useCallback(async () => {
        try {
            const response: any = await withTimeout(sendViaNewSystemWithPromise({ active_symbols: 'full' }), 8000);
            const items = Array.isArray(response?.active_symbols) ? response.active_symbols : [];
            const live = items.map((item: any) => {
                const symbol = item.symbol || item.underlying_symbol || item.name;
                const match = typeof symbol === 'string' && (/^R_(\d+)$/.exec(symbol) || /^1HZ(\d+)V$/.exec(symbol));
                const level = match ? Number(match[1]) : Infinity;
                return { symbol, level, label: item.display_name || item.underlying_symbol_name || symbol, pip: pipDigits(item.pip_size ?? item.pip) };
            }).filter((item: any) => item.symbol && item.level <= 100);
            const symbols = Array.from(new Set(live.map((item: any) => item.symbol))) as string[];
            if (!symbols.length) throw new Error('Deriv returned no supported volatility indices');
            live.forEach((item: any) => { labelsRef.current[item.symbol] = item.label; pipSizesRef.current[item.symbol] = item.pip; });
            availableSymbolsRef.current = symbols;
            setAvailableSymbols(symbols);
            setNormalSymbol(current => symbols.includes(current) ? current : symbols[0]);
            notify(`LIVE CATALOG: ${symbols.length} Deriv volatility indices loaded (levels <=100)`);
        } catch (error: any) {
            availableSymbolsRef.current = FALLBACK_SYMBOLS;
            setAvailableSymbols(FALLBACK_SYMBOLS);
            notify(`LIVE CATALOG unavailable — using built-in <=100 fallback (${error?.message || 'request failed'})`);
        }
    }, [notify]);
    const sendTickSubscription = useCallback((symbol: string, count = 200) => {
        const socket = window._newSystemWS;
        if (socket?.readyState !== WebSocket.OPEN) return;
        if (tickSubscriptionSocketRef.current !== socket) {
            tickSubscriptionSocketRef.current = socket;
            subscribedTickSymbolsRef.current.clear();
        }
        if (subscribedTickSymbolsRef.current.has(symbol)) return;
        socket.send(JSON.stringify({ ticks_history: symbol, count, end: 'latest', style: 'ticks', subscribe: 1 }));
        subscribedTickSymbolsRef.current.add(symbol);
    }, []);
    const updateBuffer = useCallback((symbol: string, prices: any[]) => {
        const digits = prices.map(price => manualTradeDigitOf(price, symbol, pipSizesRef.current)).filter(Number.isFinite);
        if (!digits.length) return;
        const old = buffersRef.current[symbol] || [];
        buffersRef.current[symbol] = [...old, ...digits].slice(-1000);
    }, []);
    const recoveryStake = useCallback((lastTradeStake: number) => {
        const base = Math.max(0.35, Number(stake) || 0.35);
        const multiplier = Math.max(1, Number(martingale) || 2);
        return Math.max(0.35, Math.ceil(Math.max(base, Number(lastTradeStake) || base) * multiplier * 100) / 100);
    }, [martingale, stake]);
    const scanRecovery = useCallback(async () => {
        if (!runningRef.current || scanRunningRef.current) return;
        scanRunningRef.current = true;
        setPhaseSafe('scanning');
        if (allVolatilityPatternRef.current && !recoveryLockedSymbolRef.current) {
            const symbols = availableSymbolsRef.current.length ? availableSymbolsRef.current : FALLBACK_SYMBOLS;
            selectedRef.current = null;
            setSelected(null);
            oppositeRef.current = 0;
            allVolatilityStreaksRef.current = {};
            symbols.forEach(symbol => sendTickSubscription(symbol, RECOVERY_SAMPLE_SIZE));
            setPhaseSafe('pattern');
            notify(`RECOVERY PATTERN: monitoring ${symbols.length} volatilities simultaneously; after ${Math.max(1, Math.min(100, Number(oppositeTriggerRef.current) || 5))} consecutive same-parity ticks, trading the opposite parity and locking that volatility`);
            scanRunningRef.current = false;
            return;
        }
        const symbols = recoveryLockedSymbolRef.current
            ? [recoveryLockedSymbolRef.current]
            : (availableSymbolsRef.current.length ? availableSymbolsRef.current : FALLBACK_SYMBOLS);
        notify(`RECOVERY SCAN: sampling ${RECOVERY_SAMPLE_SIZE} ticks from ${symbols.length === 1 ? `locked volatility ${symbols[0]}` : `${symbols.length} live Deriv volatility indices for initial selection`}`);
        try {
            const samples = await Promise.all(symbols.map(async symbol => {
                try {
                    const response: any = await withTimeout(sendViaNewSystemWithPromise({ ticks_history: symbol, count: RECOVERY_SAMPLE_SIZE, end: 'latest', style: 'ticks' }), 8000);
                    const prices = response?.history?.prices || [];
                    updateBuffer(symbol, prices);
                    const digits = prices.slice(-RECOVERY_SAMPLE_SIZE).map((p: unknown) => manualTradeDigitOf(p, symbol, pipSizesRef.current)).filter(d => Number.isInteger(d) && d >= 0 && d <= 9);
                    if (digits.length < RECOVERY_SAMPLE_SIZE) return null;
                    const counts = Array(10).fill(0);
                    digits.forEach(d => { counts[d]++; });
                    const digitPcts = counts.map(count => count / digits.length * 100);
                    const ep = digitPcts.filter((_, digit) => isEven(digit)).reduce((sum, pct) => sum + pct, 0);
                    const op = 100 - ep;
                    const side: Side = ep >= op ? 'even' : 'odd';
                    const losingDigits = side === 'even' ? [1, 3, 5, 7, 9] : [0, 2, 4, 6, 8];
                    const topDigits = [...Array(10).keys()].sort((a, b) => digitPcts[b] - digitPcts[a]);
                    const losingTopCount = topDigits.slice(0, TOP_DIGIT_COUNT).filter(d => losingDigits.includes(d)).length;
                    const target = side === 'even' ? isEven : (d: number) => !isEven(d);
                    let trailingOpposite = 0;
                    for (let i = digits.length - 1; i >= 0 && !target(digits[i]); i--) trailingOpposite++;
                    return { symbol, side, evenPct: ep, oddPct: op, digitPcts, topDigits, losingTopCount, trailingOpposite, lastEpoch: response?.history?.times?.at(-1) } as RecoveryPick;
                } catch { return null; }
            }));
            const usable = samples.filter(Boolean) as RecoveryPick[];
            if (!usable.length) {
                notify(`RECOVERY SCAN: no index returned ${RECOVERY_SAMPLE_SIZE} usable ticks; retrying in 3 seconds`);
                setTimeout(() => { if (runningRef.current && lossRef.current > 0) void scanRecovery(); }, 3000);
                return;
            }
            notify(`SCAN PARITY/DIGITS (${RECOVERY_SAMPLE_SIZE} ticks): ${usable.map(x => `${x.symbol} ${x.side.toUpperCase()} ${Math.max(x.evenPct, x.oddPct).toFixed(1)}% | top ${x.topDigits.slice(0, TOP_DIGIT_COUNT).map(d => `${d}:${x.digitPcts[d].toFixed(0)}%`).join(',')} | opposite-top ${x.losingTopCount}/${TOP_DIGIT_COUNT}`).join(' | ')}`);
            const lockedUsable = recoveryLockedSymbolRef.current
                ? usable.filter(item => item.symbol === recoveryLockedSymbolRef.current)
                : usable;
            if (!lockedUsable.length) {
                notify(`RECOVERY SCAN: locked volatility ${recoveryLockedSymbolRef.current} did not return usable ticks; keeping the recovery lock and retrying in 3 seconds`);
                setTimeout(() => { if (runningRef.current && lossRef.current > 0) void scanRecovery(); }, 3000);
                return;
            }
            const best = selectRecoveryCandidate(lockedUsable) as RecoveryPick | null;
            if (!best) {
                notify(`RECOVERY SCAN: no index passed both the 60%/closest-parity ranking and the top-${TOP_DIGIT_COUNT} digit majority check; no trade, retrying in 3 seconds`);
                setTimeout(() => { if (runningRef.current && lossRef.current > 0) void scanRecovery(); }, 3000);
                return;
            }
            if (!recoveryLockedSymbolRef.current) recoveryLockedSymbolRef.current = best.symbol;
            selectedRef.current = best;
            setSelected(best);
            setEvenPct(best.evenPct); setOddPct(best.oddPct);
            recoveryArmedRef.current = false;
            const requireFreshPattern = freshRecoveryPatternRef.current;
            freshRecoveryPatternRef.current = false;
            oppositeRef.current = requireFreshPattern ? 0 : best.trailingOpposite;
            recoveryNeedsFreshScanRef.current = false;
            lastEpochRef.current = best.lastEpoch;
            sendTickSubscription(best.symbol, RECOVERY_SAMPLE_SIZE);
            setPhaseSafe('pattern');
            const target = best.side.toUpperCase();
            notify(`RECOVERY SELECTED ${labelsRef.current[best.symbol] || best.symbol}: ${target} | even ${best.evenPct.toFixed(1)}% / odd ${best.oddPct.toFixed(1)}% | top digits ${best.topDigits.slice(0, TOP_DIGIT_COUNT).map(d => `${d}:${best.digitPcts[d].toFixed(0)}%`).join(',')} | opposite-top ${best.losingTopCount}/${TOP_DIGIT_COUNT} | opposite streak ${oppositeRef.current}`);
        } finally { scanRunningRef.current = false; }
    }, [notify, sendTickSubscription, setPhaseSafe, updateBuffer]);
    const scanAutomatedPair = useCallback(async (stage: AutoStage) => {
        if (!runningRef.current || !automatedRef.current || autoScanRunningRef.current) return;
        autoScanRunningRef.current = true;
        setAutoStageSafe(stage);
        setPhaseSafe('scanning');
        setQualifiedMarkets([]);
        qualifiedMarketsRef.current = new Set();
        automatedMarketsRef.current = {};
        automatedTriggerPendingRef.current = {};
        automatedTickIndexRef.current = {};
        const lowDigits = stage === 'over1' ? [0, 1] : [8, 9];
        const winningDigits = stage === 'over1' ? [2, 3, 4, 5, 6, 7, 8, 9] : [0, 1, 2, 3, 4, 5, 6, 7];
        const contractLabel = stage === 'over1' ? 'Over 1' : 'Under 8';
        const symbols = availableSymbolsRef.current.length ? availableSymbolsRef.current : FALLBACK_SYMBOLS;
        notify(`${contractLabel} scan: checking each digit over the last ${AUTOMATED_FREQUENCY_WINDOW} ticks; digits ${lowDigits.join(' and ')} must each be below 10%, then searching the last ${AUTOMATED_TRIGGER_WINDOW} ticks for a trigger digit`);
        try {
            const samples = await Promise.all(symbols.map(async symbol => {
                try {
                    const response: any = await withTimeout(sendViaNewSystemWithPromise({
                        ticks_history: symbol,
                        count: AUTOMATED_FREQUENCY_WINDOW,
                        end: 'latest',
                        style: 'ticks',
                    }), 8000);
                    const prices = response?.history?.prices || [];
                    const digits = prices.slice(-AUTOMATED_FREQUENCY_WINDOW)
                        .map((price: unknown) => manualTradeDigitOf(price, symbol, pipSizesRef.current))
                        .filter((digit: number) => Number.isInteger(digit) && digit >= 0 && digit <= 9);
                    if (digits.length < AUTOMATED_FREQUENCY_WINDOW) return null;
                    updateBuffer(symbol, prices);
                    const { percentages: digitPcts } = calculateDigitPercentages(digits);
                    const trigger = findWinningDigitTrigger(digits.slice(-AUTOMATED_TRIGGER_WINDOW), winningDigits);
                    if (!trigger) return null;
                    const pairPct = lowDigits.reduce((sum, digit) => sum + digitPcts[digit], 0);
                    return { symbol, pairPct, digitPcts, lowDigits, triggerDigit: trigger.triggerDigit, triggerOccurrences: trigger.occurrences, triggerConfidence: trigger.confidence, lastHistoricalDigit: digits.at(-1) as number, lastHistoricalEpoch: Number(response?.history?.times?.at(-1)) || undefined } as QualifiedMarket;
                } catch { return null; }
            }));
            if (!runningRef.current || !automatedRef.current || autoStageRef.current !== stage) return;
            const usable = samples.filter(Boolean) as QualifiedMarket[];
            const qualified = selectAutomatedMarkets(usable, lowDigits);
            notify(`${contractLabel} frequency/trigger scan: ${usable.length ? usable.map(item => `${item.symbol} ${lowDigits.map(digit => `${digit}=${item.digitPcts[digit].toFixed(1)}%`).join(', ')} | trigger ${item.triggerDigit} → winners ${item.triggerOccurrences}/${item.triggerOccurrences}`).join(' | ') : 'no usable samples'}`);
            setQualifiedMarkets(qualified);
            qualifiedMarketsRef.current = new Set(qualified.map(item => item.symbol));
            automatedMarketsRef.current = Object.fromEntries(qualified.map(item => [item.symbol, item]));
            automatedTriggerPendingRef.current = Object.fromEntries(qualified
                .filter(item => item.lastHistoricalDigit === item.triggerDigit)
                .map(item => [item.symbol, item.lastHistoricalEpoch || 0]));
            if (!qualified.length) {
                notify(`${contractLabel}: no volatility passed the low-digit and 30-tick trigger rules; retrying in 5 seconds`);
                setTimeout(() => {
                    if (runningRef.current && automatedRef.current && autoStageRef.current === stage) void scanAutomatedPair(stage);
                }, 5000);
                return;
            }
            setPhaseSafe('automated');
            notify(`${contractLabel}: monitoring ${qualified.map(item => `${labelsRef.current[item.symbol] || item.symbol} (low ${lowDigits.join('/')} <10%, trigger ${item.triggerDigit} → winning digits)`).join(', ')}.`);
        } finally {
            autoScanRunningRef.current = false;
        }
    }, [notify, setAutoStageSafe, setPhaseSafe, updateBuffer]);
    const buy = useCallback(async (symbol: string, contract: string, amount: number, kind: OpenTrade['kind'], barrier?: string, entryEpoch?: number) => {
        if (!runningRef.current || (phaseRef.current === 'settling' && !(kind === 'parity' && recoveryEachTickRef.current))) return;
        const requestSymbol = String(symbol);
        const requestContract = kind === 'parity' ? (contract === 'DIGITEVEN' ? 'DIGITEVEN' : 'DIGITODD') : contract;
        const signal = { symbol: requestSymbol, contract: requestContract, entryEpoch: Number.isFinite(entryEpoch) ? Number(entryEpoch) : undefined };
        if (kind === 'parity') {
            if (recoveryLockedSymbolRef.current && recoveryLockedSymbolRef.current !== requestSymbol) {
                notify(`RECOVERY REQUEST BLOCKED — locked to ${recoveryLockedSymbolRef.current}; ignored ${requestSymbol} ${requestContract}`);
                return;
            }
            if (recoveryBuyInFlightRef.current) return;
            // In settlement-driven recovery, never open a second parity
            // contract while the previous one is still unsettled. Otherwise
            // late wins/losses can change the balance and unlock a different
            // volatility after recovery already appeared complete.
            if (!recoveryEachTickRef.current && Array.from(openRef.current.values()).some(openTrade => openTrade.kind === 'parity')) {
                notify(`RECOVERY REQUEST BLOCKED — previous parity contract is still unsettled; keeping the current volatility lock`);
                return;
            }
            if (recoveryEachTickRef.current && Number.isFinite(entryEpoch)) {
                if (lastRecoveryEntryEpochRef.current === Number(entryEpoch)) return;
                lastRecoveryEntryEpochRef.current = Number(entryEpoch);
            }
            recoveryBuyInFlightRef.current = signal;
        }
        setPhaseSafe('settling');
        const underBarrier = normalStartedRef.current ? '8' : '7';
        const actualBarrier = barrier || (requestContract === 'DIGITUNDER' ? underBarrier : undefined);
        const label = requestContract === 'DIGITEVEN' ? 'EVEN'
            : requestContract === 'DIGITODD' ? 'ODD'
                : requestContract === 'DIGITDIFF' ? `DIFFERS ${actualBarrier}`
                    : requestContract === 'DIGITOVER' ? `OVER ${actualBarrier}` : `UNDER ${actualBarrier || ''}`;
        notify(`TRADE ${label} on ${labelsRef.current[requestSymbol] || requestSymbol} | stake $${amount.toFixed(2)} | signal ${requestSymbol}/${signal.entryEpoch ?? 'live'}`);
        if (kind === 'parity' && recoveryEachTickRef.current && Number.isFinite(entryEpoch)) {
            localParityTradeRef.current = { symbol: requestSymbol, side: requestContract === 'DIGITEVEN' ? 'even' : 'odd', stake: amount, entryEpoch: Number(entryEpoch) };
            localRecoveryCompleteRef.current = false;
        }
        try {
            const request: any = {
                buy: 1,
                price: amount,
                parameters: {
                    amount, basis: 'stake', currency: 'USD', duration: 1, duration_unit: 't', symbol: requestSymbol, contract_type: requestContract,
                    ...(['DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(requestContract) && actualBarrier ? { barrier: actualBarrier } : {}),
                },
            };
            notify(`BUY REQUEST ${request.parameters.contract_type} on ${request.parameters.symbol} | duration 1t | signal ${requestSymbol}/${signal.entryEpoch ?? 'live'}`);
            const response: any = await sendViaNewSystemWithPromise(request);
            const cid = response?.buy?.contract_id ?? response?.contract_id;
            if (!cid) throw new Error('no contract id');
            const acceptedType = response?.buy?.contract_type;
            const acceptedSymbol = response?.buy?.underlying_symbol || response?.buy?.symbol;
            if (acceptedType && acceptedType !== requestContract) notify(`BUY RESPONSE MISMATCH — requested ${requestContract}, accepted ${acceptedType} (contract ${cid})`);
            if (acceptedSymbol && acceptedSymbol !== requestSymbol) notify(`BUY MARKET MISMATCH — requested ${requestSymbol}, accepted ${acceptedSymbol} (contract ${cid})`);
            if (kind === 'under') normalStartedRef.current = true;
            const localKey = Number.isFinite(entryEpoch) ? `${requestSymbol}:${Number(entryEpoch)}` : '';
            openRef.current.set(String(cid), { symbol: requestSymbol, stake: amount, kind, contract: requestContract, autoStage: kind === 'automated' ? autoStageRef.current : undefined, entryEpoch: Number.isFinite(entryEpoch) ? Number(entryEpoch) : undefined, localOutcome: localKey ? localOutcomeByEntryRef.current.get(localKey) : undefined });
            try { transactions.onBotContractEvent({ contract_id: cid, transaction_ids: { buy: response?.buy?.transaction_id }, buy_price: amount, currency: 'USD', contract_type: requestContract, underlying: requestSymbol, display_name: SYMBOL_LABELS[requestSymbol] || requestSymbol, date_start: Math.floor(Date.now() / 1000), status: 'open' } as any); } catch {}
        } catch (error: any) {
            if (kind === 'parity' && localParityTradeRef.current?.entryEpoch === entryEpoch) localParityTradeRef.current = null;
            notify(`BUY ERROR: ${error?.error?.message || error?.message || 'request failed'}`);
            setPhaseSafe(kind === 'parity' ? 'pattern' : kind === 'automated' ? 'automated' : 'normal');
        } finally {
            if (kind === 'parity' && recoveryBuyInFlightRef.current === signal) recoveryBuyInFlightRef.current = null;
        }
    }, [notify, setPhaseSafe, transactions]);
    const handleSettled = useCallback((trade: OpenTrade, profit: number) => {
        const nextSessionProfit = sessionProfitRef.current + profit;
        sessionProfitRef.current = nextSessionProfit;
        setSessionProfit(nextSessionProfit);
        if (!riskTriggeredRef.current) {
            const takeProfitTarget = Math.max(0, Number(takeProfit) || 0);
            const stopLossTarget = Math.max(0, Number(stopLoss) || 0);
            const hitTakeProfit = takeProfitTarget > 0 && nextSessionProfit >= takeProfitTarget;
            const hitStopLoss = stopLossTarget > 0 && nextSessionProfit <= -stopLossTarget;
            if (hitTakeProfit || hitStopLoss) {
                const kind = hitTakeProfit ? 'take-profit' : 'stop-loss';
                riskTriggeredRef.current = true;
                setRiskAlert({ kind, amount: nextSessionProfit });
                notify(`${kind === 'take-profit' ? 'TAKE PROFIT HIT' : 'STOP LOSS HIT'} — realized P/L ${nextSessionProfit >= 0 ? '+' : ''}$${nextSessionProfit.toFixed(2)} (threshold $${(kind === 'take-profit' ? takeProfitTarget : stopLossTarget).toFixed(2)})`);
                runningRef.current = false;
                setRunning(false);
                setPhaseSafe('idle');
                localParityTradeRef.current = null;
                openRef.current.clear();
                return;
            }
        }
        // Recovery-each-tick already made the loss decision locally. The later
        // proposal_open_contract event is informational for that loss and must
        // not add the same loss or advance the martingale a second time.
        if (trade.kind === 'parity' && trade.localOutcome === 'loss') {
            notify(`OFFICIAL SETTLEMENT CONFIRMED LOCAL LOSS ${trade.contract} ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} — recovery state unchanged`);
            return;
        }
        const won = profit >= 0;
        if (trade.kind === 'parity') localRecoveryCompleteRef.current = false;
        notify(`${won ? 'WIN' : 'LOSS'} ${trade.contract} ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`);
        if (won) {
            if (trade.kind === 'parity') {
                const remaining = Math.max(0, lossRef.current - profit);
                lossRef.current = remaining; setLossBalance(remaining);
                if (remaining <= 0.0001) {
                    recoveryArmedRef.current = false; recoveryNeedsFreshScanRef.current = false; recoveryLockedSymbolRef.current = null; lossStreakRef.current = 0;
                    selectedRef.current = null; setSelected(null);
                    currentStakeRef.current = Number(stakeRef.current) || 0.35; setCurrentStake(currentStakeRef.current);
                    if (automatedRef.current) {
                        setAutoStageSafe('differs'); setQualifiedMarkets([]); qualifiedMarketsRef.current = new Set();
                        automatedMarketsRef.current = {}; automatedTriggerPendingRef.current = {}; digitStreaksRef.current = {};
                        setPhaseSafe('automated');
                        notify('RECOVERY COMPLETE — automated sequence resumes at Digit Differs');
                    } else {
                        notify('RECOVERY COMPLETE — returning to normal Under 8');
                        setPhaseSafe('normal');
                    }
                }
                else {
                    lossStreakRef.current = 0;
                    // A partial recovery must not immediately reuse the same
                    // Even/Odd signal. Clear the market and force a fresh scan
                    // plus the normal opposite-digit entry pattern again.
                    currentStakeRef.current = Number(stakeRef.current) || 0.35;
                    setCurrentStake(currentStakeRef.current);
                    selectedRef.current = null;
                    setSelected(null);
                    oppositeRef.current = 0;
                    recoveryArmedRef.current = false;
                    localRecoveryCompleteRef.current = false;
                    freshRecoveryPatternRef.current = true;
                    setPhaseSafe('scanning');
                    recoveryNeedsFreshScanRef.current = true;
                    recoveryLockedSymbolRef.current = null;
                    notify(`RECOVERY WIN BUT BALANCE REMAINS $${remaining.toFixed(2)} | next recovery stake reset to base $${currentStakeRef.current.toFixed(2)} | rescanning volatility and waiting for a fresh entry pattern`);
                    void scanRecovery();
                }
            } else if (trade.kind === 'automated') {
                lossStreakRef.current = 0;
                normalCountRef.current++; setNormalCount(normalCountRef.current);
                currentStakeRef.current = Number(stakeRef.current) || 0.35; setCurrentStake(currentStakeRef.current);
                const nextStage = nextAutomatedStage(trade.autoStage || autoStageRef.current) as AutoStage;
                setAutoStageSafe(nextStage);
                setQualifiedMarkets([]); qualifiedMarketsRef.current = new Set(); automatedMarketsRef.current = {}; automatedTriggerPendingRef.current = {};
                digitStreaksRef.current = {};
                if (nextStage === 'differs') {
                    setPhaseSafe('automated');
                    notify('UNDER 8 complete — restarting automated sequence at Digit Differs');
                } else {
                    notify(`${trade.contract} won — advancing to ${nextStage === 'over1' ? 'Over 1' : 'Under 8'}`);
                    void scanAutomatedPair(nextStage);
                }
            } else {
                lossStreakRef.current = 0; normalCountRef.current++; setNormalCount(normalCountRef.current);
                currentStakeRef.current = Number(stakeRef.current) || 0.35; setCurrentStake(currentStakeRef.current); setPhaseSafe('normal');
            }
        } else {
            const loss = Math.max(trade.stake, Math.abs(profit));
            lossRef.current += loss; lossStreakRef.current += 1; setLossBalance(lossRef.current);
            currentStakeRef.current = recoveryStake(trade.stake); setCurrentStake(currentStakeRef.current);
            notify(`LOSS ACCUMULATED $${loss.toFixed(2)} | outstanding $${lossRef.current.toFixed(2)} | last stake $${trade.stake.toFixed(2)} ×${Number(martingale) || 2} | next stake $${currentStakeRef.current.toFixed(2)}`);
            if (trade.kind === 'parity' && selectedRef.current) {
                // Hold the selected volatility and keep the recovery contract armed.
                recoveryArmedRef.current = true;
                oppositeRef.current = 0;
                setPhaseSafe('pattern');
                notify(`RECOVERY CONTINUES on ${labelsRef.current[selectedRef.current.symbol] || selectedRef.current.symbol} — pattern gate bypassed; next ${selectedRef.current.side.toUpperCase()} tick will execute`);
            } else if (trade.kind === 'automated') {
                selectedRef.current = null; setSelected(null); oppositeRef.current = 0; recoveryArmedRef.current = false; recoveryLockedSymbolRef.current = null;
                setAutoStageSafe('differs'); setQualifiedMarkets([]); qualifiedMarketsRef.current = new Set();
                automatedMarketsRef.current = {}; automatedTriggerPendingRef.current = {}; digitStreaksRef.current = {};
                notify(`AUTOMATED ${trade.autoStage || 'stage'} lost — entering Even/Odd recovery; automation will resume at Differs after recovery`);
                void scanRecovery();
            } else {
                selectedRef.current = null;
                setSelected(null);
                oppositeRef.current = 0;
                recoveryLockedSymbolRef.current = null;
                notify('NEW NORMAL LOSS — clearing the previous volatility and starting a fresh live recovery scan');
                void scanRecovery();
            }
        }
    }, [martingale, notify, recoveryStake, scanAutomatedPair, scanRecovery, setAutoStageSafe, setPhaseSafe, stopLoss, takeProfit]);
    useEffect(() => {
        if (!running) return;
        const unsubscribe = onNewSystemMessage((event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if ((data.msg_type === 'history' || data.msg_type === 'ticks_history') && data.history?.prices) updateBuffer(data.echo_req?.ticks_history, data.history.prices);
                if (data.msg_type === 'tick' && data.tick?.symbol) {
                    const sym = data.tick.symbol;
                    const tickEpoch = Number(data.tick.epoch);
                    if (!Number.isFinite(tickEpoch)) return;
                    const quote = String(data.tick.quote);
                    const tickId = data.tick.id == null ? '' : String(data.tick.id);
                    const tickKey = `${tickId}|${tickEpoch}|${quote}`;
                    const processedKeys = processedTickKeysRef.current[sym] || new Set<string>();
                    if (processedKeys.has(tickKey)) return;
                    processedKeys.add(tickKey);
                    // Bound memory while retaining enough recent keys to
                    // reject duplicate history/live messages.
                    if (processedKeys.size > 250) {
                        const oldest = processedKeys.values().next().value;
                        if (oldest) processedKeys.delete(oldest);
                    }
                    processedTickKeysRef.current[sym] = processedKeys;
                    const digit = manualTradeDigitOf(data.tick.quote, sym, pipSizesRef.current); const buf = buffersRef.current[sym] || [];
                    buffersRef.current[sym] = [...buf, digit].slice(-1000);
                    if (sym === normalSymbolRef.current || (automatedRef.current && (autoStageRef.current === 'differs' || qualifiedMarketsRef.current.has(sym)))) setLastDigit(digit);
                    const localParityTrade = localParityTradeRef.current;
                    if (recoveryEachTickRef.current && localParityTrade && localParityTrade.symbol === sym && tickEpoch > localParityTrade.entryEpoch) {
                        const localWin = localParityTrade.side === 'even' ? isEven(digit) : !isEven(digit);
                        const localKey = `${sym}:${localParityTrade.entryEpoch}`;
                        localOutcomeByEntryRef.current.set(localKey, localWin ? 'win' : 'loss');
                        for (const [contractId, openTrade] of openRef.current.entries()) {
                            if (openTrade.kind === 'parity' && openTrade.symbol === sym && openTrade.entryEpoch === localParityTrade.entryEpoch) {
                                openRef.current.set(contractId, { ...openTrade, localOutcome: localWin ? 'win' : 'loss' });
                                break;
                            }
                        }
                        localParityTradeRef.current = null;
                        notify(`LOCAL ${localWin ? 'WIN' : 'LOSS'} — entry tick ${localParityTrade.entryEpoch}, exit tick ${tickEpoch}, digit ${digit} is ${isEven(digit) ? 'EVEN' : 'ODD'} | ${localParityTrade.side.toUpperCase()} target`);
                        if (localWin) {
                            localRecoveryCompleteRef.current = true;
                            recoveryArmedRef.current = false;
                            selectedRef.current = null;
                            setSelected(null);
                            oppositeRef.current = 0;
                            recoveryNeedsFreshScanRef.current = true;
                            setPhaseSafe('settling');
                            notify('LOCAL RECOVERY WIN — waiting for official settlement before deciding whether a fresh volatility scan is required');
                        } else {
                            lossRef.current += Math.max(localParityTrade.stake, localParityTrade.stake);
                            setLossBalance(lossRef.current);
                            recoveryArmedRef.current = true;
                            currentStakeRef.current = recoveryStake(localParityTrade.stake);
                            setCurrentStake(currentStakeRef.current);
                            setPhaseSafe('pattern');
                            void buy(sym, parityContractFor(localParityTrade.side), currentStakeRef.current, 'parity', undefined, tickEpoch);
                        }
                    }
                    if (automatedRef.current && phaseRef.current === 'automated') {
                        const stage = autoStageRef.current;
                        if (stage === 'differs') {
                            const previous = digitStreaksRef.current[sym];
                            const streak = previous?.digit === digit ? previous.count + 1 : 1;
                            digitStreaksRef.current[sym] = { digit, count: streak };
                            if (streak >= 3) {
                                notify(`${labelsRef.current[sym] || sym}: digit ${digit} has repeated ${streak} live ticks — buying Digit Differs ${digit}`);
                                void buy(sym, 'DIGITDIFF', currentStakeRef.current, 'automated', String(digit));
                            }
                        } else if (qualifiedMarketsRef.current.has(sym)) {
                            const market = automatedMarketsRef.current[sym];
                            if (!market || market.symbol !== sym) {
                                notify(`AUTOMATED LIVE IGNORED — no active market record for ${sym}`);
                                return;
                            }
                            const pendingTriggerEpoch = automatedTriggerPendingRef.current[sym];
                            const winning = stage === 'over1' ? digit >= 2 : digit <= 7;
                            if (pendingTriggerEpoch !== undefined && (pendingTriggerEpoch === 0 || tickEpoch > pendingTriggerEpoch)) {
                                delete automatedTriggerPendingRef.current[sym];
                                if (winning) {
                                    notify(`${labelsRef.current[sym] || sym}: LIVE ${sym} quote ${String(data.tick.quote)} → digit ${digit} at epoch ${tickEpoch}; trigger ${market.triggerDigit} followed immediately by winning digit — buying ${stage === 'over1' ? 'Over 1' : 'Under 8'} on ${sym}`);
                                    void buy(sym, stage === 'over1' ? 'DIGITOVER' : 'DIGITUNDER', currentStakeRef.current, 'automated', stage === 'over1' ? '1' : '8');
                                } else {
                                    notify(`${labelsRef.current[sym] || sym}: LIVE ${sym} quote ${String(data.tick.quote)} → digit ${digit} at epoch ${tickEpoch}; trigger ${market.triggerDigit} was not followed by a winning digit; waiting for the next trigger`);
                                    notify(`${labelsRef.current[sym] || sym}: reanalyzing the updated 1,000/30-tick window for a new trigger on ${sym}`);
                                    void scanAutomatedPair(stage);
                                }
                            }
                            if (pendingTriggerEpoch === undefined && digit === market.triggerDigit) {
                                automatedTriggerPendingRef.current[sym] = tickEpoch;
                                notify(`${labelsRef.current[sym] || sym}: LIVE ${sym} quote ${String(data.tick.quote)} → digit ${digit} at epoch ${tickEpoch}; trigger digit touched — checking the next live tick for ${stage === 'over1' ? '2–9' : '0–7'}`);
                            }
                        }
                    }
                    if (!automatedRef.current && allVolatilityPatternRef.current && !recoveryLockedSymbolRef.current && phaseRef.current === 'pattern' && lossRef.current > 0) {
                        const side: Side = isEven(digit) ? 'even' : 'odd';
                        const previous = allVolatilityStreaksRef.current[sym];
                        const count = previous?.side === side ? previous.count + 1 : 1;
                        allVolatilityStreaksRef.current[sym] = { side, count };
                        const required = Math.max(1, Math.min(100, Number(oppositeTriggerRef.current) || 5));
                        if (count >= required) {
                            const buf = (buffersRef.current[sym] || []).slice(-RECOVERY_SAMPLE_SIZE);
                            const counts = Array(10).fill(0);
                            buf.forEach(value => { counts[value]++; });
                            const digitPcts = counts.map(value => value / Math.max(1, buf.length) * 100);
                            const topDigits = [...Array(10).keys()].sort((a, b) => digitPcts[b] - digitPcts[a]);
                            const tradeSide = oppositeSide(side);
                            const pick: RecoveryPick = {
                                symbol: sym,
                                side: tradeSide,
                                evenPct: digitPcts.filter((_, index) => isEven(index)).reduce((sum, value) => sum + value, 0),
                                oddPct: digitPcts.filter((_, index) => !isEven(index)).reduce((sum, value) => sum + value, 0),
                                digitPcts,
                                topDigits,
                                losingTopCount: 0,
                                trailingOpposite: 0,
                                lastEpoch: tickEpoch,
                            };
                            recoveryLockedSymbolRef.current = sym;
                            selectedRef.current = pick;
                            setSelected(pick);
                            allVolatilityStreaksRef.current = {};
                            recoveryArmedRef.current = true;
                            notify(`RECOVERY PATTERN LOCKED ${labelsRef.current[sym] || sym}: ${count} consecutive ${side.toUpperCase()} ticks on live ${sym}; executing ${tradeSide.toUpperCase()} only on this volatility`);
                            void buy(sym, parityContractFor(tradeSide), currentStakeRef.current, 'parity', undefined, tickEpoch);
                        }
                    }
                    if (sym === selectedRef.current?.symbol) {
                        const pick = selectedRef.current; const target = pick.side === 'even' ? isEven(digit) : !isEven(digit);
                        const ds = buffersRef.current[sym].slice(-RECOVERY_SAMPLE_SIZE); const ep = ds.filter(isEven).length / Math.max(1, ds.length) * 100;
                        setLastDigit(digit);
                        setEvenPct(ep); setOddPct(100 - ep);
                        const targetPct = pick.side === 'even' ? ep : 100 - ep;
                        if (phaseRef.current === 'pattern' && !localParityTradeRef.current && targetPct < 54) {
                            notify(`RECOVERY PARITY WEAKENED — ${pick.side.toUpperCase()} is ${targetPct.toFixed(1)}%, below 54%; rescanning all volatility indices for a closer/stronger 60% candidate`);
                            selectedRef.current = null;
                            setSelected(null);
                            recoveryArmedRef.current = false;
                            oppositeRef.current = 0;
                            localRecoveryCompleteRef.current = false;
                            void scanRecovery();
                        }
                        if (phaseRef.current === 'pattern' && !localRecoveryCompleteRef.current && !recoveryNeedsFreshScanRef.current) {
                            const executionSide: Side = allVolatilityPatternRef.current ? pick.side : recoveryEntrySide(pick.side);
                            if (recoveryArmedRef.current) {
                                notify(`RECOVERY TICK ${digit} | even ${ep.toFixed(1)}% / odd ${(100 - ep).toFixed(1)}% | recovery armed — executing ${executionSide.toUpperCase()}`);
                                oppositeRef.current = 0;
                                void buy(sym, parityContractFor(executionSide), currentStakeRef.current, 'parity', undefined, tickEpoch);
                            } else if (oppositeRef.current >= oppositeTriggerRef.current) {
                                recoveryArmedRef.current = true;
                                notify(`RECOVERY TRIGGER | ${oppositeTriggerRef.current} opposite digits already confirmed | entering ${executionSide.toUpperCase()} immediately`);
                                oppositeRef.current = 0;
                                void buy(sym, parityContractFor(executionSide), currentStakeRef.current, 'parity', undefined, tickEpoch);
                            } else if (!target) {
                                oppositeRef.current++;
                                if (oppositeRef.current >= oppositeTriggerRef.current) {
                                    recoveryArmedRef.current = true;
                                    notify(`RECOVERY TRIGGER ${digit} | ${oppositeRef.current} opposite digits complete | entering ${executionSide.toUpperCase()} immediately`);
                                    oppositeRef.current = 0;
                                    void buy(sym, parityContractFor(executionSide), currentStakeRef.current, 'parity', undefined, tickEpoch);
                                } else {
                                    notify(`RECOVERY TICK ${digit} = OPPOSITE | even ${ep.toFixed(1)}% / odd ${(100 - ep).toFixed(1)}% | opposite ${oppositeRef.current}/${oppositeTriggerRef.current}`);
                                }
                            } else {
                                oppositeRef.current = 0;
                                notify(`RECOVERY TICK ${digit} = TARGET | even ${ep.toFixed(1)}% / odd ${(100 - ep).toFixed(1)}% | pattern reset`);
                            }
                        }
                    }
                    if (phaseRef.current === 'entry' && sym === normalSymbolRef.current && digit === entryDigitRef.current) { notify(`ENTRY DIGIT ${digit} CONFIRMED — Under 7`); void buy(sym, 'DIGITUNDER', currentStakeRef.current, 'under'); }
                }
                if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract?.is_sold) {
                    const cid = String(data.proposal_open_contract.contract_id); const trade = openRef.current.get(cid); if (!trade) return;
                    openRef.current.delete(cid); handleSettled(trade, Number(data.proposal_open_contract.profit) || 0);
                }
            } catch {}
        });
        return unsubscribe;
    }, [buy, handleSettled, notify, running, scanAutomatedPair, scanRecovery, updateBuffer]);
    useEffect(() => {
        if (!running) return;
        if (automatedRef.current) {
            (availableSymbolsRef.current.length ? availableSymbolsRef.current : FALLBACK_SYMBOLS)
                .forEach(symbol => sendTickSubscription(symbol, AUTOMATED_FREQUENCY_WINDOW));
        } else {
            sendTickSubscription(normalSymbolRef.current, 200);
        }
    }, [running, automated, availableSymbols, sendTickSubscription]);
    useEffect(() => { void loadActiveSymbols(); }, [loadActiveSymbols]);
    useEffect(() => { normalSymbolRef.current = normalSymbol; automatedRef.current = automated; recoveryEachTickRef.current = recoveryEachTick; allVolatilityPatternRef.current = allVolatilityPattern; tradeOppositeParityRef.current = tradeOppositeParity; oppositeTriggerRef.current = Math.max(1, Math.min(100, Number(oppositeTrigger) || 5)); localStorage.setItem('mw_ueo_stake', stake); localStorage.setItem('mw_ueo_entry', entryDigit); localStorage.setItem('mw_ueo_martingale', martingale); localStorage.setItem('mw_ueo_take_profit', takeProfit); localStorage.setItem('mw_ueo_stop_loss', stopLoss); localStorage.setItem('mw_ueo_market', normalSymbol); localStorage.setItem('mw_ueo_automated', String(automated)); localStorage.setItem('mw_ueo_recovery_each_tick', String(recoveryEachTick)); localStorage.setItem('mw_ueo_opposite_trigger', String(oppositeTriggerRef.current)); localStorage.setItem('mw_ueo_all_volatility_pattern', String(allVolatilityPattern)); localStorage.setItem('mw_ueo_trade_opposite_parity', String(tradeOppositeParity)); }, [stake, entryDigit, martingale, takeProfit, stopLoss, normalSymbol, automated, recoveryEachTick, oppositeTrigger, allVolatilityPattern, tradeOppositeParity]);
    useEffect(() => {
        if (!running || phase !== 'normal') return;
        if (runningRef.current) void buy(normalSymbolRef.current, 'DIGITUNDER', currentStakeRef.current, 'under');
    }, [normalCount, phase, running, buy]);
    const start = () => {
        const amount = Math.max(0.35, Number(stake) || 0.35); stakeRef.current = amount; entryDigitRef.current = Math.min(9, Math.max(0, Number(entryDigit) || 2));
        normalSymbolRef.current = normalSymbol; oppositeTriggerRef.current = Math.max(1, Math.min(100, Number(oppositeTrigger) || 5)); normalStartedRef.current = false; normalCountRef.current = 0; lossRef.current = 0; lossStreakRef.current = 0; sessionProfitRef.current = 0; riskTriggeredRef.current = false; currentStakeRef.current = amount; buffersRef.current = {}; openRef.current.clear(); localOutcomeByEntryRef.current.clear(); recoveryBuyInFlightRef.current = null; selectedRef.current = null; oppositeRef.current = 0; freshRecoveryPatternRef.current = false; recoveryNeedsFreshScanRef.current = false; recoveryLockedSymbolRef.current = null; recoveryArmedRef.current = false;
        automatedRef.current = automated;
        digitStreaksRef.current = {}; automatedMarketsRef.current = {}; automatedTriggerPendingRef.current = {}; allVolatilityStreaksRef.current = {}; processedTickKeysRef.current = {}; automatedTickIndexRef.current = {}; qualifiedMarketsRef.current = new Set(); localParityTradeRef.current = null; localRecoveryCompleteRef.current = false; lastRecoveryEntryEpochRef.current = null;
        setQualifiedMarkets([]); setAutoStageSafe('differs');
        setNormalCount(0); setLossBalance(0); setSessionProfit(0); setRiskAlert(null); setCurrentStake(amount); setSelected(null); setLastDigit(null); runningRef.current = true; setRunning(true);
        if (automated) {
            setPhaseSafe('automated');
            notify(`STARTED AUTOMATED — ignoring manual entry digit and volatility; monitoring all indices for three-repeat Digit Differs signals`);
        } else {
            setPhaseSafe('entry');
            notify(`STARTED — waiting for entry digit ${entryDigitRef.current} on ${SYMBOL_LABELS[normalSymbol] || normalSymbol}; then Under 7 → Under 8`);
        }
    };
    const stop = () => { runningRef.current = false; setRunning(false); setPhaseSafe('idle'); openRef.current.clear(); localParityTradeRef.current = null; localOutcomeByEntryRef.current.clear(); recoveryBuyInFlightRef.current = null; localRecoveryCompleteRef.current = false; lastRecoveryEntryEpochRef.current = null; processedTickKeysRef.current = {}; allVolatilityStreaksRef.current = {}; freshRecoveryPatternRef.current = false; recoveryNeedsFreshScanRef.current = false; recoveryLockedSymbolRef.current = null; selectedRef.current = null; setSelected(null); qualifiedMarketsRef.current = new Set(); automatedMarketsRef.current = {}; automatedTriggerPendingRef.current = {}; digitStreaksRef.current = {}; automatedTickIndexRef.current = {}; setQualifiedMarkets([]); notify('STOPPED'); };
    return <div className='mw-killer even-odd-theme'>
        <div className='mw-killer__fields'>
            <div className='mw-field mw-field--grow'><label className='mw-label'>Normal volatility</label><select className='mw-input' value={normalSymbol} onChange={e => setNormalSymbol(e.target.value)} disabled={running || automated}>{availableSymbols.map(symbol => <option key={symbol} value={symbol}>{labelsRef.current[symbol] || SYMBOL_LABELS[symbol] || symbol}</option>)}</select></div>
            <div className='mw-field mw-field--grow'><label className='mw-label'>Initial stake</label><input className='mw-input' type='number' min='0.35' step='0.01' value={stake} onChange={e => setStake(e.target.value)} disabled={running} /></div>
            <div className='mw-field mw-field--grow'><label className='mw-label'>Martingale multiplier</label><input className='mw-input' type='number' min='1' step='0.1' value={martingale} onChange={e => setMartingale(e.target.value)} disabled={running} /></div>
            <div className='mw-field mw-field--grow'><label className='mw-label'>Take profit ($)</label><input className='mw-input' type='number' min='0' step='0.01' placeholder='0 = off' value={takeProfit} onChange={e => setTakeProfit(e.target.value)} disabled={running} /></div>
            <div className='mw-field mw-field--grow'><label className='mw-label'>Stop loss ($)</label><input className='mw-input' type='number' min='0' step='0.01' placeholder='0 = off' value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={running} /></div>
            <div className='mw-field mw-field--grow mw-ueo-entry-field'>
                <label className='mw-label' htmlFor='mw-ueo-entry-digit'>Entry digit</label>
                <div className='mw-ueo-entry-controls'>
                    <input id='mw-ueo-entry-digit' className='mw-input' type='number' min='1' max='9' step='1' value={entryDigit} onChange={e => setEntryDigit(e.target.value)} disabled={running || automated} />
                    <div className='mw-ueo-auto-toggle'>
                        <span id='mw-ueo-auto-label'>Automated</span>
                        <button type='button' role='switch' aria-checked={automated} aria-labelledby='mw-ueo-auto-label' className='mw-toggle mw-ueo-auto-toggle__button' disabled={running} onClick={() => setAutomated(value => !value)} title='Scan volatility indices and run the automatic contract sequence'>
                            <span className={`mw-toggle__track ${automated ? 'mw-toggle__track--on' : ''}`}><span className={`mw-toggle__thumb ${automated ? 'mw-toggle__thumb--on' : ''}`} /></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
        <div className='mw-ueo-recovery-row'>
            <div className='mw-field mw-field--grow'>
                <label className='mw-label' htmlFor='mw-ueo-opposite-trigger'>Opposite digits before recovery</label>
                <input id='mw-ueo-opposite-trigger' className='mw-input' type='number' min='1' max='100' step='1' value={oppositeTrigger} onChange={e => setOppositeTrigger(e.target.value)} disabled={running} />
            </div>
            <div className='mw-ueo-switch-list'>
                <div className='mw-ueo-setting-row'>
                    <button type='button' className='mw-ueo-help' aria-label='Explain Recovery each tick' onClick={() => setSwitchHelp(switchHelp === 'each-tick' ? null : 'each-tick')}>?</button>
                    <div className='mw-ueo-auto-toggle'>
                        <span id='mw-ueo-recovery-tick-label'>Recovery each tick</span>
                        <button type='button' role='switch' aria-checked={recoveryEachTick} aria-labelledby='mw-ueo-recovery-tick-label' className='mw-toggle mw-ueo-auto-toggle__button' disabled={running} onClick={() => setRecoveryEachTick(value => !value)}>
                            <span className={`mw-toggle__track ${recoveryEachTick ? 'mw-toggle__track--on' : ''}`}><span className={`mw-toggle__thumb ${recoveryEachTick ? 'mw-toggle__thumb--on' : ''}`} /></span>
                        </button>
                    </div>
                    {switchHelp === 'each-tick' && <span className='mw-ueo-help-text'>After the opposite-tick gate, evaluate the next tick locally instead of waiting for Deriv settlement.</span>}
                </div>
                <div className='mw-ueo-setting-row'>
                    <button type='button' className='mw-ueo-help' aria-label='Explain all-volatility parity pattern' onClick={() => setSwitchHelp(switchHelp === 'all-volatility' ? null : 'all-volatility')}>?</button>
                    <div className='mw-ueo-auto-toggle'>
                        <span id='mw-ueo-all-volatility-label'>All-volatility parity pattern</span>
                        <button type='button' role='switch' aria-checked={allVolatilityPattern} aria-labelledby='mw-ueo-all-volatility-label' className='mw-toggle mw-ueo-auto-toggle__button' disabled={running} onClick={() => setAllVolatilityPattern(value => !value)}>
                            <span className={`mw-toggle__track ${allVolatilityPattern ? 'mw-toggle__track--on' : ''}`}><span className={`mw-toggle__thumb ${allVolatilityPattern ? 'mw-toggle__thumb--on' : ''}`} /></span>
                        </button>
                    </div>
                    {switchHelp === 'all-volatility' && <span className='mw-ueo-help-text'>Watch every volatility at once; the first market reaching the parity streak is locked and used for the trade.</span>}
                </div>
                <div className='mw-ueo-setting-row'>
                    <button type='button' className='mw-ueo-help' aria-label='Explain trade opposite parity' onClick={() => setSwitchHelp(switchHelp === 'opposite-parity' ? null : 'opposite-parity')}>?</button>
                    <div className='mw-ueo-auto-toggle'>
                        <span id='mw-ueo-opposite-parity-label'>Trade opposite parity</span>
                        <button type='button' role='switch' aria-checked={tradeOppositeParity} aria-labelledby='mw-ueo-opposite-parity-label' className='mw-toggle mw-ueo-auto-toggle__button' disabled={running} onClick={() => setTradeOppositeParity(value => !value)}>
                            <span className={`mw-toggle__track ${tradeOppositeParity ? 'mw-toggle__track--on' : ''}`}><span className={`mw-toggle__thumb ${tradeOppositeParity ? 'mw-toggle__thumb--on' : ''}`} /></span>
                        </button>
                    </div>
                    {switchHelp === 'opposite-parity' && <span className='mw-ueo-help-text'>After the configured opposite-tick threshold, trade that opposite parity instead of the scanned target parity.</span>}
                </div>
            </div>
        </div>
        <div className='mw-analyze-result' style={{ display: 'block' }}>
            <b>UNDER → EVEN/ODD AUTO</b>
            <div>Live digit: <strong>{lastDigit ?? '—'}</strong></div>
            <div>Current state: <strong>{running ? phase.toUpperCase() : 'STOPPED'}</strong></div>
        </div>
        {riskAlert && <div className={`mw-ueo-risk-alert mw-ueo-risk-alert--${riskAlert.kind}`} role='alert'>
            <strong>{riskAlert.kind === 'take-profit' ? 'TAKE PROFIT HIT' : 'STOP LOSS HIT'}</strong>
            <span>Realized P/L: {riskAlert.amount >= 0 ? '+' : ''}${riskAlert.amount.toFixed(2)}</span>
            <button type='button' onClick={() => setRiskAlert(null)} aria-label='Dismiss risk alert'>Dismiss</button>
        </div>}
        <div className='mw-killer__actions'>{running ? <button className='mw-btn mw-btn--stop' onClick={stop}>STOP · {phase.toUpperCase()}</button> : <button className='mw-btn mw-btn--run' onClick={start}>{automated ? 'RUN AUTOMATED CYCLE' : 'RUN UNDER → EVEN/ODD'}</button>}</div>
        <div className='mw-killer__logs'><div className='mw-killer__logs-head'>Automation log</div><div className='mw-killer__log-list'>{logs.length ? logs.map((line, i) => <div key={i} className='mw-killer__log-line'>{line}</div>) : <div className='mw-killer__log-empty'>Select a mode, configure stake, and run</div>}</div></div>
    </div>;
};
