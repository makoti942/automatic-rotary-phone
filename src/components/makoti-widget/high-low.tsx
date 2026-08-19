import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@/hooks/useStore';
import { SYMBOL_LABELS, openMakotiWS, MakotiWS } from './makoti-ws';
import { onNewSystemMessage } from '@/auth/NewDerivAuth';
import {
    HL_SYMBOLS, DEFAULT_CONFIG, HighLowConfig, TradeRecord, Candle,
    executeHighLowTrade, buildCandles, getBandTouch, stepPattern, newPattern,
    tickDirection, TickPattern, BbTouch,
    MAX_TICKS, MIN_TICKS, TRADE_DURATION, MIN_STREAK,
} from './high-low-engine';

const LS_CONFIG_KEY = 'mw_hl_config';

function loadConfig(): HighLowConfig {
    try { const raw = localStorage.getItem(LS_CONFIG_KEY); return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : DEFAULT_CONFIG; }
    catch { return DEFAULT_CONFIG; }
}
function saveConfig(cfg: HighLowConfig) {
    try { localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(cfg)); } catch {}
}

interface SymData {
    prices: number[];
    times: number[];
    pat: TickPattern;
    candles: Candle[];
    ready: boolean;
}

interface BoardRow {
    side: 'upper' | 'lower' | null;
    streak: number;
    awaiting: boolean;
    price: number;
    bb: { upper: number; middle: number; lower: number } | null;
}

function shortSym(sym: string): string {
    return sym.startsWith('1HZ') ? `1s${sym.slice(4, -1)}` : `V${sym.slice(2)}`;
}

