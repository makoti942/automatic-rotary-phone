import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_SYMBOLS, SYMBOL_LABELS, PIP_SIZES } from '@/components/makoti-widget/makoti-ws';
import { sendViaNewSystemWithPromise, onNewSystemMessage } from '@/auth/NewDerivAuth';
import { useStore } from '@/hooks/useStore';
import FixedRangeVolume from './fixed-range-volume';
import './trading-view-trading.scss';

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
    duration: number;
}

const TradingViewTrading: React.FC = () => {
    const { transactions } = useStore();

    const [activeSymbol, setActiveSymbol] = useState(() => localStorage.getItem('tvt_symbol') || 'R_100');
    const [stake, setStake] = useState(() => localStorage.getItem('tvt_stake') || '1');
    const [duration, setDuration] = useState(() => localStorage.getItem('tvt_duration') || '1');
    const [durationUnit, setDurationUnit] = useState<'t' | 'm' | 'h'>('t');
    const [openTrades, setOpenTrades] = useState<OpenTrade[]>([]);
    const [isBuying, setIsBuying] = useState(false);
    const [lastPrice, setLastPrice] = useState(0);

    const [showExec, setShowExec] = useState(true);
    const [showResults, setShowResults] = useState(true);

    const contractMapRef = useRef<Map<string, any>>(new Map());
    const mountedRef = useRef(true);
    const isBuyingRef = useRef(false);
    const reqIdRef = useRef(0);

    useEffect(() => { localStorage.setItem('tvt_symbol', activeSymbol); }, [activeSymbol]);
    useEffect(() => { localStorage.setItem('tvt_stake', stake); }, [stake]);
    useEffect(() => { localStorage.setItem('tvt_duration', duration); }, [duration]);

    // Subscribe to ticks
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

    const executeBuy = useCallback(async (type: 'CALL' | 'PUT') => {
        if (isBuyingRef.current) return;
        const amount = parseFloat(stake);
        if (!amount || amount <= 0) return;
        isBuyingRef.current = true;
        setIsBuying(true);
        try {
            const params: any = {
                amount, basis: 'stake', contract_type: type,
                currency: 'USD', duration: parseInt(duration) || 1,
                duration_unit: durationUnit, symbol: activeSymbol,
            };
            const buyRes: any = await sendViaNewSystemWithPromise({ buy: 1, price: amount, parameters: params, req_id: ++reqIdRef.current });
            if (buyRes?.buy) {
                const contractId = Number(buyRes.buy.contract_id);
                contractMapRef.current.set(String(contractId), { entryPrice: lastPrice });
                const label = type === 'CALL' ? 'RISE' : 'FALL';
                setOpenTrades(prev => [...prev, {
                    contractId, symbol: activeSymbol, contractType: label,
                    stake: Number(buyRes.buy.buy_price), payout: Number(buyRes.buy.payout),
                    entryPrice: lastPrice, currentPrice: lastPrice, profit: 0,
                    status: 'open', openedAt: Date.now(), duration: parseInt(duration) || 1,
                }]);
                try {
                    transactions.onBotContractEvent({
                        contract_id: contractId, transaction_ids: { buy: buyRes.buy.transaction_id },
                        buy_price: amount, currency: 'USD', contract_type: type,
                        underlying: activeSymbol, display_name: SYMBOL_LABELS[activeSymbol],
                        date_start: Math.floor(Date.now() / 1000), status: 'open',
                    } as any);
                } catch {}
            }
        } catch {} finally { isBuyingRef.current = false; setIsBuying(false); }
    }, [activeSymbol, stake, duration, durationUnit, lastPrice]);

    // Update P/L
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

    // Settlement
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
                        setOpenTrades(prev => prev.map(t => String(t.contractId) === key ? { ...t, status: profit > 0 ? 'won' as const : 'lost' as const, profit } : t));
                        setTimeout(() => setOpenTrades(prev => prev.filter(t => String(t.contractId) !== key)), 3000);
                    });
                }
            } catch {}
        });
        return unsub;
    }, []);

    const totalProfit = openTrades.reduce((a, t) => a + t.profit, 0);
    const openCount = openTrades.filter(t => t.status === 'open').length;

    return (
        <div className='tvt-overlay'>
            {/* Entry markers */}
            {openTrades.filter(t => t.status === 'open').map(t => (
                <div key={t.contractId} className={`tvt-marker tvt-marker--${t.contractType.toLowerCase()}`}>
                    {t.contractType} #{t.contractId.toString().slice(-4)} @ {t.entryPrice}
                </div>
            ))}

            {/* Fixed Range Volume */}
            <FixedRangeVolume symbol={activeSymbol} lastPrice={lastPrice} />

            {/* Left edge toggles */}
            <div className='tvt-toggles'>
                <button className={`tvt-toggle-btn ${showExec ? 'tvt-toggle-btn--on' : ''}`} onClick={() => setShowExec(o => !o)}>
                    ⚡{openCount > 0 && <em>{openCount}</em>}
                </button>
                <button className={`tvt-toggle-btn ${showResults ? 'tvt-toggle-btn--on' : ''}`} onClick={() => setShowResults(o => !o)}>
                    📋{openCount > 0 && <em>{openCount}</em>}
                </button>
            </div>

            {/* Execution Panel */}
            <div className={`tvt-slide tvt-slide--exec ${showExec ? 'tvt-slide--open' : ''}`}>
                <div className='tvt-slide-head'>
                    <span>Trade</span>
                    <button onClick={() => setShowExec(false)}>×</button>
                </div>
                <div className='tvt-slide-body'>
                    <div className='tvt-f'>
                        <label>Market</label>
                        <select value={activeSymbol} onChange={e => setActiveSymbol(e.target.value)}>
                            {ALL_SYMBOLS.map(s => <option key={s} value={s}>{SYMBOL_LABELS[s]}</option>)}
                        </select>
                    </div>
                    <div className='tvt-price'>
                        <span>Last</span>
                        <strong>{lastPrice.toFixed(2)}</strong>
                    </div>
                    <div className='tvt-f'>
                        <label>Stake $</label>
                        <input type='number' value={stake} onChange={e => setStake(e.target.value)} min={0.01} step={0.01} />
                    </div>
                    <div className='tvt-f'>
                        <label>Duration</label>
                        <div className='tvt-dur'>
                            <input type='number' value={duration} onChange={e => setDuration(e.target.value)} min={1} />
                            <select value={durationUnit} onChange={e => setDurationUnit(e.target.value as any)}>
                                <option value='t'>Ticks</option>
                                <option value='m'>Min</option>
                                <option value='h'>Hr</option>
                            </select>
                        </div>
                    </div>
                    <div className='tvt-btns'>
                        <button className='tvt-rise' onClick={() => executeBuy('CALL')} disabled={isBuying}>
                            <i>▲</i>RISE<small>CALL</small>
                        </button>
                        <button className='tvt-fall' onClick={() => executeBuy('PUT')} disabled={isBuying}>
                            <i>▼</i>FALL<small>PUT</small>
                        </button>
                    </div>
                    <div className='tvt-pl'>
                        <div><span>Open</span><b>{openCount}</b></div>
                        <div><span>P/L</span><b className={totalProfit >= 0 ? 'tvt-g' : 'tvt-r'}>{totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)}</b></div>
                    </div>
                </div>
            </div>

            {/* Results Panel */}
            <div className={`tvt-slide tvt-slide--res ${showResults ? 'tvt-slide--open' : ''}`}>
                <div className='tvt-slide-head'>
                    <span>Positions ({openCount})</span>
                    <button onClick={() => setShowResults(false)}>×</button>
                </div>
                <div className='tvt-res-head'>
                    <span>Sym</span><span>Type</span><span>Entry</span><span>P/L</span>
                </div>
                <div className='tvt-res-list'>
                    {openTrades.length === 0 && <div className='tvt-res-empty'>No open positions</div>}
                    {openTrades.map(t => (
                        <div key={t.contractId} className={`tvt-res-row tvt-res-row--${t.status}`}>
                            <span>{(SYMBOL_LABELS[t.symbol] || t.symbol).replace('Volatility ', 'V')}</span>
                            <span className={t.contractType === 'RISE' ? 'tvt-g' : 'tvt-r'}>{t.contractType}</span>
                            <span>{t.entryPrice.toFixed(2)}</span>
                            <span className={t.profit >= 0 ? 'tvt-g' : 'tvt-r'}>
                                {t.status === 'open'
                                    ? `${t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)}`
                                    : t.status === 'won' ? `+$${(t.payout - t.stake).toFixed(2)}` : `-$${t.stake.toFixed(2)}`
                                }
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default TradingViewTrading;
