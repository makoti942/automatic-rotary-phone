import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_SYMBOLS, SYMBOL_LABELS, PIP_SIZES, openMakotiWS, MakotiWS } from './makoti-ws';
import { sendViaNewSystemWithPromise } from '@/auth/NewDerivAuth';
import { useStore } from '@/hooks/useStore';

/* ── Types ─────────────────────────────────────────────────────────────────── */
interface LogEntry { time: string; msg: string; type: 'win' | 'loss' | 'info' | 'trade' | 'trigger' | 'recovery'; }
type Phase = 'idle' | 'scanning' | 'waiting_pattern' | 'trading' | 'recovery' | 'reanalyze';

/* ── Constants ─────────────────────────────────────────────────────────────── */
const MAX_TICKS = 200;
const MIN_TICKS = 100;
const DOMINANCE_THRESHOLD = 58;
const TRADES_PER_ROUND = 3;
const LS_KEY = 'mw_eo_config';

const DEFAULT_CFG = { stake: '0.35', martingale: '2' };

function loadCfg(): typeof DEFAULT_CFG {
    try { const r = localStorage.getItem(LS_KEY); return r ? { ...DEFAULT_CFG, ...JSON.parse(r) } : DEFAULT_CFG; }
    catch { return DEFAULT_CFG; }
}
function saveCfg(c: typeof DEFAULT_CFG) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch {}
}