export const HighLow: React.FC = () => {
    const { transactions } = useStore();
    const initCfg = loadConfig();
    const [cfg, setCfg] = useState<HighLowConfig>(initCfg);
    const [running, setRunning] = useState(false);
    const [inTrade, setInTrade] = useState(false);
    const [pnl, setPnl] = useState(0);
    const [dailyPnl, setDailyPnl] = useState(0);
    const [trades, setTrades] = useState<TradeRecord[]>([]);
    const [status, setStatus] = useState('');
    const [board, setBoard] = useState<Record<string, BoardRow>>({});
    const [consecutiveLosses, setConsecutiveLosses] = useState(0);
    const [logs, setLogs] = useState<{ time: string; msg: string; type: string }[]>([]);

    const wsRef = useRef<MakotiWS | null>(null);
    const sdRef = useRef<Record<string, SymData>>({});
    const runningRef = useRef(false);
    const inTradeRef = useRef(false);
    const pnlRef = useRef(0);
    const dailyPnlRef = useRef(0);
    const tradesRef = useRef<TradeRecord[]>([]);
    const cfgRef = useRef(cfg);
    const consecutiveLossesRef = useRef(0);
    const contractMapRef = useRef<Map<string, { symbol: string; stake: number; duration: number }>>(new Map());
    const generationRef = useRef(0);
    const lastFireRef = useRef(0);

    cfgRef.current = cfg;

    useEffect(() => { saveConfig(cfg); }, [cfg]);

    const addLog = useCallback((msg: string, type: string = 'info') => {
        const time = new Date().toLocaleTimeString();
        setLogs(prev => [{ time, msg, type }, ...prev].slice(0, 100));
    }, []);

    const clearLogs = useCallback(() => { setLogs([]); }, []);

    const updateBoard = useCallback((sym: string) => {
        const sd = sdRef.current[sym];
        if (!sd) return;
        const touch = getBandTouch(sd.candles);
        setBoard(prev => ({
            ...prev,
            [sym]: {
                side: sd.pat.side,
                streak: sd.pat.streak,
                awaiting: sd.pat.awaitingReversal,
                price: sd.prices[sd.prices.length - 1] ?? 0,
                bb: touch?.bb ?? null,
            },
        }));
    }, []);

    const stopEngine = useCallback(() => {
        runningRef.current = false;
        inTradeRef.current = false;
        generationRef.current++;
        setRunning(false);
        setInTrade(false);
        setBoard({});
        setStatus('Stopped');
        try { wsRef.current?.close(); } catch {}
        wsRef.current = null;
        addLog('HIGH/LOW engine stopped.', 'info');
    }, [addLog]);

    const executeTrade = useCallback(async (sym: string, action: 'RUNHIGH' | 'RUNLOW') => {
        if (!runningRef.current) return;
        inTradeRef.current = true;
        setInTrade(true);
        const label = action === 'RUNHIGH' ? 'ONLY UPS' : 'ONLY DOWNS';
        setStatus(`Firing ${label} on ${SYMBOL_LABELS[sym] || sym}...`);

        let stake = cfgRef.current.stake;
        if (cfgRef.current.martingaleEnabled && consecutiveLossesRef.current > 0) {
            stake = Math.min(stake * Math.pow(cfgRef.current.martingale, consecutiveLossesRef.current), 100);
        }
        if (cfgRef.current.useCompounding && tradesRef.current.length > 0 && pnlRef.current > 0) {
            stake = Math.max(0.35, Number((pnlRef.current * 0.02).toFixed(2)));
        }
        stake = Math.max(0.35, stake);

        const result = await executeHighLowTrade(sym, action, stake, TRADE_DURATION);
        if (result.contractId) {
            contractMapRef.current.set(result.contractId, { symbol: sym, stake, duration: TRADE_DURATION });
            addLog(`Contract ${result.contractId} — ${label} on ${SYMBOL_LABELS[sym] || sym} @ $${stake} x ${TRADE_DURATION}t`, 'trade');
            setStatus(`LIVE — ${SYMBOL_LABELS[sym] || sym} ${label} $${stake} x ${TRADE_DURATION}t`);
        } else {
            addLog('Trade execution failed', 'info');
            inTradeRef.current = false;
            setInTrade(false);
        }
    }, [addLog]);

    const handleTick = useCallback((sym: string, price: number, epoch: number) => {
        if (!runningRef.current) return;
        const sd = sdRef.current[sym];
        if (!sd) return;

        const prev = sd.prices[sd.prices.length - 1];
        sd.prices = [...sd.prices.slice(-(MAX_TICKS - 1)), price];
        sd.times = [...sd.times.slice(-(MAX_TICKS - 1)), epoch];
        sd.ready = sd.prices.length >= MIN_TICKS;
        if (!sd.ready) return;

        const candles = buildCandles(sd.prices, sd.times);
        sd.candles = candles;
        const touch = getBandTouch(candles);
        const prevSide = sd.pat.side;
        const dir = tickDirection(prev, price);
        const res = stepPattern(sd.pat, touch, dir);
        sd.pat = res.pat;

        if (res.pat.side && res.pat.side !== prevSide) {
            addLog(
                `📊 ${SYMBOL_LABELS[sym] || sym} touching ${res.pat.side.toUpperCase()} band — waiting for ${MIN_STREAK}+ ${res.pat.side === 'upper' ? 'UP' : 'DOWN'} ticks`,
                'info'
            );
        }

        if (res.fire && res.action && !inTradeRef.current && runningRef.current) {
            const now = Date.now();
            if (now - lastFireRef.current < 3000) return;
            lastFireRef.current = now;
            addLog(
                `BB TRIGGER ${SYMBOL_LABELS[sym] || sym}: ${touch!.side.toUpperCase()} band + ${MIN_STREAK}+ ticks + reversal → ${res.action === 'RUNHIGH' ? 'ONLY UPS' : 'ONLY DOWNS'}`,
                'trigger'
            );
            updateBoard(sym);
            executeTrade(sym, res.action);
        } else {
            updateBoard(sym);
        }
    }, [addLog, executeTrade, updateBoard]);

    const tickRef = useRef(handleTick);
    tickRef.current = handleTick;

    const pocUnsubRef = useRef<(() => void) | null>(null);

    const startEngine = useCallback(() => {
        sessionStorage.removeItem('transaction_cache');
        consecutiveLossesRef.current = 0;
        inTradeRef.current = false;
        contractMapRef.current = new Map();
        generationRef.current++;
        lastFireRef.current = 0;

        const hasData = Object.values(sdRef.current).some(sd => sd.prices.length > 0);
        if (!hasData) {
            sdRef.current = {};
            HL_SYMBOLS.forEach(sym => {
                sdRef.current[sym] = { prices: [], times: [], pat: newPattern(), candles: [], ready: false };
            });
        } else {
            HL_SYMBOLS.forEach(sym => {
                if (!sdRef.current[sym]) sdRef.current[sym] = { prices: [], times: [], pat: newPattern(), candles: [], ready: false };
            });
        }

        runningRef.current = true;
        setRunning(true);
        setInTrade(false);
        setBoard({});
        setStatus('Connected — building 1m candles from live ticks');
        setConsecutiveLosses(0);
        setPnl(0);
        setDailyPnl(0);
        pnlRef.current = 0;
        dailyPnlRef.current = 0;

        addLog(`HIGH/LOW — ${HL_SYMBOLS.length} volatilities | BB(${20},${2}) 1m candles | stake $${Math.max(0.35, cfg.stake)}`, 'info');

        if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }

        const subscribeAllSymbols = useCallback(() => {
        if (window._newSystemWS?.readyState !== WebSocket.OPEN) return;
        HL_SYMBOLS.forEach(sym => {
            window._newSystemWS.send(JSON.stringify({ ticks_history: sym, style: 'ticks', count: 50, end: 'latest', subscribe: 1 }));
        });
    }, []);

    const mws = openMakotiWS(
            (data: any) => {
                if (!runningRef.current) return;
                if (data.msg_type === 'history') {
                    const sym: string = data.echo_req?.ticks_history;
                    if (!sym || !sdRef.current[sym]) return;
                    const sd = sdRef.current[sym];
                    const rawPrices = data.history?.prices;
                    if (!Array.isArray(rawPrices)) return;
                    const prices = rawPrices.map((p: string | number) => Number(p));
                    let times: number[];
                    const rawTimes = data.history?.times;
                    if (Array.isArray(rawTimes) && rawTimes.length === prices.length) {
                        times = rawTimes.map((t: string | number) => Number(t));
                    } else {
                        times = prices.map((_, i) => Math.floor(Date.now() / 1000) - (prices.length - 1 - i));
                    }
                    sd.prices = prices.slice(-MAX_TICKS);
                    sd.times = times.slice(-MAX_TICKS);
                    sd.candles = buildCandles(sd.prices, sd.times);
                    sd.ready = sd.prices.length >= MIN_TICKS;
                    sd.pat = newPattern();
                }
                if (data.msg_type === 'tick') {
                    const tick = data.tick;
                    if (!tick) return;
                    const sym: string = tick.symbol;
                    if (!HL_SYMBOLS.includes(sym) || !sdRef.current[sym]) return;
                    const price = Number(tick.quote);
                    const epoch = tick.epoch ? Number(tick.epoch) : Math.floor(Date.now() / 1000);
                    if (!price) return;
                    tickRef.current(sym, price, epoch);
                }
            },
            () => {
                if (!runningRef.current) return;
                addLog('Live tick stream active — monitoring BB bands', 'info');
                setStatus('Monitoring Bollinger Bands on 1m candles...');
                subscribeAllSymbols();
            },
            () => {
                if (runningRef.current) { addLog('Connection lost. Stopping.', 'info'); stopEngine(); }
            },
        );
        wsRef.current = mws;
        subscribeAllSymbols();
    }, [cfg, addLog, stopEngine, subscribeAllSymbols]);

    useEffect(() => {
        if (!running) return;
        if (pocUnsubRef.current) pocUnsubRef.current();
        const unsub = onNewSystemMessage((event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.msg_type !== 'proposal_open_contract') return;
                const c = data.proposal_open_contract;
                if (!c?.is_sold) return;
                const cid = String(c.contract_id);
                const entry = contractMapRef.current.get(cid);
                if (!entry) return;
                contractMapRef.current.delete(cid);

                const profit = Number(c.profit);
                const won = profit >= 0;
                pnlRef.current += profit;
                dailyPnlRef.current += profit;
                setPnl(pnlRef.current);
                setDailyPnl(dailyPnlRef.current);

                const trade: TradeRecord = {
                    time: new Date().toLocaleTimeString(),
                    symbol: entry.symbol, direction: c.contract_type === 'RUNHIGH' ? 'RUNHIGH' : 'RUNLOW',
                    stake: entry.stake, duration: entry.duration,
                    entryPrice: Number(c.entry_tick ?? 0), exitPrice: Number(c.exit_tick ?? 0),
                    profit, won,
                };
                tradesRef.current = [trade, ...tradesRef.current].slice(0, 50);
                setTrades(tradesRef.current);

                try {
                    const pocWithDisplay = !(c as any).display_name ? { ...c, display_name: SYMBOL_LABELS[entry.symbol] } : c;
                    transactions.onBotContractEvent(pocWithDisplay);
                } catch (_) {}

                if (won) {
                    consecutiveLossesRef.current = 0;
                    setConsecutiveLosses(0);
                    addLog(`WON +$${profit.toFixed(2)} on ${SYMBOL_LABELS[entry.symbol] || entry.symbol} | P&L $${pnlRef.current.toFixed(2)}`, 'win');
                } else {
                    consecutiveLossesRef.current++;
                    setConsecutiveLosses(consecutiveLossesRef.current);
                    addLog(`LOST -$${Math.abs(profit).toFixed(2)} on ${SYMBOL_LABELS[entry.symbol] || entry.symbol} | P&L $${pnlRef.current.toFixed(2)}`, 'loss');

                    if (consecutiveLossesRef.current >= cfgRef.current.maxConsecutiveLosses) {
                        addLog(`Max consecutive losses (${cfgRef.current.maxConsecutiveLosses}) reached. Stopping.`, 'info');
                        stopEngine();
                        return;
                    }
                    if (dailyPnlRef.current <= cfgRef.current.dailyStopLoss) {
                        addLog(`Daily stop loss ($${cfgRef.current.dailyStopLoss}) reached. Stopping.`, 'info');
                        stopEngine();
                        return;
                    }
                }

                if (dailyPnlRef.current >= cfgRef.current.dailyProfitTarget) {
                    addLog(`Daily profit target ($${cfgRef.current.dailyProfitTarget}) reached. Stopping.`, 'info');
                    stopEngine();
                    return;
                }

                inTradeRef.current = false;
                setInTrade(false);
            } catch {}
        });
        pocUnsubRef.current = unsub;
        return () => { unsub(); pocUnsubRef.current = null; };
    }, [running, addLog, stopEngine, transactions]);

    useEffect(() => {
        return () => {
            runningRef.current = false;
            try { wsRef.current?.close(); } catch {}
            if (pocUnsubRef.current) { pocUnsubRef.current(); pocUnsubRef.current = null; }
        };
    }, []);

    const totalTrades = trades.length;
    const wins = trades.filter(t => t.won).length;
    const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';

    const touchingCount = HL_SYMBOLS.filter(s => board[s]?.side).length;
    const activeSym = HL_SYMBOLS
        .filter(s => board[s]?.side)
        .sort((a, b) => {
            const wa = (board[a].awaiting ? 2 : 0) + Math.min(board[a].streak, MIN_STREAK) / MIN_STREAK;
            const wb = (board[b].awaiting ? 2 : 0) + Math.min(board[b].streak, MIN_STREAK) / MIN_STREAK;
            return wb - wa;
        })[0] ?? null;
    const active = activeSym ? board[activeSym] : null;

    const phaseLabel = !running ? 'OFF' : inTrade ? 'LIVE' : active?.awaiting ? 'REVERSAL?' : active?.side ? 'TRACKING' : 'SCANNING';
    const phaseColor = !running ? '#6b7280' : inTrade ? '#22c55e' : active?.awaiting ? '#ef4444' : active?.side ? '#f59e0b' : '#6b7280';

    return (
        <div className='mw-killer'>
            <div className='mw-killer__fields'>
                <div className='mw-field'>
                    <label className='mw-label'>Stake ($)</label>
                    <input className='mw-input' type='number' min='0.35' step='0.01'
                        value={cfg.stake} onChange={e => setCfg(p => ({ ...p, stake: Math.max(0.35, parseFloat(e.target.value) || 0.35) }))} disabled={running} />
                </div>
                <div className='mw-field'>
                    <label className='mw-label'>Max Losses</label>
                    <input className='mw-input' type='number' min='1' step='1'
                        value={cfg.maxConsecutiveLosses} onChange={e => setCfg(p => ({ ...p, maxConsecutiveLosses: Math.max(1, parseInt(e.target.value) || 3) }))} disabled={running} />
                </div>
            </div>
            <div className='mw-killer__fields'>
                <div className='mw-field'>
                    <label className='mw-label'>Daily Target ($)</label>
                    <input className='mw-input' type='number' step='1'
                        value={cfg.dailyProfitTarget} onChange={e => setCfg(p => ({ ...p, dailyProfitTarget: parseFloat(e.target.value) || 50 }))} disabled={running} />
                </div>
                <div className='mw-field'>
                    <label className='mw-label'>Daily Stop ($)</label>
                    <input className='mw-input' type='number' step='1'
                        value={cfg.dailyStopLoss} onChange={e => setCfg(p => ({ ...p, dailyStopLoss: parseFloat(e.target.value) || -25 }))} disabled={running} />
                </div>
            </div>
            <div className='mw-killer__vh'>
                <label className='mw-killer__vh-toggle'>
                    <input type='checkbox' checked={cfg.martingaleEnabled}
                        onChange={e => setCfg(p => ({ ...p, martingaleEnabled: e.target.checked }))} disabled={running} />
                    <span>Martingale <small>(x{cfg.martingale} on loss)</small></span>
                </label>
                <label className='mw-killer__vh-toggle'>
                    <input type='checkbox' checked={cfg.useCompounding}
                        onChange={e => setCfg(p => ({ ...p, useCompounding: e.target.checked }))} disabled={running} />
                    <span>Compounding <small>(2% of P&L)</small></span>
                </label>
            </div>

            <button className={`mw-btn${running ? ' mw-btn--stop' : ' mw-btn--kill'}`}
                onClick={running ? stopEngine : startEngine}>
                {running ? <><span className='mw-pulse' /> STOP</> : 'RUN'}
            </button>

            {running && (
                <div className='mw-killer__signal'>
                    <div className='mw-killer__signal-detail'>{status}</div>

                    {active && (
                        <div className='mw-killer__signal-strength'>
                            <span style={{ color: active.side === 'upper' ? '#ef4444' : '#22c55e' }}>
                                {SYMBOL_LABELS[activeSym!] || activeSym}
                            </span>
                            <span style={{ color: active.side === 'upper' ? '#ef4444' : '#22c55e', marginLeft: 8 }}>
                                {active.side === 'upper' ? 'UPPER BAND' : 'LOWER BAND'}
                            </span>
                            {active.streak > 0 && (
                                <span style={{ color: '#facc15', marginLeft: 8 }}>
                                    {active.streak} {active.side === 'upper' ? 'UP' : 'DOWN'} ticks
                                </span>
                            )}
                            {active.awaiting && (
                                <span style={{ color: '#f97316', marginLeft: 8 }}>awaiting reversal</span>
                            )}
                            <span style={{
                                display: 'inline-block',
                                marginLeft: 8,
                                padding: '1px 6px',
                                borderRadius: 3,
                                fontSize: 11,
                                fontWeight: 600,
                                background: phaseColor,
                                color: '#000',
                            }}>
                                {phaseLabel}
                            </span>
                            {inTrade && <span className='mw-killer__active-dot'> LIVE</span>}
                            {consecutiveLosses > 0 && <span style={{ color: '#ef4444', marginLeft: 8 }}>x{consecutiveLosses} losses</span>}

                            <div style={{ marginTop: 6 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8' }}>
                                    <span>
                                        streak {Math.min(active.streak, MIN_STREAK)}/{MIN_STREAK} {active.side === 'upper' ? 'UP' : 'DOWN'}
                                    </span>
                                    <span>{active.awaiting ? 'waiting for reversal tick...' : 'building streak...'}</span>
                                </div>
                                <div style={{ height: 4, background: '#1e293b', borderRadius: 2, marginTop: 2 }}>
                                    <div style={{
                                        height: '100%',
                                        width: `${Math.min(active.streak / MIN_STREAK, 1) * 100}%`,
                                        background: active.awaiting ? '#f59e0b' : '#facc15',
                                        borderRadius: 2,
                                        transition: 'width 0.15s linear',
                                    }} />
                                </div>
                            </div>

                            {active.bb && active.price > 0 && (
                                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, display: 'flex', gap: 12 }}>
                                    <span>Upper: <span style={{ color: '#ef4444' }}>{active.bb.upper.toFixed(4)}</span></span>
                                    <span>Mid: <span style={{ color: '#facc15' }}>{active.bb.middle.toFixed(4)}</span></span>
                                    <span>Lower: <span style={{ color: '#22c55e' }}>{active.bb.lower.toFixed(4)}</span></span>
                                    <span>Price: <span style={{ color: '#e2e8f0' }}>{active.price.toFixed(4)}</span></span>
                                </div>
                            )}
                        </div>
                    )}

                    <div style={{ marginTop: 8, fontSize: 10, color: '#94a3b8' }}>
                        Monitoring {HL_SYMBOLS.length} volatilities — {touchingCount} touching a band
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                        {HL_SYMBOLS.map(sym => {
                            const r = board[sym];
                            const t = r?.side === 'upper';
                            const b = r?.side === 'lower';
                            const borderColor = t ? '#ef4444' : b ? '#22c55e' : '#334155';
                            return (
                                <div key={sym} style={{
                                    flex: '1 1 16%',
                                    minWidth: 58,
                                    padding: '3px 6px',
                                    borderRadius: 4,
                                    fontSize: 10,
                                    background: '#1e293b',
                                    border: `1px solid ${borderColor}`,
                                    opacity: r?.side ? 1 : 0.45,
                                    textAlign: 'center',
                                }}>
                                    <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{shortSym(sym)}</div>
                                    <div style={{ color: r?.awaiting ? '#f97316' : '#94a3b8' }}>
                                        {r?.side ? (t ? 'UPPER' : 'LOWER') : '—'}{r?.streak ? ` · ${r.streak}` : ''}{r?.awaiting ? ' · REV' : ''}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {(running || pnl !== 0) && (
                <div className='mw-killer__stats'>
                    <div className={`mw-killer__pnl${pnl >= 0 ? ' mw-killer__pnl--pos' : ' mw-killer__pnl--neg'}`}>
                        P&L: {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                    </div>
                    <div className='mw-killer__meta'>
                        <span>Trades: {totalTrades}</span>
                        <span>Win Rate: {winRate}%</span>
                        <span>Daily: {dailyPnl >= 0 ? '+' : ''}${dailyPnl.toFixed(2)}</span>
                    </div>
                </div>
            )}

            {trades.length > 0 && (
                <div className='mw-killer__trades'>
                    <div className='mw-killer__log-header'>
                        <span className='mw-killer__log-title'>Trade History</span>
                    </div>
                    <div className='mw-killer__trade-list'>
                        {trades.slice(0, 10).map((t, i) => (
                            <div key={i} className={`mw-log-line mw-log-line--${t.won ? 'win' : 'loss'}`}>
                                <span className='mw-log-time'>{t.time}</span>
                                <span className='mw-log-msg'>
                                    {t.won ? '+' : '-'}{t.direction === 'RUNHIGH' ? 'U' : 'D'} {SYMBOL_LABELS[t.symbol] || t.symbol} {t.won ? '+' : ''}${t.profit.toFixed(2)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {logs.length > 0 && (
                <div className='mw-killer__log-wrap'>
                    <div className='mw-killer__log-header'>
                        <span className='mw-killer__log-title'>Activity Log</span>
                        <button className='mw-btn-clear' onClick={clearLogs}>Clear</button>
                    </div>
                    <div className='mw-killer__log'>
                        {logs.map((l, i) => (
                            <div key={i} className={`mw-log-line mw-log-line--${l.type}`}>
                                <span className='mw-log-time'>{l.time}</span>
                                <span className='mw-log-msg'>{l.msg}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default HighLow;