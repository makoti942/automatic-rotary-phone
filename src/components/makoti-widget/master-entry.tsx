import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onNewSystemMessage, sendViaNewSystemWithPromise } from '@/auth/NewDerivAuth';
import { useStore } from '@/hooks/useStore';
import { ALL_SYMBOLS, PIP_SIZES, SYMBOL_LABELS, calcEMA } from './makoti-ws';

type Direction = 'rise' | 'fall';
type Phase = 'idle' | 'scanning' | 'waiting' | 'locked' | 'stopped';

type Candidate = {
    symbol: string;
    direction: Direction;
    risePct: number;
    fallPct: number;
    prices: number[];
    lastMacd: number;
    lastSignal: number;
    lastHistogram: number;
    status: 'qualified' | 'locked';
};

type OpenTrade = {
    symbol: string;
    direction: Direction;
    stake: number;
    entryEpoch: number;
    entryQuote: number;
    contractId: string;
    locallySettled?: boolean;
    localOutcome?: 'win' | 'loss';
    officialSettled?: boolean;
};

type PendingRecovery = {
    symbol: string;
    direction: Direction;
    stake: number;
    afterEpoch: number;
};

const HISTORY_COUNT = 100;
const MIN_STAKE = 0.35;
const MIN_MACD_PRICES = 40;

const quoteNumber = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

const calculateTrend = (prices: number[]) => {
    let rises = 0;
    let falls = 0;
    for (let i = 1; i < prices.length; i += 1) {
        if (prices[i] > prices[i - 1]) rises += 1;
        else if (prices[i] < prices[i - 1]) falls += 1;
    }
    const total = rises + falls || 1;
    return { risePct: rises / total * 100, fallPct: falls / total * 100 };
};

const macdSnapshot = (prices: number[]) => {
    if (prices.length < MIN_MACD_PRICES) return null;
    const fast = calcEMA(prices, 12);
    const slow = calcEMA(prices, 26);
    if (fast.length < 14 || slow.length < 14) return null;
    const offset = fast.length - slow.length;
    const macdLine = slow.map((value, index) => fast[index + offset] - value);
    const signalLine = calcEMA(macdLine, 9);
    if (signalLine.length < 2) return null;
    const macdOffset = macdLine.length - signalLine.length;
    const currentMacd = macdLine[macdLine.length - 1];
    const previousMacd = macdLine[macdLine.length - 2];
    const currentSignal = signalLine[signalLine.length - 1];
    const previousSignal = signalLine[signalLine.length - 2];
    const histogram = currentMacd - currentSignal;
    const previousHistogram = previousMacd - previousSignal;
    return {
        currentMacd,
        previousMacd,
        currentSignal,
        previousSignal,
        histogram,
        previousHistogram,
        crossUp: previousMacd <= previousSignal && currentMacd > currentSignal,
        crossDown: previousMacd >= previousSignal && currentMacd < currentSignal,
        // Keep the offset read explicit so the calculation remains easy to audit.
        signalStart: macdOffset,
    };
};

const digitPrecision = (symbol: string) => PIP_SIZES[symbol] || 2;