/* ── Component ─────────────────────────────────────────────────────────────── */
export const EvenOddKiller: React.FC = () => {
    const { transactions } = useStore();

    /* ── Config ── */
    const cfg = loadCfg();
    const [stake, setStake] = useState(cfg.stake);
    const [martingale, setMartingale] = useState(cfg.martingale);
    const [running, setRunning] = useState(false);

    const stakeRef = useRef(parseFloat(cfg.stake));
    const martingaleRef = useRef(parseFloat(cfg.martingale));
    useEffect(() => { saveCfg({ stake, martingale }); }, [stake, martingale]);
    useEffect(() => { stakeRef.current = parseFloat(stake) || 0.35; }, [stake]);
    useEffect(() => { martingaleRef.current = parseFloat(martingale) || 2; }, [martingale]);

    /* ── Logs ── */
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
        const time = new Date().toLocaleTimeString();
        setLogs(prev => [...prev.slice(-200), { time, msg, type }]);
    }, []);

    /* ── Tick buffers ── */
    const bufRef = useRef<Record<string, number[]>>({});
    const wsRef = useRef<MakotiWS | null>(null);
    const runningRef = useRef(false);
    const phaseRef = useRef<Phase>('idle');
    const lockRef = useRef(false);

    /* ── Strategy state ── */
    const selectedSymRef = useRef('');
    const contractTypeRef = useRef<'DIGITEVEN' | 'DIGITODD'>('DIGITEVEN');
    const dominantSideRef = useRef<'even' | 'odd'>('even');
    const dominantPctRef = useRef(0);
    const currentStakeRef = useRef(stakeRef.current);
    const tradesWonRef = useRef(0);
    const tradesLostRef = useRef(0);
    const tradesInRoundRef = useRef(0);
    const totalPnlRef = useRef(0);
    const recoveryAttemptsRef = useRef(0);

    /* ── Pattern tracking ── */
    const losingStreakRef = useRef(0);
    const patternReadyRef = useRef(false);
    const awaitingResultRef = useRef(false);
    const tradeIdRef = useRef(0);
    const pendingTradeIdRef = useRef(0);

    /* ── UI state ── */
    const [symProgress, setSymProgress] = useState<Record<string, {
        evenPct: number; oddPct: number; ticks: number; status: string;
    }>>({});
    const [selectedSym, setSelectedSym] = useState('');
    const [contractLabel, setContractLabel] = useState('');
    const [tradesWon, setTradesWon] = useState(0);
    const [tradesLost, setTradesLost] = useState(0);
    const [tradesInRound, setTradesInRound] = useState(0);
    const [totalPnl, setTotalPnl] = useState(0);
    const [phase, setPhase] = useState<Phase>('idle');
    const [patternStatus, setPatternStatus] = useState('');
    const [currentStakeUI, setCurrentStakeUI] = useState(stakeRef.current);

    /* ── Is digit even? ── */
    const isEven = (d: number) => d === 0 || d === 2 || d === 4 || d === 6 || d === 8;

    /* ── Calculate even/odd percentages from buffer ── */
    const calcEvenOdd = (digits: number[]) => {
        const n = digits.length || 1;
        const evenCount = digits.filter(d => isEven(d)).length;
        const evenPct = (evenCount / n) * 100;
        return { evenPct, oddPct: 100 - evenPct };
    };

    /* ── Check if dominant side is increasing ── */
    const isIncreasing = (digits: number[], dominant: 'even' | 'odd'): boolean => {
        if (digits.length < 30) return false;
        const recent = digits.slice(-15);
        const older = digits.slice(-50, -15);
        if (older.length < 5) return true; // not enough data, allow
        const recentPct = dominant === 'even'
            ? (recent.filter(d => isEven(d)).length / recent.length) * 100
            : (recent.filter(d => !isEven(d)).length / recent.length) * 100;
        const olderPct = dominant === 'even'
            ? (older.filter(d => isEven(d)).length / older.length) * 100
            : (older.filter(d => !isEven(d)).length / older.length) * 100;
        // Allow if recent is stable or increasing (within 2% tolerance)
        return recentPct >= olderPct - 2;
    };

    /* ── Stop ── */
    const stop = useCallback(() => {
        runningRef.current = false;
        phaseRef.current = 'idle';
        lockRef.current = false;
        awaitingResultRef.current = false;
        setRunning(false);
        setPhase('idle');
        setPatternStatus('');
        try { wsRef.current?.close(); } catch {}
        wsRef.current = null;
        addLog('Stopped', 'info');
    }, [addLog]);

    /* ── Execute trade ── */
    const executeTrade = useCallback(async (sym: string, ct: 'DIGITEVEN' | 'DIGITODD', amt: number): Promise<boolean> => {
        if (window._newSystemWS?.readyState !== WebSocket.OPEN) return false;
        try {
            const r = await sendViaNewSystemWithPromise({
                buy: 1, price: amt,
                parameters: {
                    amount: amt, basis: 'stake', currency: 'USD',
                    duration: 1, duration_unit: 't',
                    symbol: sym, contract_type: ct,
                },
            });
            const cid = r?.buy?.contract_id ?? r?.contract_id;
            if (cid) {
                const label = ct === 'DIGITEVEN' ? 'EVEN' : 'ODD';
                addLog(`TRADE ${SYMBOL_LABELS[sym]}: ${label} @ $${amt.toFixed(2)}`, 'trade');
                try {
                    transactions.onBotContractEvent({
                        contract_id: cid, transaction_ids: { buy: r?.buy?.transaction_id },
                        buy_price: amt, currency: 'USD', contract_type: ct,
                        underlying: sym, display_name: SYMBOL_LABELS[sym],
                        date_start: Math.floor(Date.now() / 1000), status: 'open',
                    } as any);
                } catch {}
                return true;
            }
            return false;
        } catch (e: any) {
            addLog(`BUY ERROR: ${e?.error?.message || e?.message}`, 'loss');
            return false;
        }
    }, [addLog, transactions]);

    /* ── Re-analyze volatilities ── */
    const reanalyze = useCallback(() => {
        phaseRef.current = 'scanning';
        setPhase('scanning');
        losingStreakRef.current = 0;
        patternReadyRef.current = false;
        awaitingResultRef.current = false;
        tradeIdRef.current = 0;
        pendingTradeIdRef.current = 0;
        tradesInRoundRef.current = 0;
        setTradesInRound(0);
        currentStakeRef.current = stakeRef.current;
        setCurrentStakeUI(stakeRef.current);
        lockRef.current = false;
        selectedSymRef.current = '';
        setSelectedSym('');
        setContractLabel('');
        setPatternStatus('Scanning volatilities...');
        addLog('Re-analyzing all volatilities...', 'info');

        // Scan all volatilities for dominant even/odd > 58% and increasing
        const buf = bufRef.current;
        let bestSym = '';
        let bestCt: 'DIGITEVEN' | 'DIGITODD' = 'DIGITEVEN';
        let bestSide: 'even' | 'odd' = 'even';
        let bestPct = 0;

        for (const sym of ALL_SYMBOLS) {
            const digits = buf[sym];
            if (!digits || digits.length < 30) continue;

            const { evenPct, oddPct } = calcEvenOdd(digits.slice(-50));

            // Check even — >58% and stable/increasing
            if (evenPct > DOMINANCE_THRESHOLD && isIncreasing(digits, 'even')) {
                if (evenPct > bestPct) {
                    bestPct = evenPct;
                    bestSym = sym;
                    bestCt = 'DIGITEVEN';
                    bestSide = 'even';
                }
            }
            // Check odd — >58% and stable/increasing
            if (oddPct > DOMINANCE_THRESHOLD && isIncreasing(digits, 'odd')) {
                if (oddPct > bestPct) {
                    bestPct = oddPct;
                    bestSym = sym;
                    bestCt = 'DIGITODD';
                    bestSide = 'odd';
                }
            }
        }

        if (bestSym) {
            selectedSymRef.current = bestSym;
            contractTypeRef.current = bestCt;
            dominantSideRef.current = bestSide;
            dominantPctRef.current = bestPct;
            const label = bestCt === 'DIGITEVEN' ? 'EVEN' : 'ODD';
            setSelectedSym(bestSym);
            setContractLabel(`${label} (${bestPct.toFixed(1)}%)`);
            phaseRef.current = 'waiting_pattern';
            setPhase('waiting_pattern');
            losingStreakRef.current = 0;
            patternReadyRef.current = false;
            setPatternStatus(`Waiting: 2+ ${bestSide === 'even' ? 'odd' : 'even'} then ${label}...`);
            addLog(`SELECTED ${SYMBOL_LABELS[bestSym]}: ${label} at ${bestPct.toFixed(1)}% — waiting for entry pattern`, 'trigger');
        } else {
            // Fallback: pick the volatility with highest dominant %, even if not strictly increasing
            let fallbackSym = '';
            let fallbackCt: 'DIGITEVEN' | 'DIGITODD' = 'DIGITEVEN';
            let fallbackSide: 'even' | 'odd' = 'even';
            let fallbackPct = 0;
            for (const sym of ALL_SYMBOLS) {
                const digits = buf[sym];
                if (!digits || digits.length < 30) continue;
                const { evenPct, oddPct } = calcEvenOdd(digits.slice(-50));
                if (evenPct > fallbackPct) { fallbackPct = evenPct; fallbackSym = sym; fallbackCt = 'DIGITEVEN'; fallbackSide = 'even'; }
                if (oddPct > fallbackPct) { fallbackPct = oddPct; fallbackSym = sym; fallbackCt = 'DIGITODD'; fallbackSide = 'odd'; }
            }
            if (fallbackSym) {
                selectedSymRef.current = fallbackSym;
                contractTypeRef.current = fallbackCt;
                dominantSideRef.current = fallbackSide;
                dominantPctRef.current = fallbackPct;
                const label = fallbackCt === 'DIGITEVEN' ? 'EVEN' : 'ODD';
                setSelectedSym(fallbackSym);
                setContractLabel(`${label} (${fallbackPct.toFixed(1)}%)`);
                phaseRef.current = 'waiting_pattern';
                setPhase('waiting_pattern');
                losingStreakRef.current = 0;
                patternReadyRef.current = false;
                setPatternStatus(`Waiting: 2+ ${fallbackSide === 'even' ? 'odd' : 'even'} then ${label}...`);
                addLog(`FALLBACK ${SYMBOL_LABELS[fallbackSym]}: ${label} at ${fallbackPct.toFixed(1)}% — waiting for pattern`, 'trigger');
            } else {
                setPatternStatus('No volatility data yet. Retrying in 3s...');
                addLog('No volatility data available. Retrying...', 'info');
                setTimeout(() => {
                    if (runningRef.current) reanalyze();
                }, 3000);
            }
        }
    }, [addLog]);

    /* ── Fire a trade immediately ── */
    const fireTrade = useCallback(() => {
        const sym = selectedSymRef.current;
        const ct = contractTypeRef.current;
        if (!sym || !runningRef.current) return;

        // Set flags SYNCHRONOUSLY before any async work
        lockRef.current = true;
        awaitingResultRef.current = true;
        tradeIdRef.current++;
        const myTradeId = tradeIdRef.current;

        const label = ct === 'DIGITEVEN' ? 'EVEN' : 'ODD';
        const isRecovery = phaseRef.current === 'recovery';
        const roundLabel = isRecovery ? `RECOVERY ${recoveryAttemptsRef.current + 1}` : `${tradesInRoundRef.current + 1}/${TRADES_PER_ROUND}`;
        addLog(`TRADE ${roundLabel} — ${label} on ${SYMBOL_LABELS[sym]} @ $${currentStakeRef.current.toFixed(2)}`, 'trade');
        setPatternStatus(`TRADING ${label} — ${roundLabel}...`);
        if (isRecovery) recoveryAttemptsRef.current++;

        const amt = currentStakeRef.current;
        executeTrade(sym, ct, amt).then(ok => {
            if (!ok) {
                addLog('Trade failed — unlocking', 'loss');
                awaitingResultRef.current = false;
                lockRef.current = false;
            }
            // Store the trade ID so processTick knows which trade this is
            pendingTradeIdRef.current = myTradeId;
        });
    }, [addLog, executeTrade]);

    /* ── Handle trade result ── */
    const handleTradeResult = useCallback((won: boolean) => {
        if (won) {
            tradesWonRef.current++;
            setTradesWon(tradesWonRef.current);
            totalPnlRef.current += currentStakeRef.current * 0.95;
            setTotalPnl(totalPnlRef.current);
            addLog(`WIN +$${(currentStakeRef.current * 0.95).toFixed(2)}`, 'win');

            // If we were in recovery — re-analyze
            if (phaseRef.current === 'recovery') {
                addLog('RECOVERY WIN — re-analyzing volatilities', 'success');
                currentStakeRef.current = stakeRef.current;
                setCurrentStakeUI(stakeRef.current);
                awaitingResultRef.current = false;
                lockRef.current = false;
                reanalyze();
                return;
            }

            tradesInRoundRef.current++;
            setTradesInRound(tradesInRoundRef.current);

            if (tradesInRoundRef.current >= TRADES_PER_ROUND) {
                addLog(`3 WINS — re-analyzing volatilities`, 'success');
                currentStakeRef.current = stakeRef.current;
                setCurrentStakeUI(stakeRef.current);
                awaitingResultRef.current = false;
                lockRef.current = false;
                reanalyze();
                return;
            }

            // Fire next trade IMMEDIATELY — flag stays true, fireTrade sets it for the new trade
            fireTrade();
        } else {
            tradesLostRef.current++;
            setTradesLost(tradesLostRef.current);
            totalPnlRef.current -= currentStakeRef.current;
            setTotalPnl(totalPnlRef.current);
            addLog(`LOSS -$${currentStakeRef.current.toFixed(2)}`, 'loss');

            // Recovery: increase stake, fire next trade IMMEDIATELY
            phaseRef.current = 'recovery';
            setPhase('recovery');
            currentStakeRef.current *= martingaleRef.current;
            setCurrentStakeUI(currentStakeRef.current);
            addLog(`RECOVERY: stake $${currentStakeRef.current.toFixed(2)}`, 'recovery');
            setPatternStatus(`RECOVERY — stake $${currentStakeRef.current.toFixed(2)} — firing now...`);
            fireTrade();
        }
    }, [addLog, reanalyze, fireTrade]);

    /* ── Process tick for pattern detection and trading ── */
    const processTick = useCallback((sym: string, digit: number) => {
        if (!runningRef.current) return;
        if (phaseRef.current === 'idle' || phaseRef.current === 'scanning') return;
        if (sym !== selectedSymRef.current) return;

        const ct = contractTypeRef.current;
        const winningIsEven = ct === 'DIGITEVEN';

        // If awaiting trade result — this next tick determines win/loss (1-tick contract)
        // Only resolve if this is the SAME trade we're waiting for (not a new one from fireTrade)
        if (awaitingResultRef.current && pendingTradeIdRef.current === tradeIdRef.current) {
            const won = winningIsEven ? isEven(digit) : !isEven(digit);
            // Mark as resolved immediately so next tick doesn't re-resolve
            pendingTradeIdRef.current = -1;
            handleTradeResult(won);
            return;
        }

        if (lockRef.current) return;

        const buf = bufRef.current[sym];
        if (!buf || buf.length < 5) return;

        const digitIsWin = winningIsEven ? isEven(digit) : !isEven(digit);
        const digitIsLose = !digitIsWin;

        // Pattern waiting: ONLY after fresh re-analyze (waiting_pattern phase)
        // 2+ losing digits, then fire on the next winning digit
        if (phaseRef.current === 'waiting_pattern') {
            if (digitIsLose) {
                losingStreakRef.current++;
                setPatternStatus(`Pattern: ${losingStreakRef.current} losing digits seen — waiting for ${dominantSideRef.current}...`);
            } else if (digitIsWin && losingStreakRef.current >= 2) {
                // Pattern complete — at least 2 losers, now a winner — fire trade 1
                lockRef.current = true;
                awaitingResultRef.current = true;
                lastTradeDigitRef.current = digit;
                const label = ct === 'DIGITEVEN' ? 'EVEN' : 'ODD';
                tradesInRoundRef.current = 0;
                setTradesInRound(0);
                addLog(`PATTERN TRIGGERED — ${losingStreakRef.current} losers then ${label} on ${SYMBOL_LABELS[sym]} @ $${currentStakeRef.current.toFixed(2)}`, 'trigger');
                setPatternStatus(`TRADING ${label} — 0/${TRADES_PER_ROUND}...`);

                const amt = currentStakeRef.current;
                executeTrade(sym, ct, amt).then(ok => {
                    if (!ok) {
                        addLog('Trade failed — unlocking', 'loss');
                        awaitingResultRef.current = false;
                        lockRef.current = false;
                    }
                });
            } else if (digitIsWin && losingStreakRef.current < 2) {
                // Won before 2 losers — keep counting from zero
                losingStreakRef.current = 0;
                const losing = winningIsEven ? 'odd' : 'even';
                setPatternStatus(`Waiting: 2+ ${losing} then ${ct === 'DIGITEVEN' ? 'EVEN' : 'ODD'}...`);
            }
            return;
        }
    }, [addLog, executeTrade, handleTradeResult]);

    /* ── Start ── */
    const start = useCallback(() => {
        if (runningRef.current) return;
        runningRef.current = true;
        setRunning(true);
        currentStakeRef.current = stakeRef.current;
        setCurrentStakeUI(stakeRef.current);
        tradesWonRef.current = 0;
        tradesLostRef.current = 0;
        tradesInRoundRef.current = 0;
        totalPnlRef.current = 0;
        losingStreakRef.current = 0;
        patternReadyRef.current = false;
        recoveryAttemptsRef.current = 0;
        awaitingResultRef.current = false;
        tradeIdRef.current = 0;
        pendingTradeIdRef.current = 0;
        setTradesWon(0);
        setTradesLost(0);
        setTradesInRound(0);
        setTotalPnl(0);
        addLog('Starting EVEN & ODD strategy...', 'info');

        const handleMsg = (data: any) => {
            try {
                // Historical ticks response
                if (data.msg_type === 'ticks_history' && data.ticks) {
                    const sym = data.ticks_history || data.echo?.ticks_history;
                    if (!sym) return;
                    const prices: number[] = data.ticks.map((t: any) => Number(t.quote));
                    if (!bufRef.current[sym]) bufRef.current[sym] = [];
                    prices.forEach((p: number) => {
                        const digit = parseInt(String(p).slice(-1), 10);
                        if (!isNaN(digit)) bufRef.current[sym].push(digit);
                    });
                    if (bufRef.current[sym].length > MAX_TICKS) bufRef.current[sym] = bufRef.current[sym].slice(-MAX_TICKS);

                    // Update UI
                    const { evenPct, oddPct } = calcEvenOdd(bufRef.current[sym].slice(-50));
                    setSymProgress(prev => ({
                        ...prev,
                        [sym]: { evenPct, oddPct, ticks: bufRef.current[sym].length, status: bufRef.current[sym].length >= MIN_TICKS ? 'READY' : 'loading' },
                    }));
                    return;
                }

                // Live tick
                if (data.msg_type !== 'tick' || !data.tick) return;
                const sym = data.tick.symbol;
                const q = data.tick.quote;
                if (!sym || q === undefined) return;
                const numPrice = Number(q);
                const digit = parseInt(String(q).slice(-1), 10);
                if (isNaN(digit)) return;

                if (!bufRef.current[sym]) bufRef.current[sym] = [];
                bufRef.current[sym].push(digit);
                if (bufRef.current[sym].length > MAX_TICKS) bufRef.current[sym] = bufRef.current[sym].slice(-MAX_TICKS);

                // Update UI
                const { evenPct, oddPct } = calcEvenOdd(bufRef.current[sym].slice(-50));
                setSymProgress(prev => ({
                    ...prev,
                    [sym]: { evenPct, oddPct, ticks: bufRef.current[sym].length, status: bufRef.current[sym].length >= MIN_TICKS ? 'READY' : 'loading' },
                }));

                // Process for trading
                processTick(sym, digit);
            } catch {}
        };

        const mws = openMakotiWS(
            handleMsg,
            () => {
                addLog('Connected — streaming ticks from all volatilities', 'info');
                // Fetch historical ticks
                if (window._newSystemWS?.readyState === WebSocket.OPEN) {
                    ALL_SYMBOLS.forEach(sym => {
                        window._newSystemWS.send(JSON.stringify({ ticks_history: sym, count: MIN_TICKS, end: 'latest', style: 'ticks' }));
                    });
                }
                // Start analysis after a short delay
                setTimeout(() => {
                    if (runningRef.current) reanalyze();
                }, 2000);
            },
            () => {
                if (runningRef.current) {
                    addLog('Connection lost — stopping', 'info');
                    stop();
                }
            }
        );
        wsRef.current = mws;
    }, [addLog, processTick, reanalyze, stop]);

    /* ── Cleanup ── */
    useEffect(() => () => { try { wsRef.current?.close(); } catch {} }, []);

    /* ── Render ── */
    return (
        <div className='mw-killer even-odd-theme'>
            <div className='mw-killer__fields'>
                <div className='mw-field'>
                    <label className='mw-label'>Stake ($)</label>
                    <input className='mw-input' type='number' min='0.35' step='0.01'
                        value={stake} onChange={e => setStake(e.target.value)} disabled={running} />
                </div>
                <div className='mw-field'>
                    <label className='mw-label'>Martingale ×</label>
                    <input className='mw-input' type='number' min='1' step='0.1'
                        value={martingale} onChange={e => setMartingale(e.target.value)} disabled={running} />
                </div>
            </div>

            <button
                className={`mw-btn${running ? ' mw-btn--stop' : ' mw-btn--kill'}`}
                onClick={running ? stop : start}
            >
                {running ? <><span className='mw-pulse' /> STOP</> : '⚡ RUN EVEN & ODD'}
            </button>

            {/* Status panel */}
            {running && (
                <div className='mw-killer__mode-note'>
                    {phase === 'recovery'
                        ? <span style={{ color: '#f97316' }}>RECOVERY — stake ${currentStakeUI.toFixed(2)}</span>
                        : phase === 'waiting_pattern'
                        ? <span style={{ color: '#22c55e' }}>{contractLabel} on {selectedSym ? SYMBOL_LABELS[selectedSym] : '...'}</span>
                        : phase === 'trading'
                        ? <span style={{ color: '#3b82f6' }}>TRADING — {tradesInRound}/{TRADES_PER_ROUND}</span>
                        : <span style={{ color: '#94a3b8' }}>Scanning...</span>
                    }
                </div>
            )}

            {/* Stats */}
            {running && (
                <div style={{ display: 'flex', gap: 8, fontSize: 11, padding: '4px 8px', flexWrap: 'wrap' }}>
                    <span>Won: <b style={{ color: '#4caf50' }}>{tradesWon}</b></span>
                    <span>Lost: <b style={{ color: '#f44336' }}>{tradesLost}</b></span>
                    <span>Round: <b style={{ color: '#2196f3' }}>{tradesInRound}/{TRADES_PER_ROUND}</b></span>
                    <span>P&L: <b style={{ color: totalPnl >= 0 ? '#4caf50' : '#f44336' }}>${totalPnl.toFixed(2)}</b></span>
                    <span>Stake: <b>${currentStakeUI.toFixed(2)}</b></span>
                </div>
            )}

            {/* Pattern status */}
            {running && patternStatus && (
                <div style={{ fontSize: 10, color: '#94a3b8', padding: '2px 8px' }}>
                    {patternStatus}
                </div>
            )}

            {/* Volatility grid */}
            {running && (
                <div className='mw-scanner__results' style={{ marginTop: 4 }}>
                    <div className='mw-scanner__results-head'>Even / Odd Distribution (50 ticks)</div>
                    <div className='mw-scanner__list'>
                        {ALL_SYMBOLS.map(sym => {
                            const sp = symProgress[sym];
                            if (!sp) return null;
                            const isSel = sym === selectedSymRef.current;
                            return (
                                <div key={sym} className={`mw-scanner__row${isSel ? ' mw-scanner__row--match' : ''}`}>
                                    <div className='mw-scanner__row-head'>
                                        <span className='mw-scanner__sym'>{SYMBOL_LABELS[sym]}</span>
                                        <span className='mw-scanner__row-detail'>
                                            Even: {sp.evenPct.toFixed(1)}% | Odd: {sp.oddPct.toFixed(1)}% | {sp.ticks} ticks
                                        </span>
                                        {isSel && <span className='mw-scanner__tag'>SELECTED</span>}
                                    </div>
                                    <div style={{ display: 'flex', gap: 2, height: 20, padding: '2px 0' }}>
                                        <div style={{
                                            width: `${sp.evenPct}%`, height: '100%', borderRadius: 2,
                                            background: sp.evenPct > 58 ? 'linear-gradient(90deg, #4caf50, #66bb6a)' : 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                                            transition: 'width 0.3s',
                                        }} />
                                        <div style={{
                                            width: `${sp.oddPct}%`, height: '100%', borderRadius: 2,
                                            background: sp.oddPct > 58 ? 'linear-gradient(90deg, #f97316, #fb923c)' : 'linear-gradient(90deg, #6366f1, #818cf8)',
                                            transition: 'width 0.3s',
                                        }} />
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#888' }}>
                                        <span style={{ color: sp.evenPct > 58 ? '#4caf50' : '#aaa' }}>Even {sp.evenPct.toFixed(1)}%</span>
                                        <span style={{ color: sp.oddPct > 58 ? '#f97316' : '#aaa' }}>Odd {sp.oddPct.toFixed(1)}%</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Logs */}
            {logs.length > 0 && (
                <div className='mw-killer__log' style={{ maxHeight: 120, overflow: 'auto', fontSize: 10, padding: '4px 8px' }}>
                    {logs.slice(-30).map((l, i) => (
                        <div key={i} style={{ color: l.type === 'win' ? '#4caf50' : l.type === 'loss' ? '#f44336' : l.type === 'trade' ? '#2196f3' : l.type === 'trigger' ? '#9c27b0' : l.type === 'recovery' ? '#ff9800' : '#888' }}>
                            [{l.time}] {l.msg}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
