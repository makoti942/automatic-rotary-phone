import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_SYMBOLS, SYMBOL_LABELS, PIP_SIZES } from '@/components/makoti-widget/makoti-ws';
import { sendViaNewSystemWithPromise, onNewSystemMessage } from '@/auth/NewDerivAuth';
import { useStore } from '@/hooks/useStore';
import './trading-view-trading.scss';

/* ── Types ─────────────────────────────────────────────────────────────────── */
interface OpenTrade {
    contractId: number;
    symbol: string;
    contractType: string;
    stake: number;
    payout: number;
    entryPrice: number;
    currentPrice: number;
    profit: number;
    status: 'open' | 'won' | 'lost';
    openedAt: number;
    barrier?: number;
    duration: number;
}

interface TradeLog {
    time: string;
    msg: string;
    type: 'buy' | 'win' | 'loss' | 'info';
}

/* ── Component ─────────────────────────────────────────────────────────────── */
const TradingViewTrading: React.FC = () => {
    const { transactions } = useStore();

    const [activeSymbol, setActiveSymbol] = useState(() => localStorage.getItem('tvt_symbol') || 'R_100');
    const [stake, setStake] = useState(() => localStorage.getItem('tvt_stake') || '1');
    const [duration, setDuration] = useState(() => localStorage.getItem('tvt_duration') || '1');
    const [durationUnit, setDurationUnit] = useState<'t' | 'm' | 'h'>('t');
    const [openTrades, setOpenTrades] = useState<OpenTrade[]>([]);
    const [isBuying, setIsBuying] = useState(false);
    const [lastPrice, setLastPrice] = useState(0);
    const [logs, setLogs] = useState<TradeLog[]>([]);
    const [tradesOpen, setTradesOpen] = useState(true);

    const contractMapRef = useRef<Map<string, any>>(new Map());
    const mountedRef = useRef(true);
    const isBuyingRef = useRef(false);
    const reqIdRef = useRef(0);

    // Persist config
    useEffect(() => { localStorage.setItem('tvt_symbol', activeSymbol); }, [activeSymbol]);
    useEffect(() => { localStorage.setItem('tvt_stake', stake); }, [stake]);
    useEffect(() => { localStorage.setItem('tvt_duration', duration); }, [duration]);

    const addLog = useCallback((msg: string, type: TradeLog['type'] = 'info') => {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLogs(prev => [...prev.slice(-30), { time, msg, type }]);
    }, []);

    // Subscribe to ticks for price display
    useEffect(() => {
        mountedRef.current = true;
        if (window._newSystemWS?.readyState === WebSocket.OPEN) {
            window._newSystemWS.send(JSON.stringify({ ticks_history: activeSymbol, style: 'ticks', count: 1, end: 'latest', subscribe: 1 }));
        }
        const unsub = onNewSystemMessage((event: MessageEvent) => {
            if (!mountedRef.current) return;
            try {
                const data = JSON.parse(event.data);
                if (data.tick && data.tick.symbol === activeSymbol) {
                    setLastPrice(Number(data.tick.quote));
                }
            } catch {}
        });
        return () => { mountedRef.current = false; unsub(); };
    }, [activeSymbol]);

    // Buy RISE (CALL)
    const buyRise = useCallback(async () => {
        if (isBuyingRef.current) return;
        const amount = parseFloat(stake);
        if (!amount || amount <= 0) return;
        isBuyingRef.current = true;
        setIsBuying(true);

        try {
            const params: any = {
                amount, basis: 'stake', contract_type: 'CALL',
                currency: 'USD', duration: parseInt(duration) || 1,
                duration_unit: durationUnit, symbol: activeSymbol,
            };
            const buyRes: any = await sendViaNewSystemWithPromise({ buy: 1, price: amount, parameters: params, req_id: ++reqIdRef.current });
            if (buyRes?.buy) {
                const contractId = Number(buyRes.buy.contract_id);
                contractMapRef.current.set(String(contractId), { entryPrice: lastPrice });
                setOpenTrades(prev => [...prev, {
                    contractId, symbol: activeSymbol, contractType: 'RISE',
                    stake: Number(buyRes.buy.buy_price), payout: Number(buyRes.buy.payout),
                    entryPrice: lastPrice, currentPrice: lastPrice, profit: 0,
                    status: 'open', openedAt: Date.now(), duration: parseInt(duration) || 1,
                }]);
                addLog(`RISE $${amount} @ ${SYMBOL_LABELS[activeSymbol]} — #${contractId}`, 'buy');
                try {
                    transactions.onBotContractEvent({
                        contract_id: contractId, transaction_ids: { buy: buyRes.buy.transaction_id },
                        buy_price: amount, currency: 'USD', contract_type: 'CALL',
                        underlying: activeSymbol, display_name: SYMBOL_LABELS[activeSymbol],
                        date_start: Math.floor(Date.now() / 1000), status: 'open',
                    } as any);
                } catch {}
            }
        } catch (e: any) {
            addLog(`Failed: ${e?.error?.message ?? 'error'}`, 'info');
        } finally {
            isBuyingRef.current = false;
            setIsBuying(false);
        }
    }, [activeSymbol, stake, duration, durationUnit, lastPrice, addLog]);

    // Buy FALL (PUT)
    const buyFall = useCallback(async () => {
        if (isBuyingRef.current) return;
        const amount = parseFloat(stake);
        if (!amount || amount <= 0) return;
        isBuyingRef.current = true;
        setIsBuying(true);

        try {
            const params: any = {
                amount, basis: 'stake', contract_type: 'PUT',
                currency: 'USD', duration: parseInt(duration) || 1,
                duration_unit: durationUnit, symbol: activeSymbol,
            };
            const buyRes: any = await sendViaNewSystemWithPromise({ buy: 1, price: amount, parameters: params, req_id: ++reqIdRef.current });
            if (buyRes?.buy) {
                const contractId = Number(buyRes.buy.contract_id);
                contractMapRef.current.set(String(contractId), { entryPrice: lastPrice });
                setOpenTrades(prev => [...prev, {
                    contractId, symbol: activeSymbol, contractType: 'FALL',
                    stake: Number(buyRes.buy.buy_price), payout: Number(buyRes.buy.payout),
                    entryPrice: lastPrice, currentPrice: lastPrice, profit: 0,
                    status: 'open', openedAt: Date.now(), duration: parseInt(duration) || 1,
                }]);
                addLog(`FALL $${amount} @ ${SYMBOL_LABELS[activeSymbol]} — #${contractId}`, 'buy');
                try {
                    transactions.onBotContractEvent({
                        contract_id: contractId, transaction_ids: { buy: buyRes.buy.transaction_id },
                        buy_price: amount, currency: 'USD', contract_type: 'PUT',
                        underlying: activeSymbol, display_name: SYMBOL_LABELS[activeSymbol],
                        date_start: Math.floor(Date.now() / 1000), status: 'open',
                    } as any);
                } catch {}
            }
        } catch (e: any) {
            addLog(`Failed: ${e?.error?.message ?? 'error'}`, 'info');
        } finally {
            isBuyingRef.current = false;
            setIsBuying(false);
        }
    }, [activeSymbol, stake, duration, durationUnit, lastPrice, addLog]);

    // Update current price on open trades
    useEffect(() => {
        if (openTrades.length === 0 || lastPrice === 0) return;
        setOpenTrades(prev => prev.map(t => {
            if (t.status !== 'open') return t;
            const profit = t.contractType === 'RISE'
                ? (lastPrice > t.entryPrice ? t.payout - t.stake : -t.stake)
                : (lastPrice < t.entryPrice ? t.payout - t.stake : -t.stake);
            return { ...t, currentPrice: lastPrice, profit };
        }));
    }, [lastPrice]);

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
                        contractMapRef.current.delete(key);
                        const profit = Number(poc.profit ?? 0);
                        setOpenTrades(prev => prev.map(t => {
                            if (String(t.contractId) !== key) return t;
                            return { ...t, status: profit > 0 ? 'won' : 'lost', profit };
                        }));
                        if (profit > 0) addLog(`WIN +$${profit.toFixed(2)}`, 'win');
                        else addLog(`LOSS -$${Math.abs(profit).toFixed(2)}`, 'loss');
                        // Remove from open after 2s
                        setTimeout(() => {
                            setOpenTrades(prev => prev.filter(t => String(t.contractId) !== key));
                        }, 2000);
                    });
                }
            } catch {}
        });
        return unsub;
    }, [addLog]);

    const totalProfit = openTrades.reduce((a, t) => a + t.profit, 0);
    const openCount = openTrades.filter(t => t.status === 'open').length;

    return (
        <div className='tvt-page'>
            {/* Chart iframe */}
            <div className='tvt-chart'>
                <iframe
                    id='trading-view-iframe'
                    style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                    src='https://charts.deriv.com/deriv?hide-signup=true'
                />

                {/* Entry price overlay markers */}
                {openTrades.filter(t => t.status === 'open').map(t => (
                    <div key={t.contractId} className={`tvt-entry-marker tvt-entry-marker--${t.contractType.toLowerCase()}`}>
                        <span className='tvt-entry-label'>
                            {t.contractType} #{t.contractId.toString().slice(-4)} @ {t.entryPrice}
                        </span>
                    </div>
                ))}
            </div>

            {/* Trading Panel — right side */}
            <div className='tvt-panel'>
                {/* Symbol selector */}
                <div className='tvt-panel-section'>
                    <select className='tvt-symbol-select' value={activeSymbol} onChange={e => setActiveSymbol(e.target.value)}>
                        {ALL_SYMBOLS.map(s => <option key={s} value={s}>{SYMBOL_LABELS[s]}</option>)}
                    </select>
                </div>

                {/* Price display */}
                <div className='tvt-price-display'>
                    <span className='tvt-price-label'>Last Price</span>
                    <span className='tvt-price-value'>{lastPrice.toFixed(2)}</span>
                </div>

                {/* Stake & Duration */}
                <div className='tvt-panel-section'>
                    <div className='tvt-input-row'>
                        <label>Stake $</label>
                        <input type='number' value={stake} onChange={e => setStake(e.target.value)} min={0.01} step={0.01} />
                    </div>
                    <div className='tvt-input-row'>
                        <label>Duration</label>
                        <div className='tvt-duration-group'>
                            <input type='number' value={duration} onChange={e => setDuration(e.target.value)} min={1} step={1} />
                            <select value={durationUnit} onChange={e => setDurationUnit(e.target.value as any)}>
                                <option value='t'>Ticks</option>
                                <option value='m'>Min</option>
                                <option value='h'>Hour</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* RISE / FALL buttons — MT5 style */}
                <div className='tvt-trade-buttons'>
                    <button className='tvt-btn tvt-btn--rise' onClick={buyRise} disabled={isBuying}>
                        <span className='tvt-btn-arrow'>▲</span>
                        <span className='tvt-btn-label'>RISE</span>
                        <span className='tvt-btn-sub'>CALL</span>
                    </button>
                    <button className='tvt-btn tvt-btn--fall' onClick={buyFall} disabled={isBuying}>
                        <span className='tvt-btn-arrow'>▼</span>
                        <span className='tvt-btn-label'>FALL</span>
                        <span className='tvt-btn-sub'>PUT</span>
                    </button>
                </div>

                {/* Open trades summary */}
                <div className='tvt-summary'>
                    <div className='tvt-summary-row'>
                        <span>Open:</span>
                        <span className='tvt-summary-val'>{openCount}</span>
                    </div>
                    <div className='tvt-summary-row'>
                        <span>P/L:</span>
                        <span className={`tvt-summary-val ${totalProfit >= 0 ? 'tvt-green' : 'tvt-red'}`}>
                            {totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)}
                        </span>
                    </div>
                </div>

                {/* Toggle trades panel */}
                <button className='tvt-trades-toggle' onClick={() => setTradesOpen(o => !o)}>
                    Open Trades ({openCount}) {tradesOpen ? '▼' : '▲'}
                </button>
            </div>

            {/* Sliding window — open trades */}
            {tradesOpen && (
                <div className='tvt-trades-window'>
                    <div className='tvt-trades-header'>
                        <span>Symbol</span><span>Type</span><span>Entry</span><span>Current</span><span>P/L</span>
                    </div>
                    <div className='tvt-trades-list'>
                        {openTrades.length === 0 && (
                            <div className='tvt-trades-empty'>No open trades</div>
                        )}
                        {openTrades.map(t => (
                            <div key={t.contractId} className={`tvt-trade-row tvt-trade-row--${t.status}`}>
                                <span className='tvt-tr-cell'>{SYMBOL_LABELS[t.symbol] || t.symbol}</span>
                                <span className={`tvt-tr-cell tvt-tr-type tvt-tr-type--${t.contractType.toLowerCase()}`}>{t.contractType}</span>
                                <span className='tvt-tr-cell'>{t.entryPrice.toFixed(2)}</span>
                                <span className='tvt-tr-cell'>{t.currentPrice.toFixed(2)}</span>
                                <span className={`tvt-tr-cell tvt-tr-profit ${t.profit >= 0 ? 'tvt-green' : 'tvt-red'}`}>
                                    {t.status === 'open'
                                        ? `${t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)}`
                                        : t.status === 'won' ? `+$${(t.payout - t.stake).toFixed(2)}` : `-$${t.stake.toFixed(2)}`
                                    }
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Logs */}
            <div className='tvt-logs'>
                {logs.slice().reverse().map((log, i) => (
                    <div key={i} className={`tvt-log tvt-log--${log.type}`}>
                        <span className='tvt-log-time'>{log.time}</span>
                        <span className='tvt-log-msg'>{log.msg}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default TradingViewTrading;
