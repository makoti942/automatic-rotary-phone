import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_SYMBOLS, SYMBOL_LABELS, openMakotiWS, MakotiWS } from './makoti-ws';
import { sendViaNewSystemWithPromise } from '@/auth/NewDerivAuth';
import { useStore } from '@/hooks/useStore';

interface LogEntry { time: string; msg: string; type: 'win' | 'loss' | 'info' | 'trade' | 'trigger' | 'recovery' | 'success'; }

const MAX_TICKS = 200;
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

export const EvenOddKiller: React.FC = () => {
    const { transactions } = useStore();

    const cfg = loadCfg();
    const [stake, setStake] = useState(cfg.stake);
    const [martingale, setMartingale] = useState(cfg.martingale);
    const [running, setRunning] = useState(false);

    const stakeRef = useRef(parseFloat(cfg.stake));
    const martingaleRef = useRef(parseFloat(cfg.martingale));
    useEffect(() => { saveCfg({ stake, martingale }); }, [stake, martingale]);
    useEffect(() => { stakeRef.current = parseFloat(stake) || 0.35; }, [stake]);
    useEffect(() => { martingaleRef.current = parseFloat(martingale) || 2; }, [martingale]);

    const [logs, setLogs] = useState<LogEntry[]>([]);
    const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
        const time = new Date().toLocaleTimeString();
        setLogs(prev => [...prev.slice(-200), { time, msg, type }]);
    }, []);

    const bufRef = useRef<Record<string, number[]>>({});
    const wsRef = useRef<MakotiWS | null>(null);
    const runningRef = useRef(false);

    const selectedSymRef = useRef('');
    const contractTypeRef = useRef<'DIGITEVEN' | 'DIGITODD'>('DIGITEVEN');
    const dominantSideRef = useRef<'even' | 'odd'>('even');
    const currentStakeRef = useRef(stakeRef.current);
    const tradesWonRef = useRef(0);
    const tradesLostRef = useRef(0);
    const tradesInRoundRef = useRef(0);
    const totalPnlRef = useRef(0);

    const modeRef = useRef<'idle' | 'scanning' | 'waiting_pattern' | 'waiting_result'>('idle');
    const activeContractIdRef = useRef<string>('');
    const contractMapRef = useRef<Map<string, { sym: string; stake: number }>>(new Map());
    const losingStreakRef = useRef(0);

    const [symProgress, setSymProgress] = useState<Record<string, { evenPct: number; oddPct: number; ticks: number }>>({});
    const [selectedSym, setSelectedSym] = useState('');
    const [contractLabel, setContractLabel] = useState('');
    const [tradesWon, setTradesWon] = useState(0);
    const [tradesLost, setTradesLost] = useState(0);
    const [tradesInRound, setTradesInRound] = useState(0);
    const [totalPnl, setTotalPnl] = useState(0);
    const [currentStakeUI, setCurrentStakeUI] = useState(stakeRef.current);
    const [mode, setMode] = useState('idle');
    const [patternStatus, setPatternStatus] = useState('');

    const isEven = (d: number) => d === 0 || d === 2 || d === 4 || d === 6 || d === 8;

    const calcEvenOdd = (digits: number[]) => {
        const n = digits.length || 1;
        const evenCount = digits.filter(d => isEven(d)).length;
        return { evenPct: (evenCount / n) * 100, oddPct: 100 - (evenCount / n) * 100 };
    };

    const isIncreasing = (digits: number[], dominant: 'even' | 'odd'): boolean => {
        if (digits.length < 30) return true;
        const recent = digits.slice(-15);
        const older = digits.slice(-50, -15);
        if (older.length < 5) return true;
        const rPct = dominant === 'even'
            ? (recent.filter(d => isEven(d)).length / recent.length) * 100
            : (recent.filter(d => !isEven(d)).length / recent.length) * 100;
        const oPct = dominant === 'even'
            ? (older.filter(d => isEven(d)).length / older.length) * 100
            : (older.filter(d => !isEven(d)).length / older.length) * 100;
        return rPct >= oPct - 2;
    };

    const stop = useCallback(() => {
        runningRef.current = false;
        modeRef.current = 'idle';
        contractMapRef.current.clear();
        activeContractIdRef.current = '';
        setRunning(false);
        setMode('idle');
        setPatternStatus('');
        try { wsRef.current?.close(); } catch {}
        wsRef.current = null;
        addLog('Stopped', 'info');
    }, [addLog]);

    const reanalyzeRef = useRef<() => void>(() => {});
    const fireTradeRef = useRef<() => void>(() => {});

    reanalyzeRef.current = () => {
        modeRef.current = 'scanning';
        setMode('scanning');
        losingStreakRef.current = 0;
        tradesInRoundRef.current = 0;
        setTradesInRound(0);
        currentStakeRef.current = stakeRef.current;
        setCurrentStakeUI(stakeRef.current);
        selectedSymRef.current = '';
        setSelectedSym('');
        setContractLabel('');
        setPatternStatus('Scanning...');
        addLog('Scanning all volatilities...', 'info');

        const buf = bufRef.current;
        let bestSym = '', bestCt: 'DIGITEVEN' | 'DIGITODD' = 'DIGITEVEN', bestSide: 'even' | 'odd' = 'even', bestPct = 0;

        for (const sym of ALL_SYMBOLS) {
            const digits = buf[sym];
            if (!digits || digits.length < 30) continue;
            const { evenPct, oddPct } = calcEvenOdd(digits.slice(-50));
            if (evenPct > DOMINANCE_THRESHOLD && isIncreasing(digits, 'even') && evenPct > bestPct) {
                bestPct = evenPct; bestSym = sym; bestCt = 'DIGITEVEN'; bestSide = 'even';
            }
            if (oddPct > DOMINANCE_THRESHOLD && isIncreasing(digits, 'odd') && oddPct > bestPct) {
                bestPct = oddPct; bestSym = sym; bestCt = 'DIGITODD'; bestSide = 'odd';
            }
        }

        if (!bestSym) {
            for (const sym of ALL_SYMBOLS) {
                const digits = buf[sym];
                if (!digits || digits.length < 30) continue;
                const { evenPct, oddPct } = calcEvenOdd(digits.slice(-50));
                if (evenPct > bestPct) { bestPct = evenPct; bestSym = sym; bestCt = 'DIGITEVEN'; bestSide = 'even'; }
                if (oddPct > bestPct) { bestPct = oddPct; bestSym = sym; bestCt = 'DIGITODD'; bestSide = 'odd'; }
            }
        }

        if (bestSym) {
            selectedSymRef.current = bestSym;
            contractTypeRef.current = bestCt;
            dominantSideRef.current = bestSide;
            const label = bestCt === 'DIGITEVEN' ? 'EVEN' : 'ODD';
            setSelectedSym(bestSym);
            setContractLabel(`${label} (${bestPct.toFixed(1)}%)`);
            modeRef.current = 'waiting_pattern';
            setMode('waiting_pattern');
            losingStreakRef.current = 0;
            setPatternStatus(`Waiting: 2+ ${bestSide === 'even' ? 'odd' : 'even'} then ${label}...`);
            addLog(`SELECTED ${SYMBOL_LABELS[bestSym]}: ${label} ${bestPct.toFixed(1)}%`, 'trigger');
        } else {
            setPatternStatus('No data yet. Retrying...');
            setTimeout(() => { if (runningRef.current) reanalyzeRef.current(); }, 3000);
        }
    };

    fireTradeRef.current = () => {
        const sym = selectedSymRef.current;
        const ct = contractTypeRef.current;
        if (!sym || !runningRef.current) return;

        modeRef.current = 'waiting_result';
        setMode('waiting_result');

        const amt = currentStakeRef.current;
        const label = ct === 'DIGITEVEN' ? 'EVEN' : 'ODD';
        addLog(`TRADE ${label} ${SYMBOL_LABELS[sym]} @ $${amt.toFixed(2)} (${tradesInRoundRef.current + 1}/${TRADES_PER_ROUND})`, 'trade');
        setPatternStatus(`TRADING ${label} — waiting for result...`);

        sendViaNewSystemWithPromise({
            buy: 1, price: amt,
            parameters: {
                amount: amt, basis: 'stake', currency: 'USD',
                duration: 1, duration_unit: 't',
                symbol: sym, contract_type: ct,
            },
        }).then(r => {
            const cid = r?.buy?.contract_id ?? r?.contract_id;
            if (cid) {
                activeContractIdRef.current = String(cid);
                contractMapRef.current.set(String(cid), { sym, stake: amt });
                try {
                    transactions.onBotContractEvent({
                        contract_id: cid, transaction_ids: { buy: r?.buy?.transaction_id },
                        buy_price: amt, currency: 'USD', contract_type: ct,
                        underlying: sym, display_name: SYMBOL_LABELS[sym],
                        date_start: Math.floor(Date.now() / 1000), status: 'open',
                    } as any);
                } catch {}
                if (window._newSystemWS?.readyState === WebSocket.OPEN) {
                    window._newSystemWS.send(JSON.stringify({ proposal_open_contract: 1, subscribe: 1 }));
                }
                addLog(`Contract ${cid} open`, 'info');
            } else {
                addLog('Buy OK but no contract_id', 'info');
                modeRef.current = 'waiting_pattern';
                setMode('waiting_pattern');
            }
        }).catch((e: any) => {
            addLog(`BUY ERROR: ${e?.error?.message || e?.message}`, 'loss');
            modeRef.current = 'waiting_pattern';
            setMode('waiting_pattern');
        });
    };

    const handleTradeResult = useCallback((won: boolean, profit: number) => {
        contractMapRef.current.delete(activeContractIdRef.current);
        activeContractIdRef.current = '';

        if (won) {
            tradesWonRef.current++;
            setTradesWon(tradesWonRef.current);
            totalPnlRef.current += profit;
            setTotalPnl(totalPnlRef.current);
            addLog(`WIN +$${profit.toFixed(2)}`, 'win');

            tradesInRoundRef.current++;
            setTradesInRound(tradesInRoundRef.current);
            currentStakeRef.current = stakeRef.current;
            setCurrentStakeUI(stakeRef.current);

            if (tradesInRoundRef.current >= TRADES_PER_ROUND) {
                addLog(`3 WINS — re-analyzing`, 'success');
                modeRef.current = 'scanning';
                setMode('scanning');
                setTimeout(() => { if (runningRef.current) reanalyzeRef.current(); }, 1000);
                return;
            }

            addLog(`Firing trade ${tradesInRoundRef.current + 1}/${TRADES_PER_ROUND}`, 'info');
            fireTradeRef.current();
        } else {
            tradesLostRef.current++;
            setTradesLost(tradesLostRef.current);
            totalPnlRef.current += profit;
            setTotalPnl(totalPnlRef.current);
            addLog(`LOSS $${profit.toFixed(2)}`, 'loss');

            currentStakeRef.current *= martingaleRef.current;
            setCurrentStakeUI(currentStakeRef.current);
            tradesInRoundRef.current = 0;
            setTradesInRound(0);
            addLog(`RECOVERY: stake $${currentStakeRef.current.toFixed(2)}`, 'recovery');
            setPatternStatus(`RECOVERY — stake $${currentStakeRef.current.toFixed(2)}`);

            setTimeout(() => { if (runningRef.current) fireTradeRef.current(); }, 300);
        }
    }, [addLog]);

    const processTick = useCallback((sym: string, digit: number) => {
        if (!runningRef.current) return;
        if (sym !== selectedSymRef.current) return;
        if (modeRef.current !== 'waiting_pattern') return;

        const ct = contractTypeRef.current;
        const winningIsEven = ct === 'DIGITEVEN';
        const digitIsWin = winningIsEven ? isEven(digit) : !isEven(digit);

        if (!digitIsWin) {
            losingStreakRef.current++;
            setPatternStatus(`Pattern: ${losingStreakRef.current} losing digits — waiting...`);
        } else if (digitIsWin && losingStreakRef.current >= 2) {
            modeRef.current = 'waiting_result';
            setMode('waiting_result');
            tradesInRoundRef.current = 0;
            setTradesInRound(0);
            losingStreakRef.current = 0;
            addLog('PATTERN TRIGGERED — trading now', 'trigger');
            fireTradeRef.current();
        } else if (digitIsWin) {
            losingStreakRef.current = 0;
            const losing = winningIsEven ? 'odd' : 'even';
            setPatternStatus(`Waiting: 2+ ${losing} then ${ct === 'DIGITEVEN' ? 'EVEN' : 'ODD'}...`);
        }
    }, [addLog]);

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
        contractMapRef.current.clear();
        activeContractIdRef.current = '';
        setTradesWon(0);
        setTradesLost(0);
        setTradesInRound(0);
        setTotalPnl(0);
        addLog('Starting EVEN & ODD...', 'info');

        const handleMsg = (data: any) => {
            try {
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
                    const { evenPct, oddPct } = calcEvenOdd(bufRef.current[sym].slice(-50));
                    setSymProgress(prev => ({ ...prev, [sym]: { evenPct, oddPct, ticks: bufRef.current[sym].length } }));
                    return;
                }

                if (data.msg_type === 'tick' && data.tick) {
                    const sym = data.tick.symbol;
                    const q = data.tick.quote;
                    if (!sym || q === undefined) return;
                    const digit = parseInt(String(q).slice(-1), 10);
                    if (isNaN(digit)) return;
                    if (!bufRef.current[sym]) bufRef.current[sym] = [];
                    bufRef.current[sym].push(digit);
                    if (bufRef.current[sym].length > MAX_TICKS) bufRef.current[sym] = bufRef.current[sym].slice(-MAX_TICKS);
                    const { evenPct, oddPct } = calcEvenOdd(bufRef.current[sym].slice(-50));
                    setSymProgress(prev => ({ ...prev, [sym]: { evenPct, oddPct, ticks: bufRef.current[sym].length } }));
                    processTick(sym, digit);
                    return;
                }

                if (data.msg_type === 'proposal_open_contract') {
                    const c = data.proposal_open_contract;
                    if (!c?.is_sold) return;
                    const cid = String(c.contract_id);
                    if (!contractMapRef.current.has(cid)) return;
                    const profit = Number(c.profit) || 0;
                    handleTradeResult(profit > 0, profit);
                }
            } catch {}
        };

        const mws = openMakotiWS(
            handleMsg,
            () => {
                addLog('Connected — streaming ticks', 'info');
                if (window._newSystemWS?.readyState === WebSocket.OPEN) {
                    window._newSystemWS.send(JSON.stringify({ proposal_open_contract: 1, subscribe: 1 }));
                    ALL_SYMBOLS.forEach(sym => {
                        window._newSystemWS.send(JSON.stringify({ ticks_history: sym, count: 100, end: 'latest', style: 'ticks' }));
                    });
                }
                setTimeout(() => { if (runningRef.current) reanalyzeRef.current(); }, 2000);
            },
            () => { if (runningRef.current) { addLog('Connection lost', 'info'); stop(); } }
        );
        wsRef.current = mws;
    }, [addLog, processTick, stop, handleTradeResult]);

    useEffect(() => () => { try { wsRef.current?.close(); } catch {} }, []);

    return (
        <div className='mw-killer even-odd-theme'>
            <div className='mw-killer__fields'>
                <div className='mw-field'>
                    <label className='mw-label'>Stake ($)</label>
                    <input className='mw-input' type='number' min='0.35' step='0.01'
                        value={stake} onChange={e => setStake(e.target.value)} disabled={running} />
                </div>
                <div className='mw-field'>
                    <label className='mw-label'>Martingale x</label>
                    <input className='mw-input' type='number' min='1' step='0.1'
                        value={martingale} onChange={e => setMartingale(e.target.value)} disabled={running} />
                </div>
            </div>

            <button className={`mw-btn${running ? ' mw-btn--stop' : ' mw-btn--kill'}`}
                onClick={running ? stop : start}>
                {running ? <><span className='mw-pulse' /> STOP</> : 'RUN EVEN & ODD'}
            </button>

            {running && (
                <div className='mw-killer__mode-note'>
                    {mode === 'waiting_result'
                        ? <span style={{ color: '#f97316' }}>TRADING ${currentStakeUI.toFixed(2)}</span>
                        : mode === 'waiting_pattern'
                        ? <span style={{ color: '#22c55e' }}>{contractLabel} on {selectedSym ? SYMBOL_LABELS[selectedSym] : '...'}</span>
                        : <span style={{ color: '#94a3b8' }}>Scanning...</span>
                    }
                </div>
            )}

            {running && (
                <div style={{ display: 'flex', gap: 8, fontSize: 11, padding: '4px 8px', flexWrap: 'wrap' }}>
                    <span>Won: <b style={{ color: '#4caf50' }}>{tradesWon}</b></span>
                    <span>Lost: <b style={{ color: '#f44336' }}>{tradesLost}</b></span>
                    <span>Round: <b style={{ color: '#2196f3' }}>{tradesInRound}/{TRADES_PER_ROUND}</b></span>
                    <span>P&L: <b style={{ color: totalPnl >= 0 ? '#4caf50' : '#f44336' }}>${totalPnl.toFixed(2)}</b></span>
                    <span>Stake: <b>${currentStakeUI.toFixed(2)}</b></span>
                </div>
            )}

            {running && patternStatus && (
                <div style={{ fontSize: 10, color: '#94a3b8', padding: '2px 8px' }}>{patternStatus}</div>
            )}

            {running && (
                <div className='mw-scanner__results' style={{ marginTop: 4 }}>
                    <div className='mw-scanner__results-head'>Even / Odd (50 ticks)</div>
                    <div className='mw-scanner__list'>
                        {ALL_SYMBOLS.map(sym => {
                            const sp = symProgress[sym];
                            if (!sp) return null;
                            const isSel = sym === selectedSym;
                            return (
                                <div key={sym} className={`mw-scanner__row${isSel ? ' mw-scanner__row--match' : ''}`}>
                                    <div className='mw-scanner__row-head'>
                                        <span className='mw-scanner__sym'>{SYMBOL_LABELS[sym]}</span>
                                        <span className='mw-scanner__row-detail'>
                                            Even: {sp.evenPct.toFixed(1)}% | Odd: {sp.oddPct.toFixed(1)}% | {sp.ticks}t
                                        </span>
                                        {isSel && <span className='mw-scanner__tag'>SEL</span>}
                                    </div>
                                    <div style={{ display: 'flex', gap: 2, height: 20, padding: '2px 0' }}>
                                        <div style={{ width: `${sp.evenPct}%`, height: '100%', borderRadius: 2, background: sp.evenPct > 58 ? 'linear-gradient(90deg, #4caf50, #66bb6a)' : 'linear-gradient(90deg, #3b82f6, #60a5fa)', transition: 'width 0.3s' }} />
                                        <div style={{ width: `${sp.oddPct}%`, height: '100%', borderRadius: 2, background: sp.oddPct > 58 ? 'linear-gradient(90deg, #f97316, #fb923c)' : 'linear-gradient(90deg, #6366f1, #818cf8)', transition: 'width 0.3s' }} />
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
