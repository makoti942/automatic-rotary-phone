import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_SYMBOLS, SYMBOL_LABELS, openMakotiWS, MakotiWS, getDigitPcts } from './makoti-ws';
import { sendViaNewSystemWithPromise, onNewSystemMessage } from '@/auth/NewDerivAuth';
import { useStore } from '@/hooks/useStore';

interface LogEntry { time: string; msg: string; type: 'win' | 'loss' | 'info' | 'trade' | 'trigger' | 'recovery'; }
interface MarketData {
    symbol: string;
    ticks: number[];
    prices: number[];
    lastDigit: number | null;
    streakDigit: number | null;
    streakCount: number;
    pairHistory: Map<string, number>;
    digitPcts: number[];
}
interface ScoredMarket {
    symbol: string;
    freqScore: number;
    streakScore: number;
    pairScore: number;
    echoScore: number;
    totalScore: number;
    contractType: string;
    barrier: number;
    digit: number;
    reason: string;
}

const LS_KEY = 'mw_dh_config';
const MAX_TICKS = 300;
const MIN_TICKS = 50;
const BASE_STAKE = 0.35;
const CONFIDENCE_THRESHOLD = 70;
const RECOVERY_CONFIDENCE = 80;
const MAX_RECOVERY_ATTEMPTS = 3;
const RECOVERY_PAUSE_MS = 30000;
const MARTINGALE_FACTOR = 1.5;
const MIN_TRADE_INTERVAL_MS = 3000;

const DEFAULT_CFG = {
    stake: String(BASE_STAKE),
    confidenceThreshold: String(CONFIDENCE_THRESHOLD),
    recoveryEnabled: 'true',
    maxRecoveryAttempts: String(MAX_RECOVERY_ATTEMPTS),
};

function loadCfg() { try { const r = localStorage.getItem(LS_KEY); return r ? { ...DEFAULT_CFG, ...JSON.parse(r) } : DEFAULT_CFG; } catch { return DEFAULT_CFG; } }
function saveCfg(c: typeof DEFAULT_CFG) { try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch {} }
function ts() { return new Date().toLocaleTimeString('en-US', { hour12: false }); }

// ── Layer 1: Digit Frequency Bias ──
function calcFreqScore(ticks: number[]): { score: number; digit: number; reason: string; skew: 'high' | 'low' | 'none'; skewScore: number } {
    if (ticks.length < MIN_TICKS) return { score: 0, digit: -1, reason: 'Not enough data', skew: 'none', skewScore: 0 };
    const pcts = getDigitPcts(ticks, 200);
    // Find most underrepresented digit
    let minPct = 100, minDigit = 0;
    pcts.forEach((p, d) => { if (p < minPct) { minPct = p; minDigit = d; } });
    // Score: more aggressive scaling
    const deviation = 10 - minPct;
    const score = Math.min(100, Math.max(0, deviation * 15 + 20));

    // Detect skew: are high digits (6-9) or low digits (0-4) overrepresented?
    const lowPct = pcts[0] + pcts[1] + pcts[2] + pcts[3] + pcts[4]; // expected 50%
    const highPct = pcts[5] + pcts[6] + pcts[7] + pcts[8] + pcts[9]; // expected 50%
    let skew: 'high' | 'low' | 'none' = 'none';
    let skewScore = 0;
    if (highPct > 55) { skew = 'high'; skewScore = Math.min(100, (highPct - 50) * 8 + 30); }
    else if (lowPct > 55) { skew = 'low'; skewScore = Math.min(100, (lowPct - 50) * 8 + 30); }

    return { score, digit: minDigit, reason: `D${minDigit} at ${minPct.toFixed(1)}% | Low:${lowPct.toFixed(0)}% High:${highPct.toFixed(0)}%`, skew, skewScore };
}

