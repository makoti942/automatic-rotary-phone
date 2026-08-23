import React, { useMemo, useState } from 'react';
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
    } = useManualTrade();

    const [ddOpen, setDdOpen] = useState(false);

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
                        </div>
                    </div>

                    <div className='mt-stats'>
                        <div className='mt-stats-header'>
                            Digit Distribution (last {digitTotal} ticks)
                        </div>
                        <div className='mt-bars'>
                            {digitLabels.map((label, i) => {
                                const pct = digitPcts[i];
                                const growth = digitGrowth[i] ?? 0;
                                const isSelected = i === selectedDigit && needsTarget;
                                const isLive = i === lastDigit;
                                const flashCls =
                                    tradeFlash && tradeFlash.digit === i
                                        ? tradeFlash.win
                                            ? 'mt-bar-col--win'
                                            : 'mt-bar-col--loss'
                                        : '';
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
                                        className={`mt-bar-col ${isSelected ? 'mt-bar-col--sel' : ''} ${isLive ? 'mt-bar-col--live' : ''} ${flashCls}`}
                                        onClick={() => setSelectedDigit(i)}
                                        title={`Digit ${i}: ${pct.toFixed(1)}% (${growth >= 0 ? '+' : ''}${growth.toFixed(1)}pp)`}
                                    >
                                        {isHot && <span className='mt-badge mt-badge--hot'>HOT</span>}
                                        {isLow && <span className='mt-badge mt-badge--low'>LOW</span>}
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

                    {/* Target digit hint for types that need one */}
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
                                value={duration}
                                onChange={e => setDuration(parseInt(e.target.value) || 1)}
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

                    {buyResult && (
                        <div className='mt-result mt-result--ok'>
                            Purchased! Contract #{buyResult.contract_id} | Payout: ${buyResult.payout.toFixed(2)}
                            <button className='mt-dismiss' onClick={clearBuyResult}>×</button>
                        </div>
                    )}
                    {buyError && (
                        <div className='mt-result mt-result--err'>
                            {buyError}
                            <button className='mt-dismiss' onClick={clearBuyResult}>×</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

export default ManualTrade;
