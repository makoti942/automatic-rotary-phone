import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PIP_SIZES } from '@/components/makoti-widget/makoti-ws';
import { sendViaNewSystemWithPromise, onNewSystemMessage } from '@/auth/NewDerivAuth';

interface VolumeBucket { price: number; count: number; pct: number; type: 'hvn' | 'lvn' | 'normal'; }
interface TickPoint { price: number; epoch: number; }

function buildVolumeProfile(ticks: TickPoint[], bucketCount: number): VolumeBucket[] {
    if (ticks.length === 0) return [];
    const prices = ticks.map(t => t.price);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const range = maxP - minP;
    if (range === 0) return [{ price: minP, count: ticks.length, pct: 100, type: 'normal' }];
    const size = range / bucketCount;
    const buckets: VolumeBucket[] = [];
    for (let i = 0; i < bucketCount; i++) {
        const lo = minP + i * size;
        const hi = lo + size;
        const mid = lo + size / 2;
        const count = ticks.filter(t => t.price >= lo && (i === bucketCount - 1 ? t.price <= hi : t.price < hi)).length;
        buckets.push({ price: mid, count, pct: 0, type: 'normal' });
    }
    const maxC = Math.max(...buckets.map(b => b.count), 1);
    const sorted = [...buckets].map(b => b.count).sort((a, b) => b - a);
    const hvnT = sorted[Math.floor(bucketCount * 0.3)] || 0;
    const lvnT = sorted[Math.floor(bucketCount * 0.8)] || 0;
    buckets.forEach(b => {
        b.pct = (b.count / maxC) * 100;
        if (b.count >= hvnT && b.count > 0) b.type = 'hvn';
        else if (b.count <= lvnT) b.type = 'lvn';
    });
    return buckets.sort((a, b) => b.price - a.price);
}

interface Props { symbol: string; lastPrice: number; }