// ── Layer 2: Streak Probability ──
function calcStreakScore(ticks: number[]): { score: number; digit: number; streakCount: number; reason: string } {
    if (ticks.length < 10) return { score: 0, digit: -1, streakCount: 0, reason: 'Not enough data' };
    let streakDigit = ticks[ticks.length - 1];
    let streakCount = 1;
    for (let i = ticks.length - 2; i >= 0; i--) {
        if (ticks[i] === streakDigit) streakCount++;
        else break;
    }
    // More aggressive scoring: 2 consecutive = 40, 3 = 65, 4+ = 90+
    let score = 0;
    if (streakCount === 2) score = 40;
    else if (streakCount === 3) score = 65;
    else if (streakCount >= 4) score = Math.min(100, 80 + (streakCount - 4) * 10);
    return { score, digit: streakDigit, streakCount, reason: `D${streakDigit} streak: ${streakCount}x → DIFF ${streakDigit}` };
}

// ── Layer 3: Pair Sequence Memory ──
function calcPairScore(ticks: number[]): { score: number; predictedDigit: number; reason: string } {
    if (ticks.length < 20) return { score: 0, predictedDigit: -1, reason: 'Not enough data' };
    const lastDigit = ticks[ticks.length - 1];
    const followCounts = Array(10).fill(0);
    let total = 0;
    for (let i = 0; i < ticks.length - 1; i++) {
        if (ticks[i] === lastDigit) {
            followCounts[ticks[i + 1]]++;
            total++;
        }
    }
    if (total < 3) return { score: 0, predictedDigit: -1, reason: `D${lastDigit} pair data insufficient` };
    let maxCount = 0, predicted = 0;
    followCounts.forEach((c, d) => { if (c > maxCount) { maxCount = c; predicted = d; } });
    const ratio = maxCount / total;
    // More aggressive: 15% = 40, 20% = 60, 25%+ = 80+
    const score = Math.min(100, Math.max(0, (ratio - 0.1) * 250 + 20));
    return { score, predictedDigit: predicted, reason: `After D${lastDigit} → D${predicted} (${(ratio * 100).toFixed(0)}%)` };
}

// ── Layer 4: Cross-Market Echo ──
function calcEchoScore(
    currentSymbol: string,
    currentDigit: number,
    allMarketData: Record<string, MarketData>,
): { score: number; echoDigit: number; reason: string } {
    let echoCount = 0;
    let totalChecks = 0;
    for (const [sym, md] of Object.entries(allMarketData)) {
        if (sym === currentSymbol) continue;
        if (md.ticks.length < 5) continue;
        const recent = md.ticks.slice(-5);
        totalChecks++;
        if (recent.includes(currentDigit)) echoCount++;
    }
    if (totalChecks < 3) return { score: 0, echoDigit: currentDigit, reason: 'Insufficient cross-market data' };
    const echoRatio = echoCount / totalChecks;
    // More aggressive: 40% = 40, 60% = 65, 80%+ = 90+
    const score = Math.min(100, Math.max(0, echoRatio * 110 + 20));
    return { score, echoDigit: currentDigit, reason: `D${currentDigit} in ${echoCount}/${totalChecks} markets` };
}

