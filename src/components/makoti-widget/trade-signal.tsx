import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_SYMBOLS, SYMBOL_LABELS, PIP_SIZES } from './makoti-ws';
import { sendViaNewSystemWithPromise, onNewSystemMessage } from '@/auth/NewDerivAuth';
import { useStore } from '@/hooks/useStore';
import './trade-signal.scss';

/* ── Types ─────────────────────────────────────────────────────────────────── */
interface TickData {
    price: number;
    digit: number;
    epoch: number;
}

interface SignalResult {
    action: 'BUY' | 'WAIT';
    contractType: string;
    barrier: number;
    symbol: string;
    confidence: number;
    reason: string;
    details: string[];
}

interface TradeLog {
    time: string;
    msg: string;
    type: 'signal' | 'trade' | 'win' | 'loss' | 'info';
}

/* ── Analysis Functions ────────────────────────────────────────────────────── */
function getDigit(price: number, pip: number): number {
    return Number(Number(price).toFixed(pip).slice(-1));
}

function calcFreq(ticks: number[]): number[] {
    const counts = new Array(10).fill(0);
    ticks.forEach(d => { if (d >= 0 && d <= 9) counts[d]++; });
    const total = counts.reduce((a, v) => a + v, 0);
    return total > 0 ? counts.map(c => (c / total) * 100) : counts;
}

function calcGap(ticks: number[]): number[] {
    const gaps = new Array(10).fill(0);
    for (let i = ticks.length - 1; i >= 0; i--) {
        const d = ticks[i];
        if (d >= 0 && d <= 9 && gaps[d] === 0) gaps[d] = ticks.length - 1 - i;
    }
    for (let i = 0; i < 10; i++) { if (gaps[i] === 0) gaps[i] = ticks.length; }
    return gaps;
}

function calcStreak(ticks: number[]): { digit: number; len: number } {
    if (ticks.length === 0) return { digit: -1, len: 0 };
    const last = ticks[ticks.length - 1];
    let len = 1;
    for (let i = ticks.length - 2; i >= 0; i--) {
        if (ticks[i] === last) len++;
        else break;
    }
    return { digit: last, len };
}

function calcChiSquare(ticks: number[]): number {
    const expected = ticks.length / 10;
    if (expected === 0) return 0;
    const counts = new Array(10).fill(0);
    ticks.forEach(d => { if (d >= 0 && d <= 9) counts[d]++; });
    let chi2 = 0;
    counts.forEach(c => { chi2 += Math.pow(c - expected, 2) / expected; });
    return chi2;
}

function calcEntropy(ticks: number[]): number {
    const freq = calcFreq(ticks);
    let entropy = 0;
    freq.forEach(p => {
        if (p > 0) entropy -= (p / 100) * Math.log2(p / 100);
    });
    return entropy;
}

function calcMomentum(ticks: number[]): number[] {
    const recent = ticks.slice(-20);
    const older = ticks.slice(-50, -20);
    if (recent.length === 0 || older.length === 0) return new Array(10).fill(0);
    const rFreq = calcFreq(recent);
    const oFreq = calcFreq(older);
    return rFreq.map((r, i) => r - oFreq[i]);
}

