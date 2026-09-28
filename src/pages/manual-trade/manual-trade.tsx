import React, { useMemo, useState, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useManualTrade, TradeType, ContractMode } from './use-manual-trade';
import { SYMBOL_LABELS } from '@/components/makoti-widget/makoti-ws';
import './manual-trade.scss';

const CONTRACT_MODE_OPTIONS: Record<TradeType, { value: ContractMode; label: string }[]> = {
    'matches-differs': [
        { value: 'DIGITMATCH', label: 'Matches' },
        { value: 'DIGITDIFF', label: 'Differs' },
    ],
    'over-under': [
        { value: 'DIGITOVER', label: 'Over' },
        { value: 'DIGITUNDER', label: 'Under' },
    ],
    'even-odd': [
        { value: 'DIGITEVEN', label: 'Even' },
        { value: 'DIGITODD', label: 'Odd' },
    ],
};

const TRADE_TYPE_LABELS: Record<TradeType, string> = {
    'matches-differs': 'Matches / Differs',
    'over-under': 'Over / Under',
    'even-odd': 'Even / Odd',
};

const ManualTrade = observer(() => {
    const {
        symbols, activeSymbol, setActiveSymbol,
        currentTick, lastDigit, digitCounts, digitGrowth, digitTotal, pipSize,
        tradeType, setTradeType,
        selectedDigit, setSelectedDigit,
        stake, setStake, duration, setDuration,
        buyWithMode, isBuying, buyResult, buyError, clearBuyResult,
        isConnected, isLoading, tradeFlash,
        notifications, exitDigit, activeTrade, tradeHistory, clearTradeHistory,
        entryDigitEnabled, setEntryDigitEnabled, entryDigitValue, setEntryDigitValue,
    } = useManualTrade();

    const [ddOpen, setDdOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [rawBarrier, setRawBarrier] = useState(String(selectedDigit));
    const [rawEntry, setRawEntry] = useState(String(entryDigitValue));
    const [rawDuration, setRawDuration] = useState(String(duration));

    useEffect(() => setRawBarrier(String(selectedDigit)), [selectedDigit]);
    useEffect(() => setRawEntry(String(entryDigitValue)), [entryDigitValue]);
    useEffect(() => setRawDuration(String(duration)), [duration]);

    const digitLabels = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const modeOptions = CONTRACT_MODE_OPTIONS[tradeType];
    const needsTarget = tradeType === 'matches-differs' || tradeType === 'over-under';

    const digitPcts = useMemo(() => {
        if (digitTotal === 0) return Array(10).fill(0);
        return digitCounts.map(c => (c / digitTotal) * 100);
    }, [digitCounts, digitTotal]);

    const hotIdx = useMemo(() => {
        if (digitTotal === 0) return -1;
        let maxPct = -1, idx = -1;
        digitPcts.forEach((p, i) => { if (p > maxPct) { maxPct = p; idx = i; } });
        return idx;
    }, [digitPcts, digitTotal]);

    const lowIdx = useMemo(() => {
        if (digitTotal === 0) return -1;
        let minPct = Infinity, idx = -1;
        digitPcts.forEach((p, i) => { if (p < minPct) { minPct = p; idx = i; } });
        return idx;
    }, [digitPcts, digitTotal]);

    const currentPrice = currentTick?.quote.toFixed(pipSize) ?? '—';
    const sessionProfit = tradeHistory.reduce((total, trade) => total + (trade.profit ?? 0), 0);

    if (isLoading) {
        return (
            <div className='mt-page'>
                <div className='mt-loading'>Connecting to Deriv API…</div>
            </div>
        );
    }

    return (
        <div className='mt-page'>
            <div className='mt-main'>
                {/* Left column: tick display + digit stats */}
                <div className='mt-tick-section'>
                    <div className='mt-symbol-bar'>
                        <select
                            className='mt-select'
                            value={activeSymbol}
                            onChange={e => setActiveSymbol(e.target.value)}
                        >
                            {symbols.map(s => (
                                <option key={s.symbol} value={s.symbol}>
                                    {SYMBOL_LABELS[s.symbol] ?? s.display_name}
                                </option>
                            ))}
                        </select>
                        <span className={`mt-status ${isConnected ? 'mt-status--on' : 'mt-status--off'}`}>
                            {isConnected ? 'Live' : 'Offline'}
                        </span>
                    </div>

                    <div className='mt-tick-display'>
                        <div className='mt-price'>{currentPrice}</div>
                        <div className='mt-digit-row'>
                            {lastDigit !== null && (
                                <span className='mt-last-digit'>{lastDigit}</span>
                            )}
                            <span className='mt-digit-label'>
                                {lastDigit !== null ? 'Last Digit' : 'Awaiting tick…'}
                            </span>
                            <button type='button' className='mt-history-trigger' onClick={() => setHistoryOpen(true)} aria-label='Show executed trades'>
                                <span className='mt-history-trigger-icon'>☰</span>
                                Trades <b>{tradeHistory.length}</b>
                            </button>
                        </div>
                    </div>

                    <div className='mt-stats'>
                        <div className='mt-stats-header'>
                            <span>Digit Distribution (last {digitTotal} ticks)</span>
                            {activeTrade && (
                                <span className='mt-running-trade'>
                                    <i /> RUNNING · {activeTrade.contractType}{activeTrade.contractType !== 'DIGITEVEN' && activeTrade.contractType !== 'DIGITODD' ? ` ${activeTrade.selectedDigit}` : ''} · #{activeTrade.contractId}
                                </span>
                            )}
                        </div>
                        <div className='mt-bars'>
                            {digitLabels.map((label, i) => {
                                const pct = digitPcts[i];
                                const growth = digitGrowth[i] ?? 0;
                                const isSelected = i === selectedDigit && needsTarget;
                                const isLive = i === lastDigit;
                                const isExit = i === exitDigit;
                                const isRunningTarget = !!activeTrade && activeTrade.selectedDigit === i && activeTrade.contractType !== 'DIGITEVEN' && activeTrade.contractType !== 'DIGITODD';
                                const flashCls =
                                    tradeFlash && tradeFlash.digit === i
                                        ? tradeFlash.win
                                            ? 'mt-bar-col--win'
                                            : 'mt-bar-col--loss'
                                        : isExit ? 'mt-bar-col--exit' : '';
                                const isHot = i === hotIdx && digitTotal > 0;
                                const isLow = i === lowIdx && digitTotal > 0;
                                // Scale bars relative to the hottest digit (baseline
                                // 10%): with near-uniform distributions all bars at
                                // pct*4 looked identical, so differences were invisible.
                                const maxPct = Math.max(10, ...digitPcts);
                                const fillHeight = pct > 0 ? Math.max(6, (pct / maxPct) * 100) : 0;
                                const growthIcon = growth > 2 ? '▲' : growth > 0.5 ? '△' : growth < -2 ? '▼' : growth < -0.5 ? '▽' : '–';
                                const growthClass = growth > 0.5 ? 'mt-growth--up' : growth < -0.5 ? 'mt-growth--dn' : 'mt-growth--flat';
                                return (
                                    <div
                                        key={i}
                                        className={`mt-bar-col ${isSelected ? 'mt-bar-col--sel' : ''} ${isLive ? 'mt-bar-col--live' : ''} ${isRunningTarget ? 'mt-bar-col--running' : ''} ${flashCls}`}
                                        onClick={() => setSelectedDigit(i)}
                                        title={`Digit ${i}: ${pct.toFixed(1)}% (${growth >= 0 ? '+' : ''}${growth.toFixed(1)}pp)`}
                                    >
                                        {isHot && <span className='mt-badge mt-badge--hot'>HOT</span>}
                                        {isLow && <span className='mt-badge mt-badge--low'>LOW</span>}
                                        {isRunningTarget && <span className='mt-badge mt-badge--running'>TRADE</span>}
                                        <div className='mt-bar-top'>
                                            <span className='mt-bar-pct'>{pct.toFixed(1)}%</span>
                                            <span className={`mt-growth ${growthClass}`}>{growthIcon}</span>
                                        </div>
                                        <div className='mt-bar-track'>
                                            <div className='mt-bar-fill' style={{ height: `${fillHeight}%` }} />
                                        </div>
                                        <span className={`mt-bar-lbl ${isSelected ? 'mt-bar-lbl--hi' : ''}`}>{label}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Right column: trade controls */}
                <div className='mt-trade-section'>
                    {/* Contract type — custom dropdown (no native select) */}
                    <div className='mt-dd'>
                        <button
                            type='button'
                            className={`mt-dd-btn ${ddOpen ? 'is-open' : ''}`}
                            onClick={() => setDdOpen(o => !o)}
                        >
                            <span>{TRADE_TYPE_LABELS[tradeType]}</span>
                            <span className='mt-dd-caret'>▾</span>
                        </button>
                        {ddOpen && (
                            <>
                                <div className='mt-dd-backdrop' onClick={() => setDdOpen(false)} />
                                <div className='mt-dd-panel'>
                                    {(Object.keys(TRADE_TYPE_LABELS) as TradeType[]).map(t => (
                                        <button
                                            key={t}
                                            type='button'
                                            className={`mt-dd-opt ${t === tradeType ? 'is-active' : ''}`}
                                            onClick={() => {
                                                setTradeType(t);
                                                setDdOpen(false);
                                            }}
                                        >
                                            {TRADE_TYPE_LABELS[t]}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>

                    {needsTarget && (
                        <div className='mt-field mt-barrier-field'>
                            <label className='mt-label'>Prediction / Barrier Digit</label>
                            <input
                                className='mt-input'
                                type='number'
                                inputMode='numeric'
                                min={0}
                                max={9}
                                step={1}
                                value={rawBarrier}
                                onChange={e => {
                                    setRawBarrier(e.target.value);
                                    const n = Number(e.target.value);
                                    if (e.target.value !== '' && Number.isFinite(n)) setSelectedDigit(Math.max(0, Math.min(9, Math.trunc(n))));
                                }}
                                onBlur={() => { if (rawBarrier === '' || rawBarrier === '-') { setRawBarrier('0'); setSelectedDigit(0); } }}
                                aria-label='Prediction or barrier digit'
                            />
                        </div>
                    )}

                    {/* Entry Digit Toggle */}
                    <div className='mt-entry-row'>
                        <div className='mt-entry-switch-wrap'>
                            <span className='mt-label'>Entry Digit</span>
                            <button
                                type='button'
                                className={`mt-entry-toggle ${entryDigitEnabled ? 'is-on' : ''}`}
                                onClick={() => setEntryDigitEnabled(e => !e)}
                                aria-label='Toggle entry digit'
                            >
                                <span className='mt-entry-toggle-knob' />
                            </button>
                        </div>
                        {entryDigitEnabled && (
                            <div className='mt-field mt-entry-digit-field'>
                                <input
                                    className='mt-input'
                                    type='number'
                                    inputMode='numeric'
                                    min={0}
                                    max={9}
                                    step={1}
                                    value={rawEntry}
                                    onChange={e => {
                                        setRawEntry(e.target.value);
                                        const n = Number(e.target.value);
                                        if (e.target.value !== '' && Number.isFinite(n)) setEntryDigitValue(Math.max(0, Math.min(9, Math.trunc(n))));
                                    }}
                                    onBlur={() => { if (rawEntry === '' || rawEntry === '-') { setRawEntry('0'); setEntryDigitValue(0); } }}
                                    aria-label='Entry digit'
                                />
                            </div>
                        )}
                    </div>

                    {/* Stake + Duration */}
                    <div className='mt-input-row'>
                        <div className='mt-field'>
                            <label className='mt-label'>Stake (USD)</label>
                            <input
                                className='mt-input'
                                type='number'
                                value={stake}
                                onChange={e => setStake(e.target.value)}
                                min={0.01}
                                step={0.01}
                            />
                        </div>
                        <div className='mt-field'>
                            <label className='mt-label'>Duration (Ticks)</label>
                            <input
                                className='mt-input'
                                type='number'
                                value={rawDuration}
                                onChange={e => {
                                    setRawDuration(e.target.value);
                                    const n = parseInt(e.target.value);
                                    if (e.target.value !== '' && Number.isFinite(n)) setDuration(Math.max(1, Math.min(10, n)));
                                }}
                                onBlur={() => { if (rawDuration === '' || rawDuration === '0') { setRawDuration('1'); setDuration(1); } }}
                                min={1}
                                max={10}
                                step={1}
                            />
                        </div>
                    </div>

                    {/* Two direct execution buttons — click = instant buy */}
                    <div className='mt-exec-row'>
                        {modeOptions.map((opt, idx) => {
                            const showDigit =
                                opt.value === 'DIGITOVER' ||
                                opt.value === 'DIGITUNDER' ||
                                opt.value === 'DIGITMATCH' ||
                                opt.value === 'DIGITDIFF';
                            const label = opt.label + (showDigit ? ` ${selectedDigit}` : '');
                            return (
                                <button
                                    key={opt.value}
                                    className={`mt-exec ${idx === 0 ? 'mt-exec--first' : 'mt-exec--second'}`}
                                    disabled={isBuying || !isConnected || (showDigit && selectedDigit < 0)}
                                    onClick={() => buyWithMode(opt.value)}
                                >
                                    {isBuying ? '…' : label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {historyOpen && (
                <>
                    <div className='mt-history-backdrop' onClick={() => setHistoryOpen(false)} />
                    <aside className='mt-history-drawer' aria-label='Executed trades'>
                        <div className='mt-history-head'>
                            <div>
                                <h2>Session Trades</h2>
                                <span>{tradeHistory.length} executed trade{tradeHistory.length === 1 ? '' : 's'}</span>
                            </div>
                            <button type='button' className='mt-history-close' onClick={() => setHistoryOpen(false)} aria-label='Close trade history'>←</button>
                        </div>
                        <div className='mt-history-summary'>
                            <div><small>SESSION P/L</small><strong className={sessionProfit >= 0 ? 'is-profit' : 'is-loss'}>{sessionProfit >= 0 ? '+' : ''}${sessionProfit.toFixed(2)}</strong></div>
                            <button type='button' className='mt-history-clear' onClick={clearTradeHistory} disabled={tradeHistory.length === 0}>Clear</button>
                        </div>
                        <div className='mt-history-list'>
                            {tradeHistory.length === 0 ? (
                                <div className='mt-history-empty'><strong>No trades yet</strong><span>Executed trades from this session will appear here.</span></div>
                            ) : tradeHistory.slice().reverse().map(trade => (
                                <article className={`mt-history-card mt-history-card--${trade.status}`} key={trade.contractId}>
                                    <div className='mt-history-card-top'>
                                        <strong>{trade.contractType}</strong>
                                        <span className={`mt-history-status mt-history-status--${trade.status}`}>{trade.status === 'open' ? 'RUNNING' : trade.status.toUpperCase()}</span>
                                    </div>
                                    <div className='mt-history-meta'><span>{SYMBOL_LABELS[trade.symbol] ?? trade.symbol}</span><span>#{trade.contractId}</span></div>
                                    <div className='mt-history-values'>
                                        <div><small>STAKE</small><b>${trade.stake.toFixed(2)}</b></div>
                                        <div><small>PROFIT</small><b className={trade.profit !== null && trade.profit >= 0 ? 'is-profit' : trade.profit !== null ? 'is-loss' : ''}>{trade.profit === null ? '—' : `${trade.profit >= 0 ? '+' : ''}$${trade.profit.toFixed(2)}`}</b></div>
                                    </div>
                                    <div className='mt-history-time'>{new Date(trade.executedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                                </article>
                            ))}
                        </div>
                    </aside>
                </>
            )}

            {/* Notification popups */}
            <div className='mt-notifications'>
                {notifications.map(n => (
                    <div key={n.key} className={`mt-notif mt-notif--${n.type}`}>
                        {n.type === 'opened' && (
                            <>
                                <span className='mt-notif-icon'>📤</span>
                                <div className='mt-notif-body'>
                                    <span className='mt-notif-title'>Contract Opened</span>
                                    <span className='mt-notif-detail'>#{n.contractId} | {n.contractType} | ${n.stake?.toFixed(2)}</span>
                                </div>
                            </>
                        )}
                        {n.type === 'closed' && (
                            <>
                                <span className='mt-notif-icon'>{n.win ? '🏆' : '💔'}</span>
                                <div className='mt-notif-body'>
                                    <span className='mt-notif-title'>Contract Closed</span>
                                    <span className='mt-notif-detail'>
                                        Exit digit: {n.exitDigit ?? '—'} | {n.win ? '+' : ''}${n.profit?.toFixed(2)}
                                    </span>
                                </div>
                            </>
                        )}
                        {n.type === 'error' && (
                            <>
                                <span className='mt-notif-icon'>❌</span>
                                <div className='mt-notif-body'>
                                    <span className='mt-notif-title'>Trade Failed</span>
                                    <span className='mt-notif-detail'>{n.message}</span>
                                </div>
                            </>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
});

export default ManualTrade;
