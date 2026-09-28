import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_SYMBOLS, SYMBOL_LABELS, PIP_SIZES } from './makoti-ws';
import { sendViaNewSystemWithPromise, onNewSystemMessage } from '@/auth/NewDerivAuth';
import { useStore } from '@/hooks/useStore';
import { analyzeDigits, predictContract, getDigit, calcFreq, scanAllSymbols, type SignalResult, type DigitAnalysis, type SymbolState } from './trade-signal-engine';
import './trade-signal.scss';

interface TradeLog { time: string; msg: string; type: 'signal' | 'trade' | 'win' | 'loss' | 'info'; }

export const TradeSignal: React.FC = () => {
    const { transactions } = useStore();

    const [stake, setStake] = useState(() => localStorage.getItem('mw_ts_stake') || '1');
    const [duration, setDuration] = useState(() => localStorage.getItem('mw_ts_duration') || '1');
    const [signal, setSignal] = useState<SignalResult | null>(null);
    const [bestSymbol, setBestSymbol] = useState<string>('');
    const [symbolStates, setSymbolStates] = useState<Map<string, SymbolState>>(new Map());
    const [isRunning, setIsRunning] = useState(false);
    const [isTrading, setIsTrading] = useState(false);
    const [lastTrade, setLastTrade] = useState<string | null>(null);
    const [autoTrade, setAutoTrade] = useState(() => localStorage.getItem('mw_ts_auto') === 'true');
    const [logs, setLogs] = useState<TradeLog[]>([]);
    const [totalTicks, setTotalTicks] = useState(0);

    const allTicksRef = useRef<Map<string, number[]>>(new Map());
    const mountedRef = useRef(true);
    const autoTradeRef = useRef(autoTrade);
    autoTradeRef.current = autoTrade;
    const lastSignalRef = useRef<string>('');
    const contractMapRef = useRef<Map<string, any>>(new Map());
    const isTradingRef = useRef(false);
    isTradingRef.current = isTrading;
    const isRunningRef = useRef(false);
    isRunningRef.current = isRunning;

    const addLog = useCallback((msg: string, type: TradeLog['type'] = 'info') => {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLogs(prev => [...prev.slice(-80), { time, msg, type }]);
    }, []);

    // Subscribe to ALL symbols when running
    useEffect(() => {
        mountedRef.current = true;
        if (!isRunning) return;

        allTicksRef.current = new Map();
        ALL_SYMBOLS.forEach(s => allTicksRef.current.set(s, []));
        setSignal(null);
        setBestSymbol('');
        setSymbolStates(new Map());
        setTotalTicks(0);

        // Subscribe to all symbols
        if (window._newSystemWS?.readyState === WebSocket.OPEN) {
            ALL_SYMBOLS.forEach(sym => {
                window._newSystemWS!.send(JSON.stringify({ ticks_history: sym, style: 'ticks', count: 500, end: 'latest', subscribe: 1 }));
            });
            addLog(`Scanning ${ALL_SYMBOLS.length} markets...`, 'info');
        } else {
            addLog('WebSocket not connected', 'info');
        }

        const unsub = onNewSystemMessage((event: MessageEvent) => {
            if (!mountedRef.current || !isRunningRef.current) return;
            try {
                const data = JSON.parse(event.data);
                if (!data.tick) return;
                const sym = data.tick.symbol;
                if (!ALL_SYMBOLS.includes(sym)) return;
                const price = Number(data.tick.quote);
                if (isNaN(price)) return;
                const pip = PIP_SIZES[sym] ?? 2;
                const digit = getDigit(price, pip);
                const ticks = allTicksRef.current.get(sym) || [];
                const updated = [...ticks.slice(-499), digit];
                allTicksRef.current.set(sym, updated);
                setTotalTicks(prev => prev + 1);

                // Run analysis on THIS tick immediately
                if (updated.length >= 30) {
                    const ana = analyzeDigits(updated);
                    const sig = predictContract(ana, updated, sym);

                    if (sig.action === 'BUY' && sig.confidence >= 50) {
                        // Found a signal — set it and optionally trade
                        setSignal(sig);
                        setBestSymbol(sym);

                        const key = `${sym}_${sig.contractType}_${sig.barrier}`;
                        if (key !== lastSignalRef.current) {
                            lastSignalRef.current = key;
                            addLog(`SIGNAL: ${SYMBOL_LABELS[sym]} ${sig.contractType} ${sig.barrier} pred=${sig.predictedDigit} [${sig.confidence.toFixed(0)}%]`, 'signal');

                            if (autoTradeRef.current && !isTradingRef.current) {
                                executeTradeNow(sig);
                            }
                        }
                    }
                }
            } catch {}
        });

        return () => { mountedRef.current = false; unsub(); };
    }, [isRunning]);

    // Update symbol states for display (every 1s to avoid render spam)
    useEffect(() => {
        if (!isRunning) return;
        const id = setInterval(() => {
            const states = new Map<string, SymbolState>();
            let best: SignalResult | null = null;
            let bestSym = '';
            ALL_SYMBOLS.forEach(sym => {
                const ticks = allTicksRef.current.get(sym) || [];
                const analysis = analyzeDigits(ticks);
                const sig = predictContract(analysis, ticks, sym);
                states.set(sym, { ticks, analysis, signal: sig });
                if (sig.action === 'BUY' && sig.confidence >= 50) {
                    if (!best || sig.confidence > best.confidence) { best = sig; bestSym = sym; }
                }
            });
            setSymbolStates(states);
            if (best) { setSignal(best); setBestSymbol(bestSym); }
        }, 1000);
        return () => clearInterval(id);
    }, [isRunning]);

    // Execute trade IMMEDIATELY
    const executeTradeNow = useCallback(async (sig: SignalResult) => {
        if (isTradingRef.current) return;
        if (window._newSystemWS?.readyState !== WebSocket.OPEN) { addLog('WS not connected', 'info'); return; }

        setIsTrading(true);
        const tradeStake = parseFloat(stake) || 1;
        const tradeDuration = parseInt(duration) || 1;

        const params: any = {
            amount: tradeStake, basis: 'stake', contract_type: sig.contractType,
            currency: 'USD', duration: tradeDuration, duration_unit: 't',
            symbol: sig.symbol, barrier: sig.barrier,
        };

        try {
            addLog(`BUY: ${SYMBOL_LABELS[sig.symbol]} ${sig.contractType} ${sig.barrier} pred=${sig.predictedDigit} $${tradeStake}`, 'trade');
            const response = await sendViaNewSystemWithPromise({ buy: 1, price: tradeStake, parameters: params });
            const contractId = response?.buy?.contract_id;
            if (contractId) {
                contractMapRef.current.set(String(contractId), { ...sig, stake: tradeStake, openedAt: Date.now() });
                setLastTrade(`${sig.contractType} ${sig.barrier} pred=${sig.predictedDigit} #${contractId}`);
                addLog(`#${contractId} opened`, 'trade');
                try {
                    transactions.onBotContractEvent({
                        contract_id: contractId, transaction_ids: { buy: response?.buy?.transaction_id },
                        buy_price: tradeStake, currency: 'USD', contract_type: sig.contractType,
                        underlying: sig.symbol, display_name: SYMBOL_LABELS[sig.symbol],
                        date_start: Math.floor(Date.now() / 1000), status: 'open',
                    } as any);
                } catch {}
            }
        } catch (e: any) {
            addLog(`FAILED: ${e?.error?.message ?? e?.message ?? 'error'}`, 'loss');
        } finally {
            setIsTrading(false);
        }
    }, [stake, duration, addLog]);

    // Manual execute
    const handleManualExecute = useCallback(() => {
        if (signal && signal.action === 'BUY') executeTradeNow(signal);
    }, [signal, executeTradeNow]);

    // Stop
    const handleStop = useCallback(() => {
        setIsRunning(false);
        setSignal(null);
        setBestSymbol('');
        setSymbolStates(new Map());
        addLog('Stopped', 'info');
    }, [addLog]);

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
                        if (profit > 0) addLog(`WIN +$${profit.toFixed(2)} (${SYMBOL_LABELS[info.symbol] || info.symbol} ${info.contractType} ${info.barrier})`, 'win');
                        else addLog(`LOSS -$${Math.abs(profit).toFixed(2)} (${SYMBOL_LABELS[info.symbol] || info.symbol} ${info.contractType} ${info.barrier})`, 'loss');
                    });
                }
            } catch {}
        });
        return unsub;
    }, [addLog]);

    // Persist
    useEffect(() => { localStorage.setItem('mw_ts_stake', stake); }, [stake]);
    useEffect(() => { localStorage.setItem('mw_ts_duration', duration); }, [duration]);
    useEffect(() => { localStorage.setItem('mw_ts_auto', String(autoTrade)); }, [autoTrade]);

    const confidence = signal?.confidence ?? 0;
    const isBuy = signal?.action === 'BUY';
    const signalColor = isBuy ? (confidence >= 75 ? '#22c55e' : confidence >= 50 ? '#f59e0b' : '#64748b') : '#64748b';
    const currentDigits = bestSymbol ? (symbolStates.get(bestSymbol)?.ticks?.slice(-15) || []) : [];
    const currentFreq = bestSymbol ? calcFreq(symbolStates.get(bestSymbol)?.ticks || []) : [];

    return (
        <div className='ts-page'>
            {/* Header / Controls */}
            <div className='ts-controls'>
                <div className='ts-row'>
                    <div className='ts-field'>
                        <label>Stake $</label>
                        <input type='number' value={stake} onChange={e => setStake(e.target.value)} min={0.01} step={0.01} />
                    </div>
                    <div className='ts-field'>
                        <label>Ticks</label>
                        <input type='number' value={duration} onChange={e => setDuration(e.target.value)} min={1} max={10} step={1} />
                    </div>
                    <div className='ts-field ts-field--btn'>
                        {!isRunning ? (
                            <button className='ts-btn-start' onClick={() => setIsRunning(true)}>START</button>
                        ) : (
                            <button className='ts-btn-stop' onClick={handleStop}>STOP</button>
                        )}
                    </div>
                </div>
                <div className='ts-row'>
                    <label className='ts-auto-toggle'>
                        <input type='checkbox' checked={autoTrade} onChange={e => setAutoTrade(e.target.checked)} />
                        <span>Auto-Trade (50%+ confidence)</span>
                    </label>
                </div>
            </div>

            {/* Signal Card */}
            {isRunning && (
                <div className='ts-signal-card' style={{ borderColor: signalColor }}>
                    <div className='ts-signal-header'>
                        <span className='ts-signal-status' style={{ color: signalColor }}>
                            {isBuy ? 'TARGET ACQUIRED' : 'SCANNING'}
                        </span>
                        <span className='ts-signal-tick'>ticks: {totalTicks}</span>
                    </div>

                    {isBuy && signal && (
                        <div className='ts-signal-body'>
                            <div className='ts-signal-action'>
                                <span className='ts-signal-contract'>{signal.contractType} {signal.barrier}</span>
                                <span className='ts-signal-symbol'>{SYMBOL_LABELS[signal.symbol]}</span>
                            </div>
                            <div className='ts-prediction-row'>
                                <span className='ts-pred-label'>Predicted:</span>
                                <span className='ts-pred-digit'>{signal.predictedDigit}</span>
                            </div>
                            <div className='ts-signal-confidence'>
                                <div className='ts-confidence-bar'>
                                    <div className='ts-confidence-fill' style={{ width: `${confidence}%`, background: signalColor }} />
                                </div>
                                <span>{confidence.toFixed(0)}%</span>
                            </div>
                            <div className='ts-signal-reason'>{signal.reason}</div>
                            <button className='ts-execute' disabled={isTrading} onClick={handleManualExecute}>
                                {isTrading ? 'EXECUTING...' : `EXECUTE NOW`}
                            </button>
                        </div>
                    )}

                    {!isBuy && (
                        <div className='ts-signal-body'>
                            <div className='ts-signal-wait'>Scanning {ALL_SYMBOLS.length} markets for next tick...</div>
                        </div>
                    )}
                </div>
            )}

            {!isRunning && (
                <div className='ts-idle'>
                    <div className='ts-idle-icon'>⚡</div>
                    <div className='ts-idle-text'>Press START to scan all volatility markets simultaneously</div>
                </div>
            )}

            {/* Last Trade */}
            {lastTrade && (
                <div className='ts-last-trade'>
                    <span className='ts-last-trade-label'>Last:</span> {lastTrade}
                </div>
            )}

            {/* Best Market Last Digits */}
            {isRunning && currentDigits.length > 0 && (
                <div className='ts-digit-strip'>
                    <span className='ts-strip-label'>{SYMBOL_LABELS[bestSymbol] || bestSymbol}:</span>
                    <div className='ts-digits'>
                        {currentDigits.map((d, i) => (
                            <span key={i} className={`ts-digit ${d === signal?.predictedDigit ? 'ts-digit--predicted' : ''} ${i === currentDigits.length - 1 ? 'ts-digit--current' : ''}`}>{d}</span>
                        ))}
                    </div>
                </div>
            )}

            {/* Frequency Distribution */}
            {isRunning && currentFreq.length > 0 && (
                <div className='ts-freq-table'>
                    <div className='ts-freq-title'>Digit Distribution — {SYMBOL_LABELS[bestSymbol] || bestSymbol}</div>
                    <div className='ts-freq-row'>
                        {currentFreq.map((pct, d) => (
                            <div key={d} className='ts-freq-cell'>
                                <div className='ts-freq-digit'>{d}</div>
                                <div className='ts-freq-bar-wrap'>
                                    <div className='ts-freq-bar' style={{ height: `${pct * 3}px`, background: d === signal?.predictedDigit ? '#f97316' : '#334155' }} />
                                </div>
                                <div className='ts-freq-pct'>{pct.toFixed(1)}%</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* All Markets Overview */}
            {isRunning && symbolStates.size > 0 && (
                <div className='ts-markets-grid'>
                    <div className='ts-markets-title'>All Markets</div>
                    {ALL_SYMBOLS.map(sym => {
                        const st = symbolStates.get(sym);
                        const ticks = st?.ticks?.length || 0;
                        const sig = st?.signal;
                        const isActive = sig?.action === 'BUY' && (sig?.confidence || 0) >= 50;
                        return (
                            <div key={sym} className={`ts-market-row ${isActive ? 'ts-market-row--active' : ''}`}>
                                <span className='ts-market-name'>{SYMBOL_LABELS[sym]}</span>
                                <span className='ts-market-ticks'>#{ticks}</span>
                                {isActive && sig && (
                                    <span className='ts-market-sig'>
                                        {sig.contractType} {sig.barrier} [{sig.confidence.toFixed(0)}%]
                                    </span>
                                )}
                                {!isActive && (
                                    <span className='ts-market-wait'>waiting</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Analysis Details */}
            {signal && signal.details.length > 0 && isBuy && (
                <div className='ts-details'>
                    <div className='ts-details-title'>Analysis — {SYMBOL_LABELS[signal.symbol]}</div>
                    {signal.details.map((d, i) => <div key={i} className='ts-detail-item'>• {d}</div>)}
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