export const DigitHunter: React.FC = () => {
    const { transactions } = useStore();
    const cfg = loadCfg();
    const [stake, setStake] = useState(cfg.stake);
    const [confidenceThreshold, setConfidenceThreshold] = useState(cfg.confidenceThreshold);
    const [recoveryEnabled, setRecoveryEnabled] = useState(cfg.recoveryEnabled === 'true');
    const [maxRecoveryAttempts, setMaxRecoveryAttempts] = useState(cfg.maxRecoveryAttempts);
    const [running, setRunning] = useState(false);
    const [paused, setPaused] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [pnl, setPnl] = useState(0);
    const [trades, setTrades] = useState(0);
    const [wins, setWins] = useState(0);
    const [losses, setLosses] = useState(0);
    const [conn, setConn] = useState(false);
    const [bestMarket, setBestMarket] = useState('');
    const [bestScore, setBestScore] = useState(0);
    const [recoveryInfo, setRecoveryInfo] = useState({ phase: 'idle' as 'idle' | 'recovering' | 'paused', attempts: 0, currentStake: BASE_STAKE });

    const wsRef = useRef<MakotiWS | null>(null);
    const runRef = useRef(false);
    const pausedRef = useRef(false);
    const globalLock = useRef(false);
    const pnlRef = useRef(0);
    const cntRef = useRef(0);
    const winsRef = useRef(0);
    const lossesRef = useRef(0);
    const currentStakeRef = useRef(parseFloat(cfg.stake));
    const cfgRef = useRef({ stake: parseFloat(cfg.stake), threshold: parseFloat(cfg.confidenceThreshold), recovery: cfg.recoveryEnabled === 'true', maxRecovery: parseInt(cfg.maxRecoveryAttempts) });
    const lastTradeTime = useRef(0);
    const contractMapRef = useRef<Map<string, { symbol: string; stake: number; contractType: string }>>(new Map());
    const allMarketDataRef = useRef<Record<string, MarketData>>({});
    const recoveryPhaseRef = useRef<'idle' | 'recovering' | 'paused'>('idle');
    const recoveryAttemptsRef = useRef(0);
    const recoveryPauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastConsecutiveLossRef = useRef(0);

    // Config sync
    useEffect(() => { cfgRef.current = { stake: parseFloat(stake), threshold: parseFloat(confidenceThreshold), recovery: recoveryEnabled, maxRecovery: parseInt(maxRecoveryAttempts) }; }, [stake, confidenceThreshold, recoveryEnabled, maxRecoveryAttempts]);
    useEffect(() => { saveCfg({ stake, confidenceThreshold, recoveryEnabled: String(recoveryEnabled), maxRecoveryAttempts }); }, [stake, confidenceThreshold, recoveryEnabled, maxRecoveryAttempts]);

    const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
        setLogs(prev => [...prev.slice(-99), { time: ts(), msg, type }]);
    }, []);

    const updatePnl = useCallback((delta: number) => {
        pnlRef.current += delta;
        setPnl(pnlRef.current);
    }, []);

    const updateWins = useCallback((isWin: boolean, stakeAmt: number) => {
        cntRef.current++;
        setTrades(cntRef.current);
        if (isWin) { winsRef.current++; setWins(winsRef.current); updatePnl(stakeAmt * 0.95); }
        else { lossesRef.current++; setLosses(lossesRef.current); updatePnl(-stakeAmt); }
    }, [updatePnl]);

    // ── Initialize market data for all symbols ──
    useEffect(() => {
        ALL_SYMBOLS.forEach(sym => {
            if (!allMarketDataRef.current[sym]) {
                allMarketDataRef.current[sym] = {
                    symbol: sym, ticks: [], prices: [], lastDigit: null,
                    streakDigit: null, streakCount: 0,
                    pairHistory: new Map(), digitPcts: Array(10).fill(10),
                };
            }
        });
    }, []);

    // ── Score all markets ──
    const scoreAllMarkets = useCallback((): ScoredMarket | null => {
        const allData = allMarketDataRef.current;
        let best: ScoredMarket | null = null;

        for (const sym of ALL_SYMBOLS) {
            const md = allData[sym];
            if (!md || md.ticks.length < MIN_TICKS) continue;

            const lastDigit = md.ticks[md.ticks.length - 1];

            // Layer 1: Frequency
            const freq = calcFreqScore(md.ticks);

            // Layer 2: Streak
            const streak = calcStreakScore(md.ticks);

            // Layer 3: Pair
            const pair = calcPairScore(md.ticks);

            // Layer 4: Echo
            const echo = calcEchoScore(sym, lastDigit, allData);

            // Weighted total
            const totalScore = (freq.score * 0.30) + (streak.score * 0.25) + (pair.score * 0.25) + (echo.score * 0.20);

            // ── Contract selection: OVER/UNDER with specific barriers ──
            // Primary: OVER 2, OVER 3, UNDER 7, UNDER 6
            // Recovery: OVER 4, OVER 5, UNDER 5
            const pcts = getDigitPcts(md.ticks, 200);

            // Analyze digit groups for barrier selection
            const d012 = pcts[0] + pcts[1] + pcts[2];     // digits 0-2 (OVER 2 needs 2,3,4,5,6,7,8,9)
            const d0123 = pcts[0] + pcts[1] + pcts[2] + pcts[3]; // digits 0-3 (OVER 3 needs 3,4,5,6,7,8,9)
            const d789 = pcts[7] + pcts[8] + pcts[9];      // digits 7-9 (UNDER 7 needs 0,1,2,3,4,5,6)
            const d6789 = pcts[6] + pcts[7] + pcts[8] + pcts[9]; // digits 6-9 (UNDER 6 needs 0,1,2,3,4,5)
            const d45 = pcts[4] + pcts[5];                  // digits 4-5 (recovery zone)
            const d01234 = pcts[0] + pcts[1] + pcts[2] + pcts[3] + pcts[4]; // digits 0-4

            // Expected: each 3-digit group ~30%, 4-digit ~40%, 5-digit ~50%
            let contractType: string;
            let barrier: number;
            let reason: string;

            const isRecovery = recoveryPhaseRef.current === 'recovering';

            if (isRecovery) {
                // ── RECOVERY MODE: use tighter barriers for higher win rate ──
                // OVER 4 wins if digit 4,5,6,7,8,9 (60%)
                // OVER 5 wins if digit 5,6,7,8,9 (50%)
                // UNDER 5 wins if digit 0,1,2,3,4 (50%)
                if (d01234 > 52) {
                    // Low digits overrepresented → high digits due → OVER 4
                    contractType = 'DIGITOVER';
                    barrier = 4;
                    reason = `🔄 RECOVERY: Low digits ${d01234.toFixed(0)}% → OVER 4`;
                } else if (d6789 > 52) {
                    // High digits overrepresented → low digits due → UNDER 5
                    contractType = 'DIGITUNDER';
                    barrier = 5;
                    reason = `🔄 RECOVERY: High digits ${d6789.toFixed(0)}% → UNDER 5`;
                } else {
                    // Balanced → default recovery OVER 5 (50/50)
                    contractType = 'DIGITOVER';
                    barrier = 5;
                    reason = `🔄 RECOVERY: Balanced → OVER 5 (default)`;
                }
            } else {
                // ── PRIMARY MODE: use wider barriers for better payout ──
                // OVER 2 wins if digit 2,3,4,5,6,7,8,9 (80%)
                // OVER 3 wins if digit 3,4,5,6,7,8,9 (70%)
                // UNDER 7 wins if digit 0,1,2,3,4,5,6 (70%)
                // UNDER 6 wins if digit 0,1,2,3,4,5 (60%)

                if (d012 > 35) {
                    // Digits 0,1,2 overrepresented (35%+ vs expected 30%) → OVER 2
                    contractType = 'DIGITOVER';
                    barrier = 2;
                    reason = `D0-2 at ${d012.toFixed(0)}% (>35%) → OVER 2 (need 2-9)`;
                } else if (d789 > 35) {
                    // Digits 7,8,9 overrepresented → UNDER 7
                    contractType = 'DIGITUNDER';
                    barrier = 7;
                    reason = `D7-9 at ${d789.toFixed(0)}% (>35%) → UNDER 7 (need 0-6)`;
                } else if (d0123 > 42) {
                    // Digits 0,1,2,3 overrepresented → OVER 3
                    contractType = 'DIGITOVER';
                    barrier = 3;
                    reason = `D0-3 at ${d0123.toFixed(0)}% (>42%) → OVER 3 (need 3-9)`;
                } else if (d6789 > 42) {
                    // Digits 6,7,8,9 overrepresented → UNDER 6
                    contractType = 'DIGITUNDER';
                    barrier = 6;
                    reason = `D6-9 at ${d6789.toFixed(0)}% (>42%) → UNDER 6 (need 0-5)`;
                } else if (streak.streakCount >= 2) {
                    // Use streak direction with appropriate barrier
                    if (streak.digit <= 3) {
                        contractType = 'DIGITOVER';
                        barrier = 3;
                        reason = `D${streak.digit} streak ${streak.streakCount}x → OVER 3`;
                    } else {
                        contractType = 'DIGITUNDER';
                        barrier = 6;
                        reason = `D${streak.digit} streak ${streak.streakCount}x → UNDER 6`;
                    }
                } else {
                    // Default: OVER 2 (80% win rate, safest)
                    contractType = 'DIGITOVER';
                    barrier = 2;
                    reason = `No clear bias → OVER 2 (default, 80% win rate)`;
                }
            }

            const scored: ScoredMarket = {
                symbol: sym, freqScore: freq.score, streakScore: streak.score,
                pairScore: pair.score, echoScore: echo.score, totalScore,
                contractType, barrier, digit, reason,
            };

            if (!best || totalScore > best.totalScore) best = scored;
        }
        return best;
    }, []);

    // ── Execute trade ──
    const executeTrade = useCallback(async (market: ScoredMarket, stakeAmt: number, isRecovery: boolean) => {
        if (globalLock.current) return;
        globalLock.current = true;

        const params = {
            amount: stakeAmt, basis: 'stake', currency: 'USD',
            duration: 1, duration_unit: 't',
            symbol: market.symbol,
            contract_type: market.contractType,
            barrier: String(market.barrier),
        };

        const label = market.contractType === 'DIGITOVER'
            ? `OVER ${market.barrier}`
            : `UNDER ${market.barrier}`;
        const prefix = isRecovery ? '🔄 RECOVERY' : '🎯';

        try {
            const response = await sendViaNewSystemWithPromise({ buy: 1, price: stakeAmt, parameters: params });
            const contractId = response?.buy?.contract_id ?? response?.contract_id;
            if (contractId) {
                contractMapRef.current.set(String(contractId), {
                    symbol: market.symbol, stake: stakeAmt, contractType: market.contractType,
                });
                lastTradeTime.current = Date.now();
                addLog(`${prefix} [${market.totalScore.toFixed(0)}%] ${SYMBOL_LABELS[market.symbol]}: ${label} @ $${stakeAmt.toFixed(2)} — ${market.reason}`, 'trade');
                try {
                    transactions.onBotContractEvent({
                        contract_id: contractId,
                        transaction_ids: { buy: response?.buy?.transaction_id },
                        buy_price: stakeAmt, currency: 'USD',
                        contract_type: market.contractType,
                        underlying: market.symbol,
                        display_name: SYMBOL_LABELS[market.symbol],
                        date_start: Math.floor(Date.now() / 1000),
                        status: 'open',
                    } as any);
                } catch (_) {}
            } else {
                addLog(`Buy OK but no contract_id`, 'info');
                globalLock.current = false;
            }
        } catch (err: any) {
            addLog(`Buy error: ${err?.error?.message || err?.message || 'Unknown'}`, 'info');
            globalLock.current = false;
        }
    }, [addLog, transactions]);

    // ── Handle settlement ──
    const handleSettlement = useCallback((contractId: string, profit: number, isWin: boolean) => {
        const info = contractMapRef.current.get(contractId);
        if (!info) return;
        contractMapRef.current.delete(contractId);
        globalLock.current = false;

        updateWins(isWin, info.stake);

        if (isWin) {
            addLog(`✅ WIN +$${(info.stake * 0.95).toFixed(2)} on ${SYMBOL_LABELS[info.symbol]}`, 'win');
            // Reset recovery on win
            if (recoveryPhaseRef.current === 'recovering') {
                addLog('🟢 Recovery successful — resetting to base stake', 'recovery');
                recoveryPhaseRef.current = 'idle';
                recoveryAttemptsRef.current = 0;
                currentStakeRef.current = cfgRef.current.stake;
                setRecoveryInfo({ phase: 'idle', attempts: 0, currentStake: cfgRef.current.stake });
            }
            lastConsecutiveLossRef.current = 0;
        } else {
            addLog(`❌ LOSS -$${info.stake.toFixed(2)} on ${SYMBOL_LABELS[info.symbol]}`, 'loss');
            lastConsecutiveLossRef.current++;

            // Recovery logic
            if (cfgRef.current.recovery && recoveryPhaseRef.current !== 'paused') {
                recoveryAttemptsRef.current++;
                if (recoveryAttemptsRef.current > cfgRef.current.maxRecovery) {
                    // Max attempts reached → pause
                    addLog(`⏸ Max recovery attempts (${cfgRef.current.maxRecovery}) reached — pausing ${RECOVERY_PAUSE_MS / 1000}s`, 'recovery');
                    recoveryPhaseRef.current = 'paused';
                    setRecoveryInfo({ phase: 'paused', attempts: recoveryAttemptsRef.current, currentStake: currentStakeRef.current });
                    if (recoveryPauseTimerRef.current) clearTimeout(recoveryPauseTimerRef.current);
                    recoveryPauseTimerRef.current = setTimeout(() => {
                        addLog('▶ Resuming from pause — resetting to base stake', 'recovery');
                        recoveryPhaseRef.current = 'idle';
                        recoveryAttemptsRef.current = 0;
                        currentStakeRef.current = cfgRef.current.stake;
                        setRecoveryInfo({ phase: 'idle', attempts: 0, currentStake: cfgRef.current.stake });
                    }, RECOVERY_PAUSE_MS);
                } else {
                    // Increase stake for recovery
                    currentStakeRef.current = parseFloat((info.stake * MARTINGALE_FACTOR).toFixed(2));
                    recoveryPhaseRef.current = 'recovering';
                    setRecoveryInfo({ phase: 'recovering', attempts: recoveryAttemptsRef.current, currentStake: currentStakeRef.current });
                    addLog(`🔄 Recovery attempt ${recoveryAttemptsRef.current}/${cfgRef.current.maxRecovery} — stake: $${currentStakeRef.current.toFixed(2)}`, 'recovery');
                }
            }
        }
    }, [addLog, updateWins]);

    // ── WS message handler ──
    const onMessage = useCallback((data: any) => {
        // Tick data
        if (data.msg_type === 'tick') {
            const tick = data.tick;
            if (!tick) return;
            const sym = tick.symbol;
            const price = Number(tick.quote);
            if (isNaN(price)) return;
            const pipSize = sym.includes('R_100') || sym.includes('1HZ100V') || sym.includes('1HZ75V') || sym.includes('1HZ50V') || sym.includes('1HZ25V') || sym.includes('1HZ10V') ? 2 : (sym === 'R_75' || sym === 'R_50' ? 4 : 3);
            const priceStr = price.toFixed(pipSize);
            const lastDigit = parseInt(priceStr.slice(-1), 10);

            const md = allMarketDataRef.current[sym];
            if (!md) return;
            md.ticks.push(lastDigit);
            md.prices.push(price);
            md.lastDigit = lastDigit;
            if (md.ticks.length > MAX_TICKS) { md.ticks.shift(); md.prices.shift(); }
            md.digitPcts = getDigitPcts(md.ticks, 200);

            // Run scoring and trading
            if (!runRef.current || pausedRef.current || globalLock.current) return;
            if (recoveryPauseTimerRef.current && recoveryPhaseRef.current === 'paused') return;

            const now = Date.now();
            if (now - lastTradeTime.current < MIN_TRADE_INTERVAL_MS) return;

            const best = scoreAllMarkets();
            if (!best) return;

            setBestMarket(best.symbol);
            setBestScore(best.totalScore);

            const threshold = recoveryPhaseRef.current === 'recovering' ? RECOVERY_CONFIDENCE : cfgRef.current.threshold;

            if (best.totalScore >= threshold) {
                const stakeAmt = recoveryPhaseRef.current === 'recovering' ? currentStakeRef.current : cfgRef.current.stake;
                executeTrade(best, stakeAmt, recoveryPhaseRef.current === 'recovering');
            }
        }

        // Contract settlement
        if (data.msg_type === 'proposal_open_contract') {
            const poc = data.proposal_open_contract;
            if (!poc || !poc.is_sold) return;
            const cid = String(poc.contract_id);
            if (!contractMapRef.current.has(cid)) return;
            const profit = Number(poc.profit) || 0;
            handleSettlement(cid, profit, profit > 0);
        }
    }, [scoreAllMarkets, executeTrade, handleSettlement]);

    // ── Connect WS ──
    useEffect(() => {
        const ws = openMakotiWS(
            onMessage,
            () => { setConn(true); addLog('Connected to Deriv API', 'info'); },
            () => { setConn(false); },
        );
        wsRef.current = ws;
        return () => ws.close();
    }, [onMessage, addLog]);

    // ── Subscribe to ticks ──
    useEffect(() => {
        if (!conn || !running) return;
        const ws = wsRef.current;
        if (!ws) return;
        ALL_SYMBOLS.forEach(sym => {
            ws.send({ ticks_history: sym, style: 'ticks', count: 1, end: 'latest', subscribe: 1 });
        });
    }, [conn, running]);

    // ── Start / Stop ──
    const handleStart = useCallback(() => {
        setRunning(true);
        runRef.current = true;
        pausedRef.current = false;
        setPaused(false);
        currentStakeRef.current = parseFloat(stake);
        recoveryPhaseRef.current = 'idle';
        recoveryAttemptsRef.current = 0;
        lastTradeTime.current = 0;
        addLog(`▶ Digit Hunter started — stake: $${stake}, threshold: ${confidenceThreshold}%`, 'info');
    }, [stake, confidenceThreshold, addLog]);

    const handleStop = useCallback(() => {
        setRunning(false);
        runRef.current = false;
        pausedRef.current = false;
        setPaused(false);
        recoveryPhaseRef.current = 'idle';
        recoveryAttemptsRef.current = 0;
        currentStakeRef.current = parseFloat(stake);
        if (recoveryPauseTimerRef.current) clearTimeout(recoveryPauseTimerRef.current);
        addLog('⏹ Digit Hunter stopped', 'info');
    }, [stake, addLog]);

    const handlePause = useCallback(() => {
        pausedRef.current = !pausedRef.current;
        setPaused(pausedRef.current);
        addLog(pausedRef.current ? '⏸ Paused' : '▶ Resumed', 'info');
    }, [addLog]);

    // ── Cleanup ──
    useEffect(() => () => { if (recoveryPauseTimerRef.current) clearTimeout(recoveryPauseTimerRef.current); }, []);

    const logColor = (t: LogEntry['type']) => t === 'win' ? '#4caf50' : t === 'loss' ? '#f44336' : t === 'trade' ? '#2196f3' : t === 'recovery' ? '#ff9800' : t === 'trigger' ? '#9c27b0' : '#aaa';

    return (
        <div style={{ padding: 8, fontSize: 11, color: '#ccc', fontFamily: 'monospace' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ color: '#ffd700', fontWeight: 'bold', fontSize: 13 }}>🎯 DIGIT HUNTER</span>
                <span style={{ fontSize: 10, color: conn ? '#4caf50' : '#f44336' }}>{conn ? '● Connected' : '○ Disconnected'}</span>
            </div>

            {/* Config */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 6 }}>
                <label style={{ fontSize: 10, color: '#888' }}>Stake ($)
                    <input type="number" value={stake} onChange={e => setStake(e.target.value)}
                        style={{ width: '100%', background: '#1a1a2e', border: '1px solid #333', color: '#fff', padding: 2, fontSize: 10, borderRadius: 3 }}
                        step="0.05" min="0.01" />
                </label>
                <label style={{ fontSize: 10, color: '#888' }}>Threshold (%)
                    <input type="number" value={confidenceThreshold} onChange={e => setConfidenceThreshold(e.target.value)}
                        style={{ width: '100%', background: '#1a1a2e', border: '1px solid #333', color: '#fff', padding: 2, fontSize: 10, borderRadius: 3 }}
                        step="5" min="50" max="95" />
                </label>
                <label style={{ fontSize: 10, color: '#888', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="checkbox" checked={recoveryEnabled} onChange={e => setRecoveryEnabled(e.target.checked)} />
                    Recovery (1.5x)
                </label>
                <label style={{ fontSize: 10, color: '#888' }}>Max Recovery
                    <input type="number" value={maxRecoveryAttempts} onChange={e => setMaxRecoveryAttempts(e.target.value)}
                        style={{ width: '100%', background: '#1a1a2e', border: '1px solid #333', color: '#fff', padding: 2, fontSize: 10, borderRadius: 3 }}
                        step="1" min="1" max="10" />
                </label>
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                {!running ? (
                    <button onClick={handleStart} disabled={!conn}
                        style={{ flex: 1, padding: '4px 0', background: conn ? '#4caf50' : '#333', color: '#fff', border: 'none', borderRadius: 3, cursor: conn ? 'pointer' : 'not-allowed', fontSize: 11, fontWeight: 'bold' }}>
                        ▶ START
                    </button>
                ) : (
                    <>
                        <button onClick={handlePause}
                            style={{ flex: 1, padding: '4px 0', background: paused ? '#4caf50' : '#ff9800', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11 }}>
                            {paused ? '▶ RESUME' : '⏸ PAUSE'}
                        </button>
                        <button onClick={handleStop}
                            style={{ flex: 1, padding: '4px 0', background: '#f44336', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11 }}>
                            ⏹ STOP
                        </button>
                    </>
                )}
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3, marginBottom: 6, textAlign: 'center' }}>
                <div style={{ background: '#1a1a2e', padding: 3, borderRadius: 3 }}>
                    <div style={{ fontSize: 9, color: '#888' }}>P&L</div>
                    <div style={{ fontSize: 12, color: pnl >= 0 ? '#4caf50' : '#f44336', fontWeight: 'bold' }}>${pnl.toFixed(2)}</div>
                </div>
                <div style={{ background: '#1a1a2e', padding: 3, borderRadius: 3 }}>
                    <div style={{ fontSize: 9, color: '#888' }}>Trades</div>
                    <div style={{ fontSize: 12, color: '#fff' }}>{trades}</div>
                </div>
                <div style={{ background: '#1a1a2e', padding: 3, borderRadius: 3 }}>
                    <div style={{ fontSize: 9, color: '#888' }}>Wins</div>
                    <div style={{ fontSize: 12, color: '#4caf50' }}>{wins}</div>
                </div>
                <div style={{ background: '#1a1a2e', padding: 3, borderRadius: 3 }}>
                    <div style={{ fontSize: 9, color: '#888' }}>Losses</div>
                    <div style={{ fontSize: 12, color: '#f44336' }}>{losses}</div>
                </div>
            </div>

            {/* Best Market & Recovery */}
            {running && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, marginBottom: 6 }}>
                    <div style={{ background: '#1a1a2e', padding: 3, borderRadius: 3 }}>
                        <div style={{ fontSize: 9, color: '#888' }}>Best Market</div>
                        <div style={{ fontSize: 10, color: '#ffd700' }}>{bestMarket ? SYMBOL_LABELS[bestMarket] : 'Scanning...'}</div>
                        <div style={{ fontSize: 9, color: '#2196f3' }}>Score: {bestScore.toFixed(0)}%</div>
                    </div>
                    <div style={{ background: '#1a1a2e', padding: 3, borderRadius: 3 }}>
                        <div style={{ fontSize: 9, color: '#888' }}>Recovery</div>
                        <div style={{ fontSize: 10, color: recoveryInfo.phase === 'recovering' ? '#ff9800' : recoveryInfo.phase === 'paused' ? '#f44336' : '#4caf50' }}>
                            {recoveryInfo.phase === 'idle' ? 'Normal' : recoveryInfo.phase === 'recovering' ? `Attempt ${recoveryInfo.attempts}` : 'PAUSED'}
                        </div>
                        <div style={{ fontSize: 9, color: '#aaa' }}>Stake: ${recoveryInfo.currentStake.toFixed(2)}</div>
                    </div>
                </div>
            )}

            {/* Logs */}
            <div style={{ background: '#0d0d1a', borderRadius: 3, padding: 3, maxHeight: 150, overflowY: 'auto', border: '1px solid #222' }}>
                {logs.length === 0 && <div style={{ color: '#555', fontSize: 10 }}>No activity yet...</div>}
                {logs.map((l, i) => (
                    <div key={i} style={{ fontSize: 9, color: logColor(l.type), lineHeight: 1.4 }}>
                        <span style={{ color: '#555' }}>[{l.time}]</span> {l.msg}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default DigitHunter;