const FixedRangeVolume: React.FC<Props> = ({ symbol }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [fromTime, setFromTime] = useState('');
    const [toTime, setToTime] = useState('');
    const [buckets, setBuckets] = useState<VolumeBucket[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [pocPrice, setPocPrice] = useState(0);
    const [vaHigh, setVaHigh] = useState(0);
    const [vaLow, setVaLow] = useState(0);
    const [tickCount, setTickCount] = useState(0);
    const [totalFetched, setTotalFetched] = useState(0);
    const [fetchedProgress, setFetchedProgress] = useState(0);
    const [minP, setMinP] = useState(0);
    const [maxP, setMaxP] = useState(0);
    const [resultMsg, setResultMsg] = useState('');

    const mountedRef = useRef(true);
    const allTicksRef = useRef<TickPoint[]>([]);

    // Subscribe to live ticks
    useEffect(() => {
        mountedRef.current = true;
        if (!isOpen) return;
        const unsub = onNewSystemMessage((event: MessageEvent) => {
            if (!mountedRef.current) return;
            try {
                const data = JSON.parse(event.data);
                if (data.tick && data.tick.symbol === symbol) {
                    const pip = PIP_SIZES[symbol] ?? 2;
                    allTicksRef.current = [...allTicksRef.current.slice(-4999), { price: Number(Number(data.tick.quote).toFixed(pip)), epoch: Date.now() / 1000 }];
                }
            } catch {}
        });
        return () => { mountedRef.current = false; unsub(); };
    }, [isOpen, symbol]);

    // Load default times (last 1 hour) when opened
    useEffect(() => {
        if (!isOpen) return;
        const now = new Date();
        const from = new Date(now.getTime() - 60 * 60 * 1000);
        const fmt = (d: Date) => {
            const y = d.getFullYear();
            const mo = String(d.getMonth() + 1).padStart(2, '0');
            const da = String(d.getDate()).padStart(2, '0');
            const h = String(d.getHours()).padStart(2, '0');
            const mi = String(d.getMinutes()).padStart(2, '0');
            return `${y}-${mo}-${da}T${h}:${mi}`;
        };
        setFromTime(fmt(from));
        setToTime(fmt(now));
    }, [isOpen]);

    // Fetch + analyze with pagination
    const analyze = useCallback(async () => {
        if (!fromTime || !toTime) { setResultMsg('Select both times'); return; }
        const startEpoch = new Date(fromTime).getTime() / 1000;
        const endEpoch = new Date(toTime).getTime() / 1000;
        if (startEpoch >= endEpoch) { setResultMsg('From must be before To'); return; }
        setIsAnalyzing(true);
        setResultMsg('');
        setFetchedProgress(0);

        try {
            const pip = PIP_SIZES[symbol] ?? 2;
            const BATCH = 5000;
            const MAX_TICKS = 500000000; // 500 million
            const all: TickPoint[] = [];
            let currentEnd = Math.floor(endEpoch);
            let batchNum = 0;
            let noDataStreak = 0;

            while (all.length < MAX_TICKS && noDataStreak < 3) {
                batchNum++;
                const res: any = await sendViaNewSystemWithPromise({
                    ticks_history: symbol, style: 'ticks', count: BATCH, end: currentEnd,
                });
                const prices = res?.ticks_history?.prices || [];
                const epochs = res?.ticks_history?.epoch || [];

                if (prices.length === 0) {
                    noDataStreak++;
                    if (noDataStreak >= 3) break;
                    // Try going further back
                    currentEnd = currentEnd - BATCH;
                    continue;
                }
                noDataStreak = 0;

                for (let i = 0; i < prices.length; i++) {
                    const epoch = epochs[i] || 0;
                    if (epoch < startEpoch) continue; // Older than requested range
                    all.push({ price: Number(Number(prices[i]).toFixed(pip)), epoch });
                }

                // Update progress
                setFetchedProgress(all.length);
                setTotalFetched(all.length);

                // If oldest tick in batch is before startEpoch, we've gone far enough
                const oldestInBatch = epochs[0] || 0;
                if (oldestInBatch < startEpoch) break;

                // Next batch ends where this one started
                currentEnd = oldestInBatch - 1;

                // Small delay to avoid rate limiting
                if (batchNum % 10 === 0) {
                    await new Promise(r => setTimeout(r, 100));
                }
            }

            // Deduplicate by epoch (batches may overlap slightly)
            const seen = new Set<number>();
            const unique = all.filter(t => {
                if (seen.has(t.epoch)) return false;
                seen.add(t.epoch);
                return true;
            });

            console.log(`[FRV] Fetched ${unique.length} unique ticks in ${batchNum} batches for ${symbol}`);
            setTickCount(unique.length);

            if (unique.length < 5) {
                setBuckets([]);
                setResultMsg(`Only ${unique.length} ticks found in range. API may not have data this far back.`);
                return;
            }

            const profile = buildVolumeProfile(unique, 24);
            setBuckets(profile);

            if (profile.length > 0) {
                const poc = profile.reduce((a, b) => b.count > a.count ? b : a, profile[0]);
                setPocPrice(poc.price);
                setMinP(Math.min(...unique.map(t => t.price)));
                setMaxP(Math.max(...unique.map(t => t.price)));

                // Value Area — 70% of volume around POC
                const totalVol = profile.reduce((a, b) => a + b.count, 0);
                let volSum = poc.count;
                let vh = poc.price, vl = poc.price;
                const pi = profile.findIndex(b => b.price === poc.price);
                let u = pi + 1, d = pi - 1;
                while (volSum < totalVol * 0.7 && (u < profile.length || d >= 0)) {
                    const uv = u < profile.length ? profile[u].count : 0;
                    const dv = d >= 0 ? profile[d].count : 0;
                    if (uv >= dv) {
                        if (u < profile.length) { volSum += uv; vh = profile[u].price; u++; }
                        else if (d >= 0) { volSum += dv; vl = profile[d].price; d--; }
                        else break;
                    } else {
                        if (d >= 0) { volSum += dv; vl = profile[d].price; d--; }
                        else if (u < profile.length) { volSum += uv; vh = profile[u].price; u++; }
                        else break;
                    }
                }
                setVaHigh(vh);
                setVaLow(vl);
                setResultMsg('');
            }
        } catch (e: any) {
            setResultMsg(`Error: ${e?.error?.message ?? e?.message ?? 'fetch failed'}`);
        } finally {
            setIsAnalyzing(false);
        }
    }, [symbol, fromTime, toTime]);

    const pips = PIP_SIZES[symbol] ?? 2;

    return (
        <div className='frv-container'>
            <button className={`frv-toggle ${isOpen ? 'frv-toggle--active' : ''}`} onClick={() => setIsOpen(o => !o)}>
                📊 Fixed Range
            </button>

            {isOpen && (
                <div className='frv-panel'>
                    <div className='frv-panel-header'>
                        <span className='frv-title'>Fixed Range Volume</span>
                        <button className='frv-close' onClick={() => setIsOpen(false)}>×</button>
                    </div>

                    <div className='frv-config'>
                        <div className='frv-time-row'>
                            <div className='frv-config-row'>
                                <label>From</label>
                                <input type='datetime-local' value={fromTime} onChange={e => setFromTime(e.target.value)} />
                            </div>
                            <div className='frv-config-row'>
                                <label>To</label>
                                <input type='datetime-local' value={toTime} onChange={e => setToTime(e.target.value)} />
                            </div>
                        </div>
                        <button className='frv-analyze' onClick={analyze} disabled={isAnalyzing}>
                            {isAnalyzing ? `Fetching... ${fetchedProgress.toLocaleString()} ticks` : 'Analyze'}
                        </button>
                    </div>

                    {resultMsg && <div className='frv-msg'>{resultMsg}</div>}

                    {buckets.length > 0 && (
                        <>
                            <div className='frv-stats'>
                                <div className='frv-stat'><span className='frv-stat-label'>Ticks in range</span><span className='frv-stat-value'>{tickCount}</span></div>
                                <div className='frv-stat'><span className='frv-stat-label'>Total fetched</span><span className='frv-stat-value'>{totalFetched}</span></div>
                                <div className='frv-stat'><span className='frv-stat-label'>Range</span><span className='frv-stat-value'>{minP.toFixed(pips)} — {maxP.toFixed(pips)}</span></div>
                                <div className='frv-stat'><span className='frv-stat-label'>POC</span><span className='frv-stat-value frv-poc'>{pocPrice.toFixed(pips)}</span></div>
                                <div className='frv-stat'><span className='frv-stat-label'>Value Area</span><span className='frv-stat-value frv-poc'>{vaLow.toFixed(pips)} — {vaHigh.toFixed(pips)}</span></div>
                            </div>

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

                            <div className='frv-legend'>
                                <span className='frv-legend-item frv-legend-item--hvn'>■ High Volume (support/resistance)</span>
                                <span className='frv-legend-item frv-legend-item--lvn'>■ Low Volume</span>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default FixedRangeVolume;
