import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SYMBOL_LABELS, PIP_SIZES } from '@/components/makoti-widget/makoti-ws';
import { sendViaNewSystemWithPromise, onNewSystemMessage } from '@/auth/NewDerivAuth';
import './fixed-range-volume.scss';

/* ── Types ─────────────────────────────────────────────────────────────────── */
interface VolumeBucket {
    price: number;
    count: number;
    pct: number;
    type: 'hvn' | 'lvn' | 'normal';
}

interface TickPoint {
    price: number;
    epoch: number;
}

/* ── Core Volume Profile Logic ─────────────────────────────────────────────── */
function buildVolumeProfile(ticks: TickPoint[], bucketCount: number): VolumeBucket[] {
    if (ticks.length === 0) return [];

    const prices = ticks.map(t => t.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const range = maxPrice - minPrice;

    if (range === 0) {
        return [{ price: minPrice, count: ticks.length, pct: 100, type: 'normal' }];
    }

    const bucketSize = range / bucketCount;
    const buckets: VolumeBucket[] = [];

    for (let i = 0; i < bucketCount; i++) {
        const low = minPrice + i * bucketSize;
        const high = low + bucketSize;
        const mid = low + bucketSize / 2;
        const count = ticks.filter(t => t.price >= low && (i === bucketCount - 1 ? t.price <= high : t.price < high)).length;
        buckets.push({ price: mid, count, pct: 0, type: 'normal' });
    }

    const maxCount = Math.max(...buckets.map(b => b.count), 1);
    const totalCount = ticks.length;

    // Classify HVN (top 30%) and LVN (bottom 20%)
    const sortedCounts = [...buckets].map(b => b.count).sort((a, b) => b - a);
    const hvnThreshold = sortedCounts[Math.floor(bucketCount * 0.3)] || 0;
    const lvnThreshold = sortedCounts[Math.floor(bucketCount * 0.8)] || 0;

    buckets.forEach(b => {
        b.pct = (b.count / maxCount) * 100;
        if (b.count >= hvnThreshold && b.count > 0) b.type = 'hvn';
        else if (b.count <= lvnThreshold) b.type = 'lvn';
    });

    return buckets.sort((a, b) => b.price - a.price);
}

/* ── Component ─────────────────────────────────────────────────────────────── */
interface Props {
    symbol: string;
    lastPrice: number;
}

const FixedRangeVolume: React.FC<Props> = ({ symbol, lastPrice }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [rangeType, setRangeType] = useState<'ticks' | 'custom'>('ticks');
    const [tickCount, setTickCount] = useState(200);
    const [startPrice, setStartPrice] = useState('');
    const [endPrice, setEndPrice] = useState('');
    const [buckets, setBuckets] = useState<VolumeBucket[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [tickPoints, setTickPoints] = useState<TickPoint[]>([]);
    const [pocPrice, setPocPrice] = useState(0);
    const [valueAreaHigh, setValueAreaHigh] = useState(0);
    const [valueAreaLow, setValueAreaLow] = useState(0);
    const [totalTicks, setTotalTicks] = useState(0);

    const mountedRef = useRef(true);

    // Fetch tick history
    const fetchTicks = useCallback(async () => {
        if (window._newSystemWS?.readyState !== WebSocket.OPEN) return;
        setIsAnalyzing(true);

        try {
            // Request tick history
            const response = await sendViaNewSystemWithPromise({
                ticks_history: symbol,
                style: 'ticks',
                count: Math.max(tickCount, 500),
                end: 'latest',
            });

            const prices = response?.ticks_history?.prices || [];
            const epochs = response?.ticks_history?.epoch || [];
            const pip = PIP_SIZES[symbol] ?? 2;

            const points: TickPoint[] = prices.map((p: number, i: number) => ({
                price: Number(Number(p).toFixed(pip)),
                epoch: epochs[i] || 0,
            }));

            setTickPoints(points);
            setTotalTicks(points.length);

            // Build profile
            let filteredPoints = points;
            if (rangeType === 'custom' && startPrice && endPrice) {
                const s = parseFloat(startPrice);
                const e = parseFloat(endPrice);
                if (!isNaN(s) && !isNaN(e)) {
                    const lo = Math.min(s, e);
                    const hi = Math.max(s, e);
                    filteredPoints = points.filter(p => p.price >= lo && p.price <= hi);
                }
            }

            // Use last N ticks for the profile
            const profilePoints = filteredPoints.slice(-tickCount);
            const profile = buildVolumeProfile(profilePoints, 24);

            if (profile.length > 0) {
                setBuckets(profile);

                // Calculate POC (Point of Control) — highest volume level
                const poc = profile.reduce((a, b) => b.count > a.count ? b : a, profile[0]);
                setPocPrice(poc.price);

                // Calculate Value Area (70% of volume around POC)
                const totalVol = profile.reduce((a, b) => a + b.count, 0);
                let volSum = poc.count;
                let vaHigh = poc.price;
                let vaLow = poc.price;
                const pocIndex = profile.findIndex(b => b.price === poc.price);
                let upIdx = pocIndex + 1;
                let downIdx = pocIndex - 1;

                while (volSum < totalVol * 0.7 && (upIdx < profile.length || downIdx >= 0)) {
                    const upVol = upIdx < profile.length ? profile[upIdx].count : 0;
                    const downVol = downIdx >= 0 ? profile[downIdx].count : 0;
                    if (upVol >= downVol) {
                        if (upIdx < profile.length) { volSum += upVol; vaHigh = profile[upIdx].price; upIdx++; }
                        else if (downIdx >= 0) { volSum += downVol; vaLow = profile[downIdx].price; downIdx--; }
                        else break;
                    } else {
                        if (downIdx >= 0) { volSum += downVol; vaLow = profile[downIdx].price; downIdx--; }
                        else if (upIdx < profile.length) { volSum += upVol; vaHigh = profile[upIdx].price; upIdx++; }
                        else break;
                    }
                }
                setValueAreaHigh(vaHigh);
                setValueAreaLow(vaLow);
            }
        } catch (e) {
            console.error('Volume profile fetch error:', e);
        } finally {
            setIsAnalyzing(false);
        }
    }, [symbol, tickCount, rangeType, startPrice, endPrice]);

    // Auto-fetch when opened
    useEffect(() => {
        if (isOpen) fetchTicks();
    }, [isOpen, fetchTicks]);

    // Live update every 2s
    useEffect(() => {
        if (!isOpen) return;
        const id = setInterval(() => { if (!isAnalyzing) fetchTicks(); }, 2000);
        return () => clearInterval(id);
    }, [isOpen, fetchTicks, isAnalyzing]);

    // Also subscribe to live ticks to update in real-time
    useEffect(() => {
        if (!isOpen) return;
        const unsub = onNewSystemMessage((event: MessageEvent) => {
            if (!mountedRef.current) return;
            try {
                const data = JSON.parse(event.data);
                if (data.tick && data.tick.symbol === symbol) {
                    const price = Number(data.tick.quote);
                    const pip = PIP_SIZES[symbol] ?? 2;
                    const rounded = Number(price.toFixed(pip));
                    setTickPoints(prev => [...prev.slice(-999), { price: rounded, epoch: Date.now() / 1000 }]);
                }
            } catch {}
        });
        return () => { mountedRef.current = false; unsub(); };
    }, [isOpen, symbol]);

    // Rebuild profile when tickPoints change
    useEffect(() => {
        if (tickPoints.length < 10) return;
        const profilePoints = tickPoints.slice(-tickCount);
        const profile = buildVolumeProfile(profilePoints, 24);
        setBuckets(profile);
        if (profile.length > 0) {
            const poc = profile.reduce((a, b) => b.count > a.count ? b : a, profile[0]);
            setPocPrice(poc.price);
            setTotalTicks(profilePoints.length);
        }
    }, [tickPoints, tickCount]);

    const maxCount = Math.max(...buckets.map(b => b.count), 1);
    const activePips = PIP_SIZES[symbol] ?? 2;

    return (
        <div className='frv-container'>
            {/* Toggle Button */}
            <button
                className={`frv-toggle ${isOpen ? 'frv-toggle--active' : ''}`}
                onClick={() => setIsOpen(o => !o)}
                title='Fixed Range Volume Profile'
            >
                <span className='frv-toggle-icon'>📊</span>
                <span className='frv-toggle-label'>Fixed Range</span>
            </button>

            {/* Volume Profile Panel */}
            {isOpen && (
                <div className='frv-panel'>
                    <div className='frv-panel-header'>
                        <span className='frv-title'>Volume Profile</span>
                        <button className='frv-close' onClick={() => setIsOpen(false)}>×</button>
                    </div>

                    {/* Config */}
                    <div className='frv-config'>
                        <div className='frv-config-row'>
                            <label>Range</label>
                            <select value={rangeType} onChange={e => setRangeType(e.target.value as any)}>
                                <option value='ticks'>Last N Ticks</option>
                                <option value='custom'>Custom Price Range</option>
                            </select>
                        </div>

                        {rangeType === 'ticks' && (
                            <div className='frv-config-row'>
                                <label>Ticks</label>
                                <input type='number' value={tickCount} onChange={e => setTickCount(Number(e.target.value) || 100)} min={50} max={2000} step={50} />
                            </div>
                        )}

                        {rangeType === 'custom' && (
                            <div className='frv-config-row'>
                                <label>Price Range</label>
                                <div className='frv-price-inputs'>
                                    <input type='number' value={startPrice} onChange={e => setStartPrice(e.target.value)} placeholder='From' step='0.01' />
                                    <input type='number' value={endPrice} onChange={e => setEndPrice(e.target.value)} placeholder='To' step='0.01' />
                                </div>
                            </div>
                        )}

                        <button className='frv-analyze' onClick={fetchTicks} disabled={isAnalyzing}>
                            {isAnalyzing ? 'Analyzing...' : 'Analyze'}
                        </button>
                    </div>

                    {/* Stats */}
                    {buckets.length > 0 && (
                        <div className='frv-stats'>
                            <div className='frv-stat'>
                                <span className='frv-stat-label'>Total Ticks</span>
                                <span className='frv-stat-value'>{totalTicks}</span>
                            </div>
                            <div className='frv-stat'>
                                <span className='frv-stat-label'>POC</span>
                                <span className='frv-stat-value frv-poc'>{pocPrice.toFixed(activePips)}</span>
                            </div>
                            <div className='frv-stat'>
                                <span className='frv-stat-label'>Value Area</span>
                                <span className='frv-stat-value'>{valueAreaLow.toFixed(activePips)} — {valueAreaHigh.toFixed(activePips)}</span>
                            </div>
                        </div>
                    )}

                    {/* Volume Bars */}
                    {buckets.length > 0 && (
                        <div className='frv-bars'>
                            {buckets.map((b, i) => (
                                <div key={i} className={`frv-bar-row frv-bar-row--${b.type}`}>
                                    <span className='frv-bar-price'>{b.price.toFixed(activePips)}</span>
                                    <div className='frv-bar-track'>
                                        <div
                                            className={`frv-bar-fill frv-bar-fill--${b.type}`}
                                            style={{ width: `${Math.max(b.pct, 2)}%` }}
                                        />
                                    </div>
                                    <span className='frv-bar-count'>{b.count}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Legend */}
                    {buckets.length > 0 && (
                        <div className='frv-legend'>
                            <span className='frv-legend-item frv-legend-item--hvn'>■ High Volume Node</span>
                            <span className='frv-legend-item frv-legend-item--lvn'>■ Low Volume Node</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default FixedRangeVolume;