/* ── Combined Signal Analysis ──────────────────────────────────────────────── */
function analyzeSignal(ticks: number[], pip: number, symbol: string): SignalResult {
    const details: string[] = [];
    let overScore = 0;
    let underScore = 0;
    let matchScore = 0;
    let differScore = 0;

    if (ticks.length < 20) {
        return { action: 'WAIT', contractType: 'NONE', barrier: 5, symbol, confidence: 0, reason: 'Collecting data...', details: [] };
    }

    const freq = calcFreq(ticks);
    const gaps = calcGap(ticks);
    const streak = calcStreak(ticks);
    const chi2 = calcChiSquare(ticks);
    const entropy = calcEntropy(ticks);
    const momentum = calcMomentum(ticks);

    // 1. Gap Analysis — overdue digits
    const maxGap = Math.max(...gaps);
    const overdueDigit = gaps.indexOf(maxGap);
    if (maxGap > 30) {
        details.push(`Digit ${overdueDigit} overdue (${maxGap} ticks)`);
        // If overdue digit is high (6-9), UNDER is likely; if low (0-3), OVER is likely
        if (overdueDigit >= 6) underScore += 15;
        else if (overdueDigit <= 3) overScore += 15;
    }

    // 2. Frequency Bias — digits far from 10%
    freq.forEach((pct, d) => {
        const deviation = pct - 10;
        if (Math.abs(deviation) > 5) {
            if (d <= 4) overScore += deviation > 0 ? -5 : 5;
            else underScore += deviation > 0 ? -5 : 5;
        }
    });

    // 3. Streak Analysis
    if (streak.len >= 3) {
        details.push(`${streak.len}x digit ${streak.digit} streak`);
        if (streak.digit <= 4) underScore += streak.len * 5;
        else overScore += streak.len * 5;
        if (streak.len >= 5) {
            details.push('Streak fatigue — reversal likely');
            if (streak.digit <= 4) overScore += 10;
            else underScore += 10;
        }
    }

    // 4. Chi-Square — market bias
    if (chi2 > 16) {
        details.push(`Market biased (χ²=${chi2.toFixed(1)})`);
        // Find the most over-represented digit
        const expected = ticks.length / 10;
        let maxDev = 0, biasedDigit = 5;
        freq.forEach((p, d) => {
            const dev = Math.abs(p - 10);
            if (dev > maxDev) { maxDev = dev; biasedDigit = d; }
        });
        if (biasedDigit <= 4) underScore += 10;
        else overScore += 10;
    }

    // 5. Entropy — predictability
    if (entropy < 3.0) {
        details.push(`Low entropy (${entropy.toFixed(2)}) — predictable`);
        overScore += 5;
        underScore += 5;
    } else if (entropy > 3.3) {
        details.push(`High entropy (${entropy.toFixed(2)}) — random`);
    }

    // 6. Momentum — recent trend
    let momentumBias = 0;
    momentum.forEach((m, d) => {
        if (d <= 4) momentumBias -= m;
        else momentumBias += m;
    });
    if (Math.abs(momentumBias) > 3) {
        if (momentumBias > 0) { underScore += 10; details.push('UNDER momentum rising'); }
        else { overScore += 10; details.push('OVER momentum rising'); }
    }

    // 7. Determine barrier
    const highDigits = freq.slice(6, 10).reduce((a, v) => a + v, 0);
    const lowDigits = freq.slice(0, 5).reduce((a, v) => a + v, 0);

    let barrier = 5;
    let contractType = 'DIGITUNDER';
    let direction = 'UNDER';

    if (overScore > underScore + 10) {
        contractType = 'DIGITOVER';
        direction = 'OVER';
        barrier = highDigits > 45 ? 4 : 3;
    } else if (underScore > overScore + 10) {
        contractType = 'DIGITUNDER';
        direction = 'UNDER';
        barrier = lowDigits > 45 ? 6 : 7;
    } else {
        return { action: 'WAIT', contractType: 'NONE', barrier: 5, symbol, confidence: 0, reason: 'No clear edge', details };
    }

    // 8. Confidence score
    const diff = Math.abs(overScore - underScore);
    const confidence = Math.min(95, 50 + diff * 2 + (streak.len >= 3 ? 10 : 0) + (chi2 > 16 ? 10 : 0));

    if (confidence < 65) {
        return { action: 'WAIT', contractType: 'NONE', barrier: 5, symbol, confidence, reason: 'Confidence too low', details };
    }

    const reason = `${direction} ${barrier} — ${details[0] || 'multi-factor'}`;

    return { action: 'BUY', contractType, barrier, symbol, confidence, reason, details };
}

