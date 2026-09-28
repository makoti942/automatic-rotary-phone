import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_SYMBOLS, SYMBOL_LABELS, PIP_SIZES } from './makoti-ws';
import { sendViaNewSystemWithPromise, onNewSystemMessage } from '@/auth/NewDerivAuth';
import { useStore } from '@/hooks/useStore';
import { analyzeDigits, predictContract, getDigit, calcFreq, type SignalResult, type DigitAnalysis } from './trade-signal-engine';
import './trade-signal.scss';

/* ── Types ─────────────────────────────────────────────────────────────────── */
interface TradeLog {
    time: string;
    msg: string;
    type: 'signal' | 'trade' | 'win' | 'loss' | 'info';
}

/* ── Main Component ────────────────────────────────────────────────────────── */
export const TradeSignal: React.FC = () => {
    const { transactions } = useStore();

    const [activeSymbol, setActiveSymbol] = useState(() => localStorage.getItem('mw_ts_symbol') || 'R_100');
    const [stake, setStake] = useState(() => localStorage.getItem('mw_ts_stake') || '1');
    const [duration, setDuration] = useState(() => localStorage.getItem('mw_ts_duration') || '1');
    const [signal, setSignal] = useState<SignalResult | null>(null);
    const [analysis, setAnalysis] = useState<DigitAnalysis | null>(null);
    const [isTrading, setIsTrading] = useState(false);
    const [lastTrade, setLastTrade] = useState<string | null>(null);
    const [autoTrade, setAutoTrade] = useState(false);
    const [logs, setLogs] = useState<TradeLog[]>([]);
    const [tickCount, setTickCount] = useState(0);
    const [lastDigits, setLastDigits] = useState<number[]>([]);
    const [freqTable, setFreqTable] = useState<number[]>([]);

    const ticksRef = useRef<number[]>([]);
    const subIdRef = useRef<string | null>(null);
    const mountedRef = useRef(true);
    const autoTradeRef = useRef(autoTrade);
    autoTradeRef.current = autoTrade;
    const lastSignalRef = useRef<string>('');
    const contractMapRef = useRef<Map<string, any>>(new Map());
    const isTradingRef = useRef(false);
    isTradingRef.current = isTrading;

    // Persist config
    useEffect(() => {
        localStorage.setItem('mw_ts_symbol', activeSymbol);
        localStorage.setItem('mw_ts_stake', stake);
        localStorage.setItem('mw_ts_duration', duration);
    }, [activeSymbol, stake, duration]);

    const addLog = useCallback((msg: string, type: TradeLog['type'] = 'info') => {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLogs(prev => [...prev.slice(-50), { time, msg, type }]);
    }, []);

    // Subscribe to ticks
    useEffect(() => {
        mountedRef.current = true;
        if (subIdRef.current) {
            window._newSystemWS?.send(JSON.stringify({ forget: subIdRef.current }));
            subIdRef.current = null;
        }
        ticksRef.current = [];
        setTickCount(0);
        setSignal(null);
        setAnalysis(null);
        setLastDigits([]);
        setFreqTable([]);

        if (window._newSystemWS?.readyState === WebSocket.OPEN) {
            window._newSystemWS.send(JSON.stringify({ ticks_history: activeSymbol, style: 'ticks', count: 1000, end: 'latest', subscribe: 1 }));
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

    // Run analysis on every new tick
    useEffect(() => {
        if (ticksRef.current.length < 30) return;
        const id = setInterval(() => {
            if (!mountedRef.current) return;
            const ticks = ticksRef.current;
            const ana = analyzeDigits(ticks);
            const sig = predictContract(ana, ticks, activeSymbol);
            setAnalysis(ana);
            setSignal(sig);
            setLastDigits(ticks.slice(-15));
            setFreqTable(calcFreq(ticks));

            if (sig.action === 'BUY' && sig.confidence >= 70) {
                const key = `${sig.contractType}_${sig.barrier}`;
                if (key !== lastSignalRef.current) {
                    lastSignalRef.current = key;
                    addLog(`Signal: ${sig.contractType} ${sig.barrier} pred=${sig.predictedDigit} (${sig.confidence.toFixed(0)}%)`, 'signal');
                    if (autoTradeRef.current && !isTradingRef.current) {
                        executeTrade(sig);
                    }
                }
            }
        }, 500);
        return () => clearInterval(id);
    }, [activeSymbol, isTrading]);

    // Execute trade
    const executeTrade = useCallback(async (sig?: SignalResult) => {
        const s = sig || signal;
        if (!s || s.action !== 'BUY' || isTrading) return;
        if (window._newSystemWS?.readyState !== WebSocket.OPEN) { addLog('WS not connected', 'info'); return; }

        setIsTrading(true);
        const tradeStake = parseFloat(stake) || 1;
        const tradeDuration = parseInt(duration) || 1;

        const params: any = {
            amount: tradeStake, basis: 'stake', contract_type: s.contractType,
            currency: 'USD', duration: tradeDuration, duration_unit: 't',
            symbol: s.symbol, barrier: s.barrier,
        };
        const label = `${s.contractType} ${s.barrier}`;

        try {
            addLog(`Executing: ${label} @ ${SYMBOL_LABELS[s.symbol]} $${tradeStake} (pred ${s.predictedDigit})`, 'trade');
            const response = await sendViaNewSystemWithPromise({ buy: 1, price: tradeStake, parameters: params });
            const contractId = response?.buy?.contract_id;
            if (contractId) {
                contractMapRef.current.set(String(contractId), { ...s, stake: tradeStake, openedAt: Date.now() });
                setLastTrade(`${label} pred=${s.predictedDigit} #${contractId}`);
                addLog(`Contract #${contractId} opened`, 'trade');
                try {
                    transactions.onBotContractEvent({
                        contract_id: contractId, transaction_ids: { buy: response?.buy?.transaction_id },
                        buy_price: tradeStake, currency: 'USD', contract_type: s.contractType,
                        underlying: s.symbol, display_name: SYMBOL_LABELS[s.symbol],
                        date_start: Math.floor(Date.now() / 1000), status: 'open',
                    } as any);
                } catch {}
            }
        } catch (e: any) {
            addLog(`Trade failed: ${e?.error?.message ?? e?.message ?? 'error'}`, 'loss');
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
                        const closed = poc?.is_sold === true || ['sold', 'won', 'lost', 'closed', 'expired'].includes(String(poc?.status ?? '').toLowerCase());
                        if (!closed) return;
                        const info = contractMapRef.current.get(key);
                        contractMapRef.current.delete(key);
                        const profit = Number(poc.profit ?? 0);
                        if (profit > 0) addLog(`WIN +$${profit.toFixed(2)} (${info.contractType} ${info.barrier} pred=${info.predictedDigit})`, 'win');
                        else addLog(`LOSS -$${Math.abs(profit).toFixed(2)} (${info.contractType} ${info.barrier} pred=${info.predictedDigit})`, 'loss');
                    });
                }
            } catch {}
        });
        return unsub;
    }, [addLog]);

    const confidence = signal?.confidence ?? 0;
    const isBuy = signal?.action === 'BUY';
    const signalColor = isBuy ? (confidence >= 75 ? '#22c55e' : confidence >= 50 ? '#f59e0b' : '#64748b') : '#64748b';
    const predicted = analysis?.predictedDigit ?? 5;

    return (
        <div className='ts-page'>
            {/* Signal Card */}
            <div className='ts-signal-card' style={{ borderColor: signalColor }}>
                <div className='ts-signal-header'>
                    <span className='ts-signal-status' style={{ color: signalColor }}>
                        {isBuy ? 'TARGET ACQUIRED' : 'SCANNING'}
                    </span>
                    <span className='ts-signal-tick'>#{tickCount}</span>
                </div>

                {isBuy && signal && (
                    <div className='ts-signal-body'>
                        <div className='ts-signal-action'>
                            <span className='ts-signal-contract'>{signal.contractType} {signal.barrier}</span>
                            <span className='ts-signal-symbol'>{SYMBOL_LABELS[signal.symbol]}</span>
                        </div>
                        <div className='ts-prediction-row'>
                            <span className='ts-pred-label'>Predicted digit:</span>
                            <span className='ts-pred-digit'>{signal.predictedDigit}</span>
                        </div>
                        <div className='ts-signal-confidence'>
                            <div className='ts-confidence-bar'>
                                <div className='ts-confidence-fill' style={{ width: `${confidence}%`, background: signalColor }} />
                            </div>
                            <span>{confidence.toFixed(0)}%</span>
                        </div>
                        <div className='ts-signal-reason'>{signal.reason}</div>
                    </div>
                )}

                {!isBuy && (
                    <div className='ts-signal-body'>
                        <div className='ts-prediction-row'>
                            <span className='ts-pred-label'>Next digit:</span>
                            <span className='ts-pred-digit'>{predicted}</span>
                        </div>
                        <div className='ts-signal-wait'>{signal?.reason || 'Collecting ticks...'}</div>
                    </div>
                )}
            </div>

            {/* Controls */}
            <div className='ts-controls'>
                <div className='ts-row'>
                    <div className='ts-field'>
                        <label>Market</label>
                        <select value={activeSymbol} onChange={e => setActiveSymbol(e.target.value)}>
                            {ALL_SYMBOLS.map(s => <option key={s} value={s}>{SYMBOL_LABELS[s]}</option>)}
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
                    <button className='ts-execute' disabled={!isBuy || isTrading || confidence < 50} onClick={() => executeTrade()}>
                        {isTrading ? '...' : isBuy ? `EXECUTE ${signal?.contractType} ${signal?.barrier}` : 'SCANNING'}
                    </button>
                </div>
                <div className='ts-row'>
                    <label className='ts-auto-toggle'>
                        <input type='checkbox' checked={autoTrade} onChange={e => setAutoTrade(e.target.checked)} />
                        <span>Auto-Trade (70%+ confidence)</span>
                    </label>
                </div>
            </div>

            {/* Last Trade */}
            {lastTrade && (
                <div className='ts-last-trade'>
                    <span className='ts-last-trade-label'>Last:</span> {lastTrade}
                </div>
            )}

            {/* Last 15 Digits */}
            {lastDigits.length > 0 && (
                <div className='ts-digit-strip'>
                    <span className='ts-strip-label'>Last digits:</span>
                    <div className='ts-digits'>
                        {lastDigits.map((d, i) => (
                            <span key={i} className={`ts-digit ${d === predicted ? 'ts-digit--predicted' : ''} ${i === lastDigits.length - 1 ? 'ts-digit--current' : ''}`}>{d}</span>
                        ))}
                    </div>
                </div>
            )}

            {/* Digit Frequency Table */}
            {freqTable.length > 0 && (
                <div className='ts-freq-table'>
                    <div className='ts-freq-title'>Digit Distribution</div>
                    <div className='ts-freq-row'>
                        {freqTable.map((pct, d) => (
                            <div key={d} className='ts-freq-cell'>
                                <div className='ts-freq-digit'>{d}</div>
                                <div className='ts-freq-bar-wrap'>
                                    <div className='ts-freq-bar' style={{ height: `${pct * 3}px`, background: d === predicted ? '#f97316' : '#334155' }} />
                                </div>
                                <div className='ts-freq-pct'>{pct.toFixed(1)}%</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Analysis Breakdown */}
            {analysis && analysis.digitScores.some(s => s > 0) && (
                <div className='ts-analysis-grid'>
                    <div className='ts-analysis-title'>Analysis Breakdown</div>

                    {/* Digit Scores */}
                    <div className='ts-scores'>
                        {analysis.digitScores.map((s, d) => (
                            <div key={d} className={`ts-score-bar ${d === predicted ? 'ts-score-bar--best' : ''}`}>
                                <span className='ts-score-digit'>{d}</span>
                                <div className='ts-score-track'>
                                    <div className='ts-score-fill' style={{ width: `${(s / Math.max(...analysis.digitScores, 1)) * 100}%` }} />
                                </div>
                                <span className='ts-score-val'>{s.toFixed(1)}</span>
                            </div>
                        ))}
                    </div>

                    {/* Transition from last digit */}
                    {analysis.transitionProbs.length > 0 && (
                        <div className='ts-transitions'>
                            <div className='ts-sub-title'>Transition from digit {ticksRef.current[ticksRef.current.length - 1] ?? '?'}</div>
                            <div className='ts-trans-row'>
                                {analysis.transitionProbs.map((p, d) => (
                                    <div key={d} className='ts-trans-cell'>
                                        <span className='ts-trans-pct'>{(p * 100).toFixed(0)}%</span>
                                        <span className='ts-trans-digit'>{d}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Gap Pressure */}
                    {analysis.gapPressure.length > 0 && (
                        <div className='ts-gaps'>
                            <div className='ts-sub-title'>Gap Pressure (overdue)</div>
                            <div className='ts-gap-row'>
                                {analysis.gapPressure.map((g, d) => (
                                    <div key={d} className='ts-gap-cell'>
                                        <div className='ts-gap-bar' style={{ height: `${g * 0.4}px` }} />
                                        <span className='ts-gap-digit'>{d}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Pattern */}
                    {analysis.patternMatch !== 'no match' && analysis.patternMatch !== 'insufficient data' && (
                        <div className='ts-pattern-info'>
                            <span>Pattern: {analysis.patternMatch}</span>
                            {analysis.patternWinRate > 0 && <span> -> digit {analysis.predictedDigit} ({analysis.patternWinRate.toFixed(0)}%)</span>}
                        </div>
                    )}

                    {/* Streak */}
                    {analysis.streakInfo.len >= 2 && (
                        <div className='ts-streak-info'>
                            Streak: {analysis.streakInfo.len}x digit {analysis.streakInfo.digit}
                        </div>
                    )}

                    {/* Signal details */}
                    {signal && signal.details.length > 0 && (
                        <div className='ts-details'>
                            {signal.details.map((d, i) => <div key={i} className='ts-detail-item'>• {d}</div>)}
                        </div>
                    )}
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
