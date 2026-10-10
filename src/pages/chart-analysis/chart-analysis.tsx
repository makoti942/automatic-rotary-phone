import React, { PointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import { onNewSystemMessage, sendViaNewSystemWithPromise } from '@/auth/NewDerivAuth';
import { PIP_SIZES } from '@/components/makoti-widget/makoti-ws';
import { useStore } from '@/hooks/useStore';
import ChartWrapper from '../chart/chart-wrapper';
import './chart-analysis.scss';

type TickPoint = { price: number; epoch: number };
type Bucket = { price: number; count: number; pct: number; inValueArea: boolean };
type Profile = { id: number; startRatio: number; endRatio: number; startEpoch: number; endEpoch: number; buckets: Bucket[]; poc: number; vah: number; val: number; total: number; };

const cache = new Map<string, TickPoint[]>();
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const decimals = (symbol: string) => PIP_SIZES[symbol] ?? 2;

function calculateProfile(ticks: TickPoint[], startRatio: number, endRatio: number, bucketCount = 32): Profile | null {
    const left = Math.min(startRatio, endRatio);
    const right = Math.max(startRatio, endRatio);
    if (ticks.length < 2) return null;
    const startIndex = Math.max(0, Math.floor(left * (ticks.length - 1)));
    const endIndex = Math.min(ticks.length - 1, Math.ceil(right * (ticks.length - 1)));
    const selected = ticks.slice(startIndex, endIndex + 1);
    if (selected.length < 2) return null;
    const prices = selected.map(t => t.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const step = max === min ? 1 : (max - min) / bucketCount;
    const buckets = Array.from({ length: bucketCount }, (_, index) => {
        const low = min + index * step;
        const high = index === bucketCount - 1 ? max + Number.EPSILON : low + step;
        const count = selected.filter(t => t.price >= low && t.price < high).length;
        return { price: max === min ? min : low + step / 2, count, pct: 0, inValueArea: false };
    });
    const maxCount = Math.max(...buckets.map(b => b.count), 1);
    buckets.forEach(bucket => { bucket.pct = (bucket.count / maxCount) * 100; });
    const pocIndex = buckets.reduce((best, bucket, index) => bucket.count > buckets[best].count ? index : best, 0);
    const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
    let included = buckets[pocIndex].count;
    buckets[pocIndex].inValueArea = true;
    let lowIndex = pocIndex - 1;
    let highIndex = pocIndex + 1;
    while (included < total * 0.7 && (lowIndex >= 0 || highIndex < buckets.length)) {
        const lowCount = lowIndex >= 0 ? buckets[lowIndex].count : -1;
        const highCount = highIndex < buckets.length ? buckets[highIndex].count : -1;
        if (highCount >= lowCount) {
            if (highIndex < buckets.length) { included += highCount; buckets[highIndex].inValueArea = true; highIndex++; }
            else lowIndex--;
        } else {
            if (lowIndex >= 0) { included += lowCount; buckets[lowIndex].inValueArea = true; lowIndex--; }
            else highIndex++;
        }
    }
    const areaBuckets = buckets.filter(bucket => bucket.inValueArea);
    return {
        id: Date.now() + Math.random(), startRatio: left, endRatio: right,
        startEpoch: selected[0].epoch, endEpoch: selected[selected.length - 1].epoch,
        buckets, poc: buckets[pocIndex].price,
        vah: Math.max(...areaBuckets.map(bucket => bucket.price)),
        val: Math.min(...areaBuckets.map(bucket => bucket.price)), total,
    };
}

const ChartAnalysis: React.FC = () => {
    const { chart_store } = useStore();
    const symbol = chart_store.symbol || 'R_100';
    const pip = decimals(symbol);
    const surfaceRef = useRef<HTMLDivElement>(null);
    const [ticks, setTicks] = useState<TickPoint[]>(() => cache.get(symbol) || []);
    const ticksRef = useRef(ticks);
    ticksRef.current = ticks;
    const [toolActive, setToolActive] = useState(false);
    const [dragStart, setDragStart] = useState<number | null>(null);
    const [dragEnd, setDragEnd] = useState<number | null>(null);
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('Select Fixed Range Tick Profile, then drag across the chart.');

    const loadTicks = useCallback(async () => {
        if (cache.has(symbol) && (cache.get(symbol)?.length || 0) >= 1000) {
            setTicks(cache.get(symbol)!);
            return;
        }
        setLoading(true);
        try {
            const response: any = await sendViaNewSystemWithPromise({ ticks_history: symbol, style: 'ticks', count: 5000, end: 'latest' });
            const prices = response?.ticks_history?.prices || [];
            const epochs = response?.ticks_history?.epoch || [];
            const next = prices.map((price: number, index: number) => ({ price: Number(Number(price).toFixed(pip)), epoch: Number(epochs[index]) })).filter((tick: TickPoint) => Number.isFinite(tick.epoch));
            cache.set(symbol, next);
            setTicks(next);
            setMessage(next.length ? 'Ready. Select a range on the chart.' : 'Historical tick data unavailable for this range.');
        } catch {
            setMessage('Historical tick data unavailable for this range.');
        } finally {
            setLoading(false);
        }
    }, [pip, symbol]);

    useEffect(() => {
        setTicks(cache.get(symbol) || []);
        setProfiles([]);
        loadTicks();
        return onNewSystemMessage((event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.tick?.symbol !== symbol) return;
                const nextTick = { price: Number(Number(data.tick.quote).toFixed(pip)), epoch: Number(data.tick.epoch || Date.now() / 1000) };
                const next = [...ticksRef.current.filter(tick => tick.epoch !== nextTick.epoch), nextTick].sort((a, b) => a.epoch - b.epoch).slice(-5000);
                cache.set(symbol, next);
                setTicks(next);
                setProfiles(current => current.map(profile => profile.endEpoch >= (next.at(-2)?.epoch || 0) ? calculateProfile(next, profile.startRatio, profile.endRatio) || profile : profile));
            } catch {}
        });
    }, [loadTicks, pip, symbol]);

    const ratioFromEvent = (event: PointerEvent) => {
        const rect = surfaceRef.current?.getBoundingClientRect();
        return rect ? clamp((event.clientX - rect.left) / rect.width) : 0;
    };
    const onPointerDown = (event: PointerEvent) => {
        if (!toolActive) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const ratio = ratioFromEvent(event);
        setDragStart(ratio);
        setDragEnd(ratio);
    };
    const onPointerMove = (event: PointerEvent) => {
        if (toolActive && dragStart !== null) setDragEnd(ratioFromEvent(event));
    };
    const onPointerUp = () => {
        if (!toolActive || dragStart === null || dragEnd === null) return;
        const profile = calculateProfile(ticksRef.current, dragStart, dragEnd);
        if (profile) {
            setProfiles(current => [...current, profile]);
            setMessage(`Profile calculated from ${profile.total.toLocaleString()} Deriv ticks.`);
            setToolActive(false);
        } else setMessage('Select a wider range with available tick data.');
        setDragStart(null);
        setDragEnd(null);
    };
    const removeProfile = (id: number) => setProfiles(current => current.filter(profile => profile.id !== id));
    const activeRange = dragStart !== null && dragEnd !== null ? [Math.min(dragStart, dragEnd), Math.max(dragStart, dragEnd)] as const : null;

    return (
        <div className='chart-analysis'>
            <div className='chart-analysis__toolbar'>
                <div className='chart-analysis__title'><strong>Chart Analysis</strong><span>Fixed Range Tick Profile</span></div>
                <div className='chart-analysis__actions'>
                    <button className={`chart-analysis__tool ${toolActive ? 'is-active' : ''}`} onClick={() => { setToolActive(value => !value); setMessage('Drag across the chart to select a tick range.'); }}>
                        <span>⌁</span> Fixed Range Profile
                    </button>
                    <button className='chart-analysis__clear' onClick={() => setProfiles([])} disabled={!profiles.length}>Clear</button>
                </div>
            </div>
            <div className='chart-analysis__chart-shell'>
                <ChartWrapper show_digits_stats={false} />
                <div
                    ref={surfaceRef}
                    className={`chart-analysis__overlay ${toolActive ? 'is-selecting' : ''}`}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                >
                    {activeRange && <div className='chart-analysis__selection' style={{ left: `${activeRange[0] * 100}%`, width: `${(activeRange[1] - activeRange[0]) * 100}%` }} />}
                    {profiles.map(profile => {
                        const maxPrice = Math.max(...profile.buckets.map(bucket => bucket.price));
                        const minPrice = Math.min(...profile.buckets.map(bucket => bucket.price));
                        const span = maxPrice - minPrice || 1;
                        return (
                            <div className='chart-analysis__profile' key={profile.id}>
                                <div className='chart-analysis__range' style={{ left: `${profile.startRatio * 100}%`, width: `${(profile.endRatio - profile.startRatio) * 100}%` }} />
                                {profile.buckets.map((bucket, index) => {
                                    const top = `${((maxPrice - bucket.price) / span) * 88 + 6}%`;
                                    return <div key={index} className={`chart-analysis__bar ${bucket.inValueArea ? 'is-value-area' : ''}`} style={{ top, left: `${profile.endRatio * 100}%`, width: `${Math.max(10, bucket.pct * 0.42)}%` }} />;
                                })}
                                <div className='chart-analysis__level chart-analysis__level--poc' style={{ top: `${((maxPrice - profile.poc) / span) * 88 + 6}%`, left: `${profile.startRatio * 100}%`, width: `${(profile.endRatio - profile.startRatio) * 100}%` }}><b>POC {profile.poc.toFixed(pip)}</b></div>
                                <div className='chart-analysis__level chart-analysis__level--vah' style={{ top: `${((maxPrice - profile.vah) / span) * 88 + 6}%`, left: `${profile.startRatio * 100}%`, width: `${(profile.endRatio - profile.startRatio) * 100}%` }}><b>VAH {profile.vah.toFixed(pip)}</b></div>
                                <div className='chart-analysis__level chart-analysis__level--val' style={{ top: `${((maxPrice - profile.val) / span) * 88 + 6}%`, left: `${profile.startRatio * 100}%`, width: `${(profile.endRatio - profile.startRatio) * 100}%` }}><b>VAL {profile.val.toFixed(pip)}</b></div>
                                <button className='chart-analysis__delete' onClick={() => removeProfile(profile.id)} aria-label='Delete profile'>×</button>
                            </div>
                        );
                    })}
                    {loading && <div className='chart-analysis__loading'>Loading Deriv tick history…</div>}
                </div>
            </div>
            <div className='chart-analysis__status'>{message}<span>Profile calculated from Deriv tick frequency, not exchange volume.</span></div>
        </div>
    );
};

export default ChartAnalysis;