export const MasterEntry: React.FC = () => {
    const { transactions } = useStore();
    const [stake, setStake] = useState(() => localStorage.getItem('mw_master_stake') || '0.35');
    const [martingale, setMartingale] = useState(() => localStorage.getItem('mw_master_martingale') || '2');
    const [everyTick, setEveryTick] = useState(() => localStorage.getItem('mw_master_every_tick') !== 'false');
    const [running, setRunning] = useState(false);
    const [phase, setPhase] = useState<Phase>('idle');
    const [candidates, setCandidates] = useState<Candidate[]>([]);
    const [lockedSymbol, setLockedSymbol] = useState<string | null>(null);
    const [currentStake, setCurrentStake] = useState(Number(stake) || MIN_STAKE);
    const [sessionProfit, setSessionProfit] = useState(0);
    const [logs, setLogs] = useState<string[]>([]);
    const [lastSignal, setLastSignal] = useState('—');

    const runningRef = useRef(false);
    const everyTickRef = useRef(everyTick);
    const stakeRef = useRef(Number(stake) || MIN_STAKE);
    const martingaleRef = useRef(Number(martingale) || 2);
    const currentStakeRef = useRef(Number(stake) || MIN_STAKE);
    const pricesRef = useRef<Record<string, number[]>>({});
    const candidatesRef = useRef<Record<string, Candidate>>({});
    const lockedSymbolRef = useRef<string | null>(null);
    const openTradeRef = useRef<OpenTrade | null>(null);
    const pendingSettlementsRef = useRef<Map<string, OpenTrade>>(new Map());
    const unlockAfterSettlementsRef = useRef(false);
    const pendingRecoveryRef = useRef<PendingRecovery | null>(null);
    const awaitingLocalResultRef = useRef<OpenTrade | null>(null);
    const localWinCountRef = useRef(0);
    const rescanRequestedRef = useRef(false);
    const initializeRef = useRef<(() => void | Promise<void>) | null>(null);
    const buyInFlightRef = useRef(false);
    const processedTicksRef = useRef<Record<string, Set<string>>>({});
    const logsRef = useRef<string[]>([]);

    const addLog = useCallback((message: string) => {
        const line = `${new Date().toLocaleTimeString()} ${message}`;
        logsRef.current = [...logsRef.current.slice(-99), line];
        setLogs(logsRef.current);
    }, []);

    const setLock = useCallback((symbol: string | null) => {
        lockedSymbolRef.current = symbol;
        setLockedSymbol(symbol);
        setPhase(symbol ? 'locked' : 'waiting');
    }, []);

    const publishCandidates = useCallback(() => {
        setCandidates(Object.values(candidatesRef.current));
    }, []);

    const localSettle = useCallback((trade: OpenTrade, exitEpoch: number, exitQuote: number) => {
        if (trade.locallySettled || exitEpoch <= trade.entryEpoch) return;
        const won = trade.direction === 'rise' ? exitQuote > trade.entryQuote : exitQuote < trade.entryQuote;
        trade.locallySettled = true;
        trade.localOutcome = won ? 'win' : 'loss';
        addLog(`LOCAL ${won ? 'WIN' : 'LOSS'} · ${SYMBOL_LABELS[trade.symbol] || trade.symbol} · ${trade.direction.toUpperCase()} · exit tick ${exitEpoch}`);

        if (won) {
            // Local ticks only decide recovery timing. The contract remains
            // active until Deriv sends its final, authoritative profit.
            currentStakeRef.current = stakeRef.current;
            setCurrentStake(currentStakeRef.current);
            localWinCountRef.current += 1;
            if (localWinCountRef.current >= 5) {
                localWinCountRef.current = 0;
                rescanRequestedRef.current = true;
                addLog('FIVE LOCAL WINS · qualification rescan queued after active settlements complete');
            }
            if (trade.officialSettled && !pendingSettlementsRef.current.size && lockedSymbolRef.current === trade.symbol) {
                const candidate = candidatesRef.current[trade.symbol];
                if (candidate) {
                    candidatesRef.current[trade.symbol] = { ...candidate, status: 'qualified' };
                    publishCandidates();
                }
                setLock(null);
                const shouldRescan = rescanRequestedRef.current;
                rescanRequestedRef.current = false;
                addLog(`LOCAL WIN CONFIRMED · ${SYMBOL_LABELS[trade.symbol] || trade.symbol} unlocked; waiting for a fresh MACD cross`);
                if (shouldRescan) setTimeout(() => initializeRef.current?.(), 0);
            }
            if (!trade.officialSettled) addLog(`LOCAL WIN · ${SYMBOL_LABELS[trade.symbol] || trade.symbol} remains locked until official settlement`);
            return;
        }

        // Keep the losing contract so its later official result is accounted
        // for once, even after the next recovery buy is sent.
        if (!trade.officialSettled) pendingSettlementsRef.current.set(trade.contractId, trade);
        openTradeRef.current = null;
        currentStakeRef.current = Math.max(MIN_STAKE, Math.ceil(trade.stake * martingaleRef.current * 100) / 100);
        setCurrentStake(currentStakeRef.current);
        setPhase('locked');
        addLog(`LOCAL LOSS · ${SYMBOL_LABELS[trade.symbol] || trade.symbol} remains locked · next stake $${currentStakeRef.current.toFixed(2)}`);

        if (everyTickRef.current) pendingRecoveryRef.current = {
            symbol: trade.symbol,
            direction: trade.direction,
            stake: currentStakeRef.current,
            afterEpoch: exitEpoch,
        };
    }, [addLog, publishCandidates, setLock]);

    const buy = useCallback(async (symbol: string, direction: Direction, amount: number, entryEpoch: number, entryQuote: number) => {
        if (!runningRef.current || buyInFlightRef.current || openTradeRef.current) return;
        if (lockedSymbolRef.current && lockedSymbolRef.current !== symbol) return;
        buyInFlightRef.current = true;
        const contractType = direction === 'rise' ? 'CALL' : 'PUT';
        addLog(`BUY ${direction.toUpperCase()} · ${SYMBOL_LABELS[symbol] || symbol} · stake $${amount.toFixed(2)} · entry tick ${entryEpoch}`);
        try {
            const response: any = await sendViaNewSystemWithPromise({
                buy: 1,
                price: amount,
                parameters: {
                    amount,
                    basis: 'stake',
                    currency: 'USD',
                    duration: 1,
                    duration_unit: 't',
                    symbol,
                    contract_type: contractType,
                },
            });
            const contractId = response?.buy?.contract_id ?? response?.contract_id;
            if (!contractId) throw new Error('Deriv did not return a contract id');
            openTradeRef.current = { symbol, direction, stake: amount, entryEpoch, entryQuote, contractId: String(contractId) };
            try {
                transactions.onBotContractEvent({
                    contract_id: contractId,
                    transaction_ids: { buy: response?.buy?.transaction_id },
                    buy_price: amount,
                    currency: 'USD',
                    contract_type: contractType,
                    underlying: symbol,
                    display_name: SYMBOL_LABELS[symbol] || symbol,
                    date_start: Math.floor(Date.now() / 1000),
                    status: 'open',
                } as any);
            } catch {}
        } catch (error: any) {
            addLog(`BUY ERROR · ${error?.error?.message || error?.message || 'request failed'}`);
            if (everyTickRef.current && runningRef.current && lockedSymbolRef.current === symbol) {
                pendingRecoveryRef.current = { symbol, direction, stake: amount, afterEpoch: entryEpoch };
                setPhase('locked');
            } else {
                setLock(null);
            }
        } finally {
            buyInFlightRef.current = false;
        }
    }, [addLog, setLock, transactions]);

    const evaluateEntry = useCallback((symbol: string, prices: number[], epoch: number, quote: number) => {
        if (!runningRef.current || lockedSymbolRef.current || openTradeRef.current || buyInFlightRef.current) return;
        const candidate = candidatesRef.current[symbol];
        if (!candidate) return;
        const state = macdSnapshot(prices);
        if (!state) return;
        const risingEntry = candidate.direction === 'rise'
            && state.crossUp
            // A bullish line cross normally moves the current histogram
            // through zero. Therefore the meaningful confirmation is that
            // the histogram was below zero immediately before the cross.
            && state.previousHistogram < 0;
        const fallingEntry = candidate.direction === 'fall'
            && state.crossDown
            // Likewise, a bearish cross is confirmed by a histogram that
            // was above zero immediately before the cross.
            && state.previousHistogram > 0;
        setLastSignal(`${SYMBOL_LABELS[symbol] || symbol} ${candidate.direction.toUpperCase()} · MACD ${state.histogram.toFixed(6)}`);
        if (!risingEntry && !fallingEntry) return;
        lockedSymbolRef.current = symbol;
        setLockedSymbol(symbol);
        setPhase('locked');
        candidatesRef.current[symbol] = { ...candidate, status: 'locked', lastMacd: state.currentMacd, lastSignal: state.currentSignal, lastHistogram: state.histogram };
        publishCandidates();
        addLog(`MACD CROSS · ${SYMBOL_LABELS[symbol] || symbol} locked first · ${candidate.direction.toUpperCase()} contract entering immediately`);
        void buy(symbol, candidate.direction, currentStakeRef.current, epoch, quote);
    }, [addLog, buy, publishCandidates]);

    const initialize = useCallback(async () => {
        const symbols = ALL_SYMBOLS;
        pricesRef.current = {};
        candidatesRef.current = {};
        processedTicksRef.current = {};
        pendingRecoveryRef.current = null;
        awaitingLocalResultRef.current = null;
        setCandidates([]);
        setLock(null);
        setPhase('scanning');
        addLog(`SCANNING ${symbols.length} volatilities · fetching latest ${HISTORY_COUNT} ticks each`);
        const results = await Promise.all(symbols.map(async symbol => {
            try {
                const response: any = await sendViaNewSystemWithPromise({ ticks_history: symbol, count: HISTORY_COUNT, end: 'latest', style: 'ticks' });
                const prices = (response?.history?.prices || []).map(Number).filter(Number.isFinite).slice(-HISTORY_COUNT);
                return { symbol, prices };
            } catch (error: any) {
                addLog(`${SYMBOL_LABELS[symbol] || symbol} history failed · ${error?.message || 'request failed'}`);
                return { symbol, prices: [] };
            }
        }));

        results.forEach(({ symbol, prices }) => {
            pricesRef.current[symbol] = prices;
            if (prices.length < HISTORY_COUNT) return;
            const { risePct, fallPct } = calculateTrend(prices);
            if (risePct < 55 && fallPct < 55) return;
            const direction: Direction = risePct >= 55 ? 'rise' : 'fall';
            const macd = macdSnapshot(prices);
            candidatesRef.current[symbol] = {
                symbol,
                direction,
                risePct,
                fallPct,
                prices,
                lastMacd: macd?.currentMacd || 0,
                lastSignal: macd?.currentSignal || 0,
                lastHistogram: macd?.histogram || 0,
                status: 'qualified',
            };
        });
        publishCandidates();
        symbols.forEach(symbol => {
            if (window._newSystemWS?.readyState === WebSocket.OPEN) {
                window._newSystemWS.send(JSON.stringify({ ticks_history: symbol, count: HISTORY_COUNT, end: 'latest', style: 'ticks', subscribe: 1 }));
            }
        });
        const count = Object.keys(candidatesRef.current).length;
        addLog(count ? `${count} volatility candidate${count === 1 ? '' : 's'} qualified at 55%+ · waiting for MACD entry` : 'NO VOLATILITY QUALIFIED · waiting for next run');
        setPhase(count ? 'waiting' : 'stopped');
        if (!count) setRunning(false);
    }, [addLog, publishCandidates, setLock]);
    initializeRef.current = initialize;

    useEffect(() => {
        if (!running) return;
        const unsubscribe = onNewSystemMessage((event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.msg_type === 'tick' && data.tick?.symbol) {
                    const symbol = String(data.tick.symbol);
                    if (!ALL_SYMBOLS.includes(symbol)) return;
                    const epoch = Number(data.tick.epoch);
                    const quote = quoteNumber(data.tick.quote);
                    if (!Number.isFinite(epoch) || quote == null) return;
                    const key = `${epoch}|${quote}|${data.tick.id || ''}`;
                    const keys = processedTicksRef.current[symbol] || new Set<string>();
                    if (keys.has(key)) return;
                    keys.add(key);
                    if (keys.size > 250) keys.delete(keys.values().next().value as string);
                    processedTicksRef.current[symbol] = keys;
                    const priorTrade = openTradeRef.current;
                    if (priorTrade?.symbol === symbol && epoch > priorTrade.entryEpoch && everyTickRef.current) {
                        localSettle(priorTrade, epoch, quote);
                    }
                    const awaitingLocalResult = awaitingLocalResultRef.current;
                    if (awaitingLocalResult?.symbol === symbol && epoch > awaitingLocalResult.entryEpoch && everyTickRef.current) {
                        awaitingLocalResultRef.current = null;
                        localSettle(awaitingLocalResult, epoch, quote);
                    }
                    const pendingRecovery = pendingRecoveryRef.current;
                    if (pendingRecovery
                        && pendingRecovery.symbol === symbol
                        && epoch > pendingRecovery.afterEpoch
                        && !openTradeRef.current
                        && !buyInFlightRef.current
                        && lockedSymbolRef.current === symbol) {
                        pendingRecoveryRef.current = null;
                        addLog(`NEXT-TICK RECOVERY · ${SYMBOL_LABELS[symbol] || symbol} · ${pendingRecovery.direction.toUpperCase()} · stake $${pendingRecovery.stake.toFixed(2)}`);
                        void buy(symbol, pendingRecovery.direction, pendingRecovery.stake, epoch, quote);
                    }
                    const oldPrices = pricesRef.current[symbol] || [];
                    const prices = [...oldPrices, quote].slice(-HISTORY_COUNT);
                    pricesRef.current[symbol] = prices;
                    evaluateEntry(symbol, prices, epoch, quote);
                }
                if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract?.is_sold) {
                    const contractId = String(data.proposal_open_contract.contract_id);
                    const pendingTrade = pendingSettlementsRef.current.get(contractId);
                    const currentTrade = openTradeRef.current?.contractId === contractId ? openTradeRef.current : null;
                    const trade = pendingTrade || currentTrade;
                    if (!trade) return;
                    pendingSettlementsRef.current.delete(contractId);
                    if (currentTrade) openTradeRef.current = null;
                    const profit = Number(data.proposal_open_contract.profit) || 0;
                    setSessionProfit(value => value + profit);
                    const localOutcome = trade.localOutcome;
                    // With Every-tick recovery, the local next-tick result is
                    // authoritative for the recovery sequence. Official
                    // messages update money only and must not overwrite the
                    // locked volatility's stake or direction.
                    if (!localOutcome && everyTickRef.current) {
                        trade.officialSettled = true;
                        awaitingLocalResultRef.current = trade;
                        addLog(`OFFICIAL SETTLEMENT RECEIVED · ${SYMBOL_LABELS[trade.symbol] || trade.symbol} · waiting for the next full quote to calculate the local result`);
                        return;
                    }
                    if (localOutcome) {
                        if (localOutcome === 'win') unlockAfterSettlementsRef.current = true;
                        const hasPendingContracts = pendingSettlementsRef.current.size > 0;
                        if (unlockAfterSettlementsRef.current && !openTradeRef.current && !hasPendingContracts && lockedSymbolRef.current === trade.symbol) {
                            const candidate = candidatesRef.current[trade.symbol];
                            if (candidate) {
                                candidatesRef.current[trade.symbol] = { ...candidate, status: 'qualified' };
                                publishCandidates();
                            }
                            setLock(null);
                            const shouldRescan = rescanRequestedRef.current;
                            unlockAfterSettlementsRef.current = false;
                            addLog(`LOCAL WIN CONFIRMED · ${SYMBOL_LABELS[trade.symbol] || trade.symbol} unlocked; waiting for a fresh MACD cross`);
                            if (shouldRescan) {
                                rescanRequestedRef.current = false;
                                addLog('RESCANNING ALL VOLATILITIES AFTER FIVE LOCAL WINS');
                                setTimeout(() => initializeRef.current?.(), 0);
                            }
                        } else {
                            addLog(`OFFICIAL SETTLEMENT RECORDED · ${SYMBOL_LABELS[trade.symbol] || trade.symbol} · ${profit >= 0 ? 'WIN' : 'LOSS'} · recovery state unchanged`);
                        }
                        return;
                    }
                    if (profit >= 0) {
                        pendingRecoveryRef.current = null;
                        currentStakeRef.current = stakeRef.current;
                        setCurrentStake(currentStakeRef.current);
                        unlockAfterSettlementsRef.current = true;
                        // A different volatility must never start while the
                        // locked volatility still has an active recovery buy.
                        if (!openTradeRef.current && pendingSettlementsRef.current.size === 0 && lockedSymbolRef.current === trade.symbol) {
                            const candidate = candidatesRef.current[trade.symbol];
                            if (candidate) {
                                candidatesRef.current[trade.symbol] = { ...candidate, status: 'qualified' };
                                publishCandidates();
                            }
                            setLock(null);
                            unlockAfterSettlementsRef.current = false;
                            addLog(`WIN CONFIRMED · ${SYMBOL_LABELS[trade.symbol] || trade.symbol} unlocked after official settlement`);
                        } else {
                            addLog(`WIN CONFIRMED · ${SYMBOL_LABELS[trade.symbol] || trade.symbol} profit recorded; lock remains active`);
                        }
                    } else {
                        currentStakeRef.current = Math.max(MIN_STAKE, Math.ceil(trade.stake * martingaleRef.current * 100) / 100);
                        setCurrentStake(currentStakeRef.current);
                        if (everyTickRef.current && !openTradeRef.current) pendingRecoveryRef.current = {
                            symbol: trade.symbol,
                            direction: trade.direction,
                            stake: currentStakeRef.current,
                            afterEpoch: trade.entryEpoch,
                        };
                        if (unlockAfterSettlementsRef.current && !openTradeRef.current && pendingSettlementsRef.current.size === 0 && lockedSymbolRef.current === trade.symbol) {
                            const candidate = candidatesRef.current[trade.symbol];
                            if (candidate) {
                                candidatesRef.current[trade.symbol] = { ...candidate, status: 'qualified' };
                                publishCandidates();
                            }
                            setLock(null);
                            unlockAfterSettlementsRef.current = false;
                            addLog(`SETTLEMENTS COMPLETE · ${SYMBOL_LABELS[trade.symbol] || trade.symbol} unlocked`);
                        } else {
                            addLog(`LOSS CONFIRMED · ${SYMBOL_LABELS[trade.symbol] || trade.symbol} remains locked · next stake $${currentStakeRef.current.toFixed(2)}`);
                        }
                    }
                }
            } catch {}
        });
        return unsubscribe;
    }, [addLog, evaluateEntry, localSettle, publishCandidates, running, setLock]);

    useEffect(() => {
        stakeRef.current = Math.max(MIN_STAKE, Number(stake) || MIN_STAKE);
        martingaleRef.current = Math.max(1, Number(martingale) || 2);
        everyTickRef.current = everyTick;
        localStorage.setItem('mw_master_stake', stake);
        localStorage.setItem('mw_master_martingale', martingale);
        localStorage.setItem('mw_master_every_tick', String(everyTick));
        if (!runningRef.current) {
            currentStakeRef.current = stakeRef.current;
            setCurrentStake(stakeRef.current);
        }
    }, [everyTick, martingale, running, stake]);

    const start = () => {
        if (runningRef.current) return;
        runningRef.current = true;
        currentStakeRef.current = Math.max(MIN_STAKE, Number(stake) || MIN_STAKE);
        setCurrentStake(currentStakeRef.current);
        setRunning(true);
        void initialize();
    };

    const stop = () => {
        runningRef.current = false;
        openTradeRef.current = null;
        pendingSettlementsRef.current.clear();
        unlockAfterSettlementsRef.current = false;
        pendingRecoveryRef.current = null;
        awaitingLocalResultRef.current = null;
        localWinCountRef.current = 0;
        rescanRequestedRef.current = false;
        buyInFlightRef.current = false;
        setRunning(false);
        setLock(null);
        setPhase('idle');
        addLog('STOPPED · volatility lock released');
    };

    return <div className='mw-killer even-odd-theme mw-ueo-panel'>
        <div className='mw-ueo-header'>
            <div><span className='mw-ueo-eyebrow'>RISE / FALL STRATEGY</span><h3>MASTER ENTRY</h3></div>
            <span className={`mw-ueo-status ${running ? 'is-live' : ''}`}><i />{running ? phase.toUpperCase() : 'READY'}</span>
        </div>
        <section className='mw-ueo-section'>
            <div className='mw-ueo-section-title'>Trade setup <span>100-tick trend qualification and MACD entry</span></div>
            <div className='mw-ueo-grid mw-ueo-grid--three'>
                <div className='mw-field'><label className='mw-label'>Initial stake</label><input className='mw-input' type='number' min={MIN_STAKE} step='0.01' value={stake} onChange={e => setStake(e.target.value)} disabled={running} /></div>
                <div className='mw-field'><label className='mw-label'>Martingale multiplier</label><input className='mw-input' type='number' min='1' step='0.1' value={martingale} onChange={e => setMartingale(e.target.value)} disabled={running} /></div>
                <div className='mw-field mw-ueo-entry-field'><label className='mw-label'>Every-tick recovery</label><div className='mw-ueo-entry-controls'><span className='mw-ueo-field-hint'>Local next-tick result</span><button type='button' role='switch' aria-checked={everyTick} className='mw-toggle mw-ueo-auto-toggle__button' disabled={running} onClick={() => setEveryTick(value => !value)}><span className={`mw-toggle__track ${everyTick ? 'mw-toggle__track--on' : ''}`}><span className={`mw-toggle__thumb ${everyTick ? 'mw-toggle__thumb--on' : ''}`} /></span></button></div></div>
            </div>
        </section>
        <div className='mw-ueo-status-card'><div><span>QUALIFIED</span><strong>{candidates.length}</strong></div><div><span>LOCKED</span><strong>{lockedSymbol ? SYMBOL_LABELS[lockedSymbol] || lockedSymbol : '—'}</strong></div><div><span>NEXT STAKE</span><strong>${currentStake.toFixed(2)}</strong></div><div><span>SESSION P/L</span><strong className={sessionProfit >= 0 ? 'is-positive' : 'is-negative'}>{sessionProfit >= 0 ? '+' : ''}${sessionProfit.toFixed(2)}</strong></div></div>
        <section className='mw-ueo-section'>
            <div className='mw-ueo-section-title'>Volatility qualification <span>Rise or fall must reach 55%+</span></div>
            <div className='mw-killer__log-list' style={{ maxHeight: 170, overflowY: 'auto' }}>
                {candidates.length ? candidates.map(candidate => <div className='mw-killer__log-line' key={candidate.symbol}><strong>{SYMBOL_LABELS[candidate.symbol] || candidate.symbol}</strong> · {candidate.direction.toUpperCase()} · rise {candidate.risePct.toFixed(1)}% / fall {candidate.fallPct.toFixed(1)}% · MACD {candidate.status === 'locked' ? 'LOCKED' : 'waiting'}</div>) : <div className='mw-killer__log-empty'>Run Master Entry to scan all volatility indices</div>}
            </div>
        </section>
        <div className='mw-killer__actions'>{running ? <button className='mw-btn mw-btn--stop' onClick={stop}>STOP · {phase.toUpperCase()}</button> : <button className='mw-btn mw-btn--run' onClick={start}>RUN MASTER ENTRY</button>}</div>
        <div className='mw-killer__logs'><div className='mw-killer__logs-head'>Master Entry log</div><div className='mw-killer__log-list'>{logs.length ? logs.map((line, index) => <div key={index} className='mw-killer__log-line'>{line}</div>) : <div className='mw-killer__log-empty'>Configure stake and martingale, then run</div>}</div></div>
    </div>;
};

export default MasterEntry;