/* ── Main Component ────────────────────────────────────────────────────────── */
export const TradeSignal: React.FC = () => {
    const { transactions } = useStore();

    const [activeSymbol, setActiveSymbol] = useState(() => localStorage.getItem('mw_ts_symbol') || 'R_100');
    const [stake, setStake] = useState(() => localStorage.getItem('mw_ts_stake') || '1');
    const [duration, setDuration] = useState(() => localStorage.getItem('mw_ts_duration') || '1');
    const [signal, setSignal] = useState<SignalResult | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isTrading, setIsTrading] = useState(false);
    const [lastTrade, setLastTrade] = useState<string | null>(null);
    const [autoTrade, setAutoTrade] = useState(false);
    const [logs, setLogs] = useState<TradeLog[]>([]);
    const [tickCount, setTickCount] = useState(0);

    const ticksRef = useRef<number[]>([]);
    const subIdRef = useRef<string | null>(null);
    const mountedRef = useRef(true);
    const autoTradeRef = useRef(autoTrade);
    autoTradeRef.current = autoTrade;
    const lastSignalRef = useRef<string>('');
    const contractMapRef = useRef<Map<string, any>>(new Map());

    // Persist config
    useEffect(() => {
        localStorage.setItem('mw_ts_symbol', activeSymbol);
        localStorage.setItem('mw_ts_stake', stake);
        localStorage.setItem('mw_ts_duration', duration);
    }, [activeSymbol, stake, duration]);

    // Add log
    const addLog = useCallback((msg: string, type: TradeLog['type'] = 'info') => {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLogs(prev => [...prev.slice(-50), { time, msg, type }]);
    }, []);

    // Subscribe to ticks
    useEffect(() => {
        if (subIdRef.current) {
            window._newSystemWS?.send(JSON.stringify({ forget: subIdRef.current }));
            subIdRef.current = null;
        }
        ticksRef.current = [];
        setTickCount(0);
        setSignal(null);

        if (window._newSystemWS?.readyState === WebSocket.OPEN) {
            const sub = { ticks_history: activeSymbol, style: 'ticks', count: 1000, end: 'latest', subscribe: 1 };
            window._newSystemWS.send(JSON.stringify(sub));
        }

        const unsub = onNewSystemMessage((event: MessageEvent) => {
            if (!mountedRef.current) return;
            try {
                const data = JSON.parse(event.data);
                if (data.tick && data.tick.symbol === activeSymbol) {
                    const price = Number(data.tick.quote);
                    if (isNaN(price)) return;
                    const pip = PIP_SIZES[activeSymbol] ?? 2;
                    const digit = getDigit(price, pip);
                    ticksRef.current = [...ticksRef.current.slice(-999), digit];
                    setTickCount(ticksRef.current.length);
                }
            } catch {}
        });

        return () => { mountedRef.current = false; unsub(); };
    }, [activeSymbol]);

    // Run analysis
    useEffect(() => {
        if (ticksRef.current.length < 20) return;
        const interval = setInterval(() => {
            if (!mountedRef.current) return;
            const result = analyzeSignal(ticksRef.current, PIP_SIZES[activeSymbol] ?? 2, activeSymbol);
            setSignal(result);

            if (result.action === 'BUY' && result.confidence >= 75) {
                const sigKey = `${result.contractType}_${result.barrier}_${result.symbol}`;
                if (sigKey !== lastSignalRef.current) {
                    lastSignalRef.current = sigKey;
                    addLog(`Signal: ${result.contractType} ${result.barrier} @ ${SYMBOL_LABELS[result.symbol]} (${result.confidence}%)`, 'signal');

                    if (autoTradeRef.current && !isTrading) {
                        executeTrade(result);
                    }
                }
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [activeSymbol, isTrading]);

    // Execute trade
    const executeTrade = useCallback(async (sig?: SignalResult) => {
        const s = sig || signal;
        if (!s || s.action !== 'BUY' || isTrading) return;
        if (window._newSystemWS?.readyState !== WebSocket.OPEN) {
            addLog('WebSocket not connected', 'info');
            return;
        }

        setIsTrading(true);
        const tradeStake = parseFloat(stake) || 1;
        const tradeDuration = parseInt(duration) || 1;

        const params: any = {
            amount: tradeStake,
            basis: 'stake',
            contract_type: s.contractType,
            currency: 'USD',
            duration: tradeDuration,
            duration_unit: 't',
            symbol: s.symbol,
            barrier: s.barrier,
        };

        const label = `${s.contractType} ${s.barrier}`;

        try {
            addLog(`Executing: ${label} @ ${SYMBOL_LABELS[s.symbol]} $${tradeStake}`, 'trade');
            const response = await sendViaNewSystemWithPromise({ buy: 1, price: tradeStake, parameters: params });
            const contractId = response?.buy?.contract_id;
            if (contractId) {
                contractMapRef.current.set(String(contractId), {
                    symbol: s.symbol,
                    stake: tradeStake,
                    contractType: s.contractType,
                    barrier: s.barrier,
                    openedAt: Date.now(),
                });
                setLastTrade(`${label} — Contract #${contractId}`);
                addLog(`Contract #${contractId} opened`, 'trade');
                try {
                    transactions.onBotContractEvent({
                        contract_id: contractId,
                        transaction_ids: { buy: response?.buy?.transaction_id },
                        buy_price: tradeStake,
                        currency: 'USD',
                        contract_type: s.contractType,
                        underlying: s.symbol,
                        display_name: SYMBOL_LABELS[s.symbol],
                        date_start: Math.floor(Date.now() / 1000),
                        status: 'open',
                    } as any);
                } catch {}
            }
        } catch (e: any) {
            const msg = e?.error?.message ?? e?.message ?? 'Trade failed';
            addLog(`Trade failed: ${msg}`, 'loss');
        } finally {
            setIsTrading(false);
        }
    }, [signal, stake, duration, isTrading, addLog]);

    // Listen for contract settlement
    useEffect(() => {
        const unsub = onNewSystemMessage((event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.msg_type === 'proposal_open_contract') {
                    const list = Array.isArray(data.proposal_open_contract) ? data.proposal_open_contract : [data.proposal_open_contract];
                    list.forEach((poc: any) => {
                        const key = String(poc?.contract_id ?? '');
                        if (!contractMapRef.current.has(key)) return;
                        const closedStatuses = ['sold', 'won', 'lost', 'closed', 'expired'];
                        const isSold = poc?.is_sold === true || closedStatuses.includes(String(poc?.status ?? '').toLowerCase());
                        if (!isSold) return;
                        const info = contractMapRef.current.get(key);
                        contractMapRef.current.delete(key);
                        const profit = Number(poc.profit ?? 0);
                        if (profit > 0) {
                            addLog(`WIN +$${profit.toFixed(2)} (${info.contractType} ${info.barrier})`, 'win');
                        } else {
                            addLog(`LOSS $${Math.abs(profit).toFixed(2)} (${info.contractType} ${info.barrier})`, 'loss');
                        }
                    });
                }
            } catch {}
        });
        return unsub;
    }, [addLog]);

    const confidence = signal?.confidence ?? 0;
    const isBuy = signal?.action === 'BUY';
    const signalColor = isBuy ? (confidence >= 80 ? '#22c55e' : confidence >= 65 ? '#f59e0b' : '#64748b') : '#64748b';

    return (
        <div className='ts-page'>
            {/* Signal Display */}
            <div className='ts-signal-card' style={{ borderColor: signalColor }}>
                <div className='ts-signal-header'>
                    <span className='ts-signal-status' style={{ color: signalColor }}>
                        {isBuy ? '🟢 SIGNAL' : '⏸️ WAIT'}
                    </span>
                    <span className='ts-signal-tick'>#{tickCount}</span>
                </div>

                {isBuy && signal && (
                    <div className='ts-signal-body'>
                        <div className='ts-signal-action'>
                            <span className='ts-signal-contract'>{signal.contractType} {signal.barrier}</span>
                            <span className='ts-signal-symbol'>{SYMBOL_LABELS[signal.symbol]}</span>
                        </div>
                        <div className='ts-signal-confidence'>
                            <div className='ts-confidence-bar'>
                                <div className='ts-confidence-fill' style={{ width: `${confidence}%`, background: signalColor }} />
                            </div>
                            <span>{confidence}%</span>
                        </div>
                        <div className='ts-signal-reason'>{signal.reason}</div>
                    </div>
                )}

                {!isBuy && (
                    <div className='ts-signal-body'>
                        <div className='ts-signal-wait'>{signal?.reason || 'Analyzing...'}</div>
                    </div>
                )}
            </div>

            {/* Controls */}
            <div className='ts-controls'>
                <div className='ts-row'>
                    <div className='ts-field'>
                        <label>Market</label>
                        <select value={activeSymbol} onChange={e => setActiveSymbol(e.target.value)}>
                            {ALL_SYMBOLS.map(s => (
                                <option key={s} value={s}>{SYMBOL_LABELS[s]}</option>
                            ))}
                        </select>
                    </div>
                    <div className='ts-field'>
                        <label>Stake $</label>
                        <input type='number' value={stake} onChange={e => setStake(e.target.value)} min={0.01} step={0.01} />
                    </div>
                    <div className='ts-field'>
                        <label>Ticks</label>
                        <input type='number' value={duration} onChange={e => setDuration(e.target.value)} min={1} max={10} step={1} />
                    </div>
                </div>

                <div className='ts-row'>
                    <button
                        className='ts-execute'
                        disabled={!isBuy || isTrading || confidence < 65}
                        onClick={() => executeTrade()}
                    >
                        {isTrading ? '...' : isBuy ? `EXECUTE ${signal?.contractType} ${signal?.barrier}` : 'WAITING'}
                    </button>
                </div>

                <div className='ts-row'>
                    <label className='ts-auto-toggle'>
                        <input type='checkbox' checked={autoTrade} onChange={e => setAutoTrade(e.target.checked)} />
                        <span>Auto-Trade (75%+ confidence)</span>
                    </label>
                </div>
            </div>

            {/* Last Trade */}
            {lastTrade && (
                <div className='ts-last-trade'>
                    <span className='ts-last-trade-label'>Last:</span> {lastTrade}
                </div>
            )}

            {/* Analysis Details */}
            {signal && signal.details.length > 0 && (
                <div className='ts-details'>
                    <div className='ts-details-title'>Analysis</div>
                    {signal.details.map((d, i) => (
                        <div key={i} className='ts-detail-item'>• {d}</div>
                    ))}
                </div>
            )}

            {/* Logs */}
            <div className='ts-logs'>
                {logs.slice().reverse().map((log, i) => (
                    <div key={i} className={`ts-log ts-log--${log.type}`}>
                        <span className='ts-log-time'>{log.time}</span>
                        <span className='ts-log-msg'>{log.msg}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default TradeSignal;
