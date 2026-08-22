import React, { useMemo } from 'react';
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

const ManualTrade = observer(() => {
    const {
        symbols, activeSymbol, setActiveSymbol,
        currentTick, lastDigit, digitCounts, digitGrowth, digitTotal, pipSize,
        tradeType, setTradeType,
        contractMode, setContractMode,
        selectedDigit, setSelectedDigit,
        stake, setStake, duration, setDuration,
        proposal, isProposalLoading,
        buyContract, isBuying, buyResult, buyError, clearBuyResult,
        positions, sellContract,
        isConnected, isLoading,
    } = useManualTrade();

    const digitLabels = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const maxCount = Math.max(1, ...digitCounts);
    const modeOptions = CONTRACT_MODE_OPTIONS[tradeType];

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

    const predictionText = useMemo(() => {
        switch (contractMode) {
            case 'DIGITMATCH': return `match ${selectedDigit}`;
            case 'DIGITDIFF': return `differ from ${selectedDigit}`;
            case 'DIGITOVER': return `be over ${selectedDigit}`;
            case 'DIGITUNDER': return `be under ${selectedDigit}`;
            case 'DIGITEVEN': return 'be even';
            case 'DIGITODD': return 'be odd';
        }
    }, [contractMode, selectedDigit]);

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
                                const isSelected = i === selectedDigit && contractMode !== 'DIGITEVEN' && contractMode !== 'DIGITODD';
                                const isHi = i >= 7;
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
                                        className={`mt-bar-col ${isSelected ? 'mt-bar-col--sel' : ''}`}
                                        onClick={() => setSelectedDigit(i)}
                                        title={`Digit ${i}: ${pct.toFixed(1)}% (${growth >= 0 ? '+' : ''}${growth.toFixed(1)}pp)`}
                                    >
                                        <div className='mt-bar-fill' style={{ height: `${fillHeight}%` }} />
                                        {isHot && <span className='mt-badge mt-badge--hot'>HOT</span>}
                                        {isLow && <span className='mt-badge mt-badge--low'>LOW</span>}
                                        <span className='mt-bar-pct'>{pct.toFixed(1)}%</span>
                                        <span className={`mt-growth ${growthClass}`}>{growthIcon}</span>
                                        <span className={`mt-bar-lbl ${isHi && isSelected ? 'mt-bar-lbl--hi' : ''}`}>{label}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Right column: trade controls */}
                <div className='mt-trade-section'>
                    {/* Trade type chips */}
                    <div className='mt-chips'>
                        {(['matches-differs', 'over-under', 'even-odd'] as TradeType[]).map(t => (
                            <button
                                key={t}
                                className={`mt-chip ${tradeType === t ? 'mt-chip--on' : ''}`}
                                onClick={() => setTradeType(t)}
                            >
                                {t === 'matches-differs' ? 'Matches / Differs'
                                    : t === 'over-under' ? 'Over / Under'
                                    : 'Even / Odd'}
                            </button>
                        ))}
                    </div>

                    {/* Contract mode toggle */}
                    <div className='mt-mode-group'>
                        {modeOptions.map(opt => (
                            <button
                                key={opt.value}
                                className={`mt-mode-btn ${contractMode === opt.value ? 'mt-mode-btn--on' : ''}`}
                                onClick={() => setContractMode(opt.value)}
                            >
                                {opt.label}
                            </button>
                        ))}
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
                                value={duration}
                                onChange={e => setDuration(parseInt(e.target.value) || 1)}
                                min={1}
                                max={10}
                                step={1}
                            />
                        </div>
                    </div>

                    {/* Prediction */}
                    <div className='mt-prediction'>
                        Last digit will <strong>{predictionText}</strong>
                    </div>

                    {/* Buy button + proposal */}
                    <button
                        className='mt-buy-btn'
                        disabled={!isConnected || !proposal || isBuying}
                        onClick={buyContract}
                    >
                        {isBuying ? 'Purchasing…'
                            : proposal ? `Buy @ $${proposal.askPrice.toFixed(2)}`
                            : isProposalLoading ? 'Getting price…'
                            : 'Buy Contract'}
                    </button>

                    {isProposalLoading && <div className='mt-hint'>Fetching proposal…</div>}

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

            {/* Positions */}
            {positions.length > 0 && (
                <div className='mt-positions'>
                    <div className='mt-positions-header'>Recent Positions</div>
                    <div className='mt-positions-list'>
                        {positions.slice(0, 10).map(pos => (
                            <div key={pos.contract_id} className='mt-pos-row'>
                                <span className='mt-pos-sym'>{pos.symbol}</span>
                                <span className='mt-pos-type'>{pos.contract_type}</span>
                                <span className='mt-pos-price'>${pos.buy_price.toFixed(2)}</span>
                                <span className={`mt-pos-status ${pos.is_sold ? 'mt-pos-status--sold' : 'mt-pos-status--open'}`}>
                                    {pos.is_sold ? 'Closed' : 'Open'}
                                </span>
                                {pos.profit !== null && (
                                    <span className={`mt-pos-profit ${pos.profit >= 0 ? 'mt-pos-profit--win' : 'mt-pos-profit--loss'}`}>
                                        {pos.profit >= 0 ? '+' : ''}{pos.profit.toFixed(2)}
                                    </span>
                                )}
                                {!pos.is_sold && (
                                    <button className='mt-sell-btn' onClick={() => sellContract(pos.contract_id)}>
                                        Sell
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
});

export default ManualTrade;
