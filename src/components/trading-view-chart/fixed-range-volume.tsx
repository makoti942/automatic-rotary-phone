import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PIP_SIZES } from '@/components/makoti-widget/makoti-ws';
import { sendViaNewSystemWithPromise, onNewSystemMessage } from '@/auth/NewDerivAuth';

interface VolumeBucket { price: number; count: number; pct: number; type: 'hvn' | 'lvn' | 'normal'; }
interface TickPoint { price: number; epoch: number; }

function buildVolumeProfile(ticks: TickPoint[], bucketCount: number): VolumeBucket[] {
    if (ticks.length === 0) return [];
    const prices = ticks.map(t => t.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const range = maxPrice - minPrice;
    if (range === 0) return [{ price: minPrice, count: ticks.length, pct: 100, type: 'normal' }];

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
    const sorted = [...buckets].map(b => b.count).sort((a, b) => b - a);
    const hvnT = sorted[Math.floor(bucketCount * 0.3)] || 0;
    const lvnT = sorted[Math.floor(bucketCount * 0.8)] || 0;
    buckets.forEach(b => {
        b.pct = (b.count / maxCount) * 100;
        if (b.count >= hvnT && b.count > 0) b.type = 'hvn';
        else if (b.count <= lvnT) b.type = 'lvn';
    });
    return buckets.sort((a, b) => b.price - a.price);
}

function toLocalInput(epoch: number): string {
    const d = new Date(epoch * 1000);
    return d.toISOString().slice(0, 16);
}

interface Props { symbol: string; lastPrice: number; }

const FixedRangeVolume: React.FC<Props> = ({ symbol, lastPrice }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [mode, setMode] = useState<'recent' | 'custom'>('recent');
    const [recentMinutes, setRecentMinutes] = useState(5);
    const [fromTime, setFromTime] = useState('');
    const [toTime, setToTime] = useState('');
    const [buckets, setBuckets] = useState<VolumeBucket[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [tickPoints, setTickPoints] = useState<TickPoint[]>([]);
    const [pocPrice, setPocPrice] = useState(0);
    const [vaHigh, setVaHigh] = useState(0);
    const [vaLow, setVaLow] = useState(0);
    const [tickCount, setTickCount] = useState(0);
    const [minPrice, setMinPrice] = useState(0);
    const [maxPrice, setMaxPrice] = useState(0);

    const mountedRef = useRef(true);
    const allTicksRef = useRef<TickPoint[]>([]);

    // Subscribe to live ticks always (when open)
    useEffect(() => {
        mountedRef.current = true;
        if (!isOpen) return;
        const unsub = onNewSystemMessage((event: MessageEvent) => {
            if (!mountedRef.current) return;
            try {
                const data = JSON.parse(event.data);
                if (data.tick && data.tick.symbol === symbol) {
                    const price = Number(data.tick.quote);
                    const pip = PIP_SIZES[symbol] ?? 2;
                    allTicksRef.current = [...allTicksRef.current.slice(-4999), { price: Number(price.toFixed(pip)), epoch: Date.now() / 1000 }];
                }
            } catch {}
        });
        return () => { mountedRef.current = false; unsub(); };
    }, [isOpen, symbol]);

    // Fetch historical ticks on open
    const fetchHistory = useCallback(async () => {
        if (window._newSystemWS?.readyState !== WebSocket.OPEN) return;
        setIsAnalyzing(true);
        try {
            const now = Date.now() / 1000;
            let oldest = now - recentMinutes * 60;
            if (mode === 'custom' && fromTime) {
                oldest = new Date(fromTime).getTime() / 1000;
            }
            // Fetch up to 2000 ticks
            const res: any = await sendViaNewSystemWithPromise({
                ticks_history: symbol, style: 'ticks', count: 2000, end: 'latest',
            });
            const prices = res?.ticks_history?.prices || [];
            const epochs = res?.ticks_history?.epoch || [];
            const pip = PIP_SIZES[symbol] ?? 2;
            const points: TickPoint[] = prices.map((p: number, i: number) => ({
                price: Number(Number(p).toFixed(pip)),
                epoch: epochs[i] || 0,
            }));
            allTicksRef.current = points;
        } catch {}
        setIsAnalyzing(false);
    }, [symbol, recentMinutes, mode, fromTime]);

    useEffect(() => { if (isOpen) fetchHistory(); }, [isOpen, fetchHistory]);

    // Rebuild profile when time range changes
    useEffect(() => {
        const now = Date.now() / 1000;
        let start = now - recentMinutes * 60;
        let end = now;
        if (mode === 'custom') {
            if (fromTime) start = new Date(fromTime).getTime() / 1000;
            if (toTime) end = new Date(toTime).getTime() / 1000;
        }
        const filtered = allTicksRef.current.filter(t => t.epoch >= start && t.epoch <= end);
        setTickCount(filtered.length);
        if (filtered.length < 5) { setBuckets([]); return; }
        const p = buildVolumeProfile(filtered, 24);
        setBuckets(p);
        if (p.length > 0) {
            const poc = p.reduce((a, b) => b.count > a.count ? b : a, p[0]);
            setPocPrice(poc.price);
            setMinPrice(Math.min(...filtered.map(t => t.price)));
            setMaxPrice(Math.max(...filtered.map(t => t.price)));
            // Value area
            const totalVol = p.reduce((a, b) => a + b.count, 0);
            let volSum = poc.count;
            let vh = poc.price, vl = poc.price;
            const pi = p.findIndex(b => b.price === poc.price);
            let u = pi + 1, d = pi - 1;
            while (volSum < totalVol * 0.7 && (u < p.length || d >= 0)) {
                const uv = u < p.length ? p[u].count : 0;
                const dv = d >= 0 ? p[d].count : 0;
                if (uv >= dv) {
                    if (u < p.length) { volSum += uv; vh = p[u].price; u++; }
                    else if (d >= 0) { volSum += dv; vl = p[d].price; d--; }
                    else break;
                } else {
                    if (d >= 0) { volSum += dv; vl = p[d].price; d--; }
                    else if (u < p.length) { volSum += uv; vh = p[u].price; u++; }
                    else break;
                }
            }
            setVaHigh(vh); setVaLow(vl);
        }
    }, [tickPoints, recentMinutes, mode, fromTime, toTime, allTicksRef.current.length]);

    // Trigger rebuild on live tick
    useEffect(() => {
        const id = setInterval(() => setTickPoints(p => [...p]), 1000);
        return () => clearInterval(id);
    }, []);

    const pips = PIP_SIZES[symbol] ?? 2;

    return (
        <div className='frv-container'>
            <button className={`frv-toggle ${isOpen ? 'frv-toggle--active' : ''}`} onClick={() => setIsOpen(o => !o)}>
                📊 Fixed Range
            </button>

            {isOpen && (
                <div className='frv-panel'>
                    <div className='frv-panel-header'>
                        <span className='frv-title'>Volume Profile</span>
                        <button className='frv-close' onClick={() => setIsOpen(false)}>×</button>
                    </div>

                    <div className='frv-config'>
                        {/* Mode */}
                        <div className='frv-config-row'>
                            <label>Time Range</label>
                            <select value={mode} onChange={e => setMode(e.target.value as any)}>
                                <option value='recent'>Last N Minutes</option>
                                <option value='custom'>From → To</option>
                            </select>
                        </div>

                        {mode === 'recent' && (
                            <div className='frv-config-row'>
                                <label>Minutes</label>
                                <select value={recentMinutes} onChange={e => setRecentMinutes(Number(e.target.value))}>
                                    {[1, 2, 3, 5, 10, 15, 30, 60].map(m => <option key={m} value={m}>{m} min</option>)}
                                </select>
                            </div>
                        )}

                        {mode === 'custom' && (
                            <div className='frv-time-row'>
                                <div className='frv-config-row' style={{ flex: 1 }}>
                                    <label>From</label>
                                    <input type='datetime-local' value={fromTime} onChange={e => setFromTime(e.target.value)} />
                                </div>
                                <div className='frv-config-row' style={{ flex: 1 }}>
                                    <label>To</label>
                                    <input type='datetime-local' value={toTime} onChange={e => setToTime(e.target.value)} />
                                </div>
                            </div>
                        )}

                        <button className='frv-analyze' onClick={fetchHistory} disabled={isAnalyzing}>
                            {isAnalyzing ? 'Loading...' : 'Analyze'}
                        </button>
                    </div>

                    {buckets.length > 0 && (
                        <div className='frv-stats'>
                            <div className='frv-stat'><span className='frv-stat-label'>Ticks in range</span><span className='frv-stat-value'>{tickCount}</span></div>
                            <div className='frv-stat'><span className='frv-stat-label'>Price range</span><span className='frv-stat-value'>{minPrice.toFixed(pips)} — {maxPrice.toFixed(pips)}</span></div>
                            <div className='frv-stat'><span className='frv-stat-label'>POC</span><span className='frv-stat-value frv-poc'>{pocPrice.toFixed(pips)}</span></div>
                            <div className='frv-stat'><span className='frv-stat-label'>Value Area</span><span className='frv-stat-value'>{vaLow.toFixed(pips)} — {vaHigh.toFixed(pips)}</span></div>
                        </div>
                    )}

                    {buckets.length > 0 && (
                        <div className='frv-bars'>
                            {buckets.map((b, i) => (
                                <div key={i} className={`frv-bar-row frv-bar-row--${b.type}`}>
                                    <span className='frv-bar-price'>{b.price.toFixed(pips)}</span>
                                    <div className='frv-bar-track'>
                                        <div className={`frv-bar-fill frv-bar-fill--${b.type}`} style={{ width: `${Math.max(b.pct, 2)}%` }} />
                                    </div>
                                    <span className='frv-bar-count'>{b.count}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {buckets.length === 0 && !isAnalyzing && (
                        <div style={{ padding: 12, textAlign: 'center', fontSize: 10, color: '#64748b' }}>
                            Select time range and click Analyze
                        </div>
                    )}

                    {buckets.length > 0 && (
                        <div className='frv-legend'>
                            <span className='frv-legend-item frv-legend-item--hvn'>■ High Volume</span>
                            <span className='frv-legend-item frv-legend-item--lvn'>■ Low Volume</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default FixedRangeVolume;
