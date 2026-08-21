import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onNewSystemMessage } from '@/auth/NewDerivAuth';
import { ALL_SYMBOLS, SYMBOL_LABELS } from '@/components/makoti-widget/makoti-ws';
import './analysis.scss';

type Market = 'even_odd' | 'rise_fall' | 'over_under';

type SavedSettings = {
    symbol: string;
    market: Market;
    tickCount: number;
    digit: number;
};

const MARKETS: { value: Market; label: string }[] = [
    { value: 'even_odd', label: 'Even / Odd' },
    { value: 'rise_fall', label: 'Rise / Fall' },
    { value: 'over_under', label: 'Over / Under' },
];

const MARKET_THEME: Record<Market, string> = {
    even_odd: 'even-odd',
    rise_fall: 'rise-fall',
    over_under: 'over-under',
};

const STORAGE_KEY = 'analysis_settings';
const DEFAULTS: SavedSettings = { symbol: 'R_100', market: 'even_odd', tickCount: 100, digit: 5 };

const digitOf = (p: number) => Math.floor(p) % 10;

const usePersistentState = <T extends SavedSettings>(key: string, initial: T) => {
    const [state, setState] = useState<T>(() => {
        try {
            const raw = localStorage.getItem(key);
            const parsed = raw ? (JSON.parse(raw) as Partial<T>) : null;
            return { ...initial, ...parsed };
        } catch {
            return initial;
        }
    });
    useEffect(() => {
        try {
            localStorage.setItem(key, JSON.stringify(state));
        } catch {
            // ignore storage errors
        }
    }, [key, state]);
    useEffect(() => {
        const handler = (e: StorageEvent) => {
            if (e.key !== key || !e.newValue) return;
            try {
                setState(prev => ({ ...prev, ...JSON.parse(e.newValue as string) }));
            } catch {
                // ignore
            }
        };
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
    }, [key]);
    return [state, setState] as const;
};

const Analysis = () => {
    const [settings, setSettings] = usePersistentState<SavedSettings>(STORAGE_KEY, DEFAULTS);
    const { symbol, market, tickCount, digit } = settings;

    const [ticks, setTicks] = useState<{ p: number; t: number }[]>([]);
    const [status, setStatus] = useState<string>('Waiting for connection…');
    const [live, setLive] = useState<boolean>(false);

    const cfgRef = useRef({ symbol, market, tickCount, digit });
    cfgRef.current = { symbol, market, tickCount, digit };
    const ticksRef = useRef<typeof ticks>([]);
    const subIdRef = useRef<string | null>(null);
    const genRef = useRef(0);
    const lastLiveRef = useRef(0);
    const lastResubRef = useRef(0);
    const unsubRef = useRef<(() => void) | null>(null);
    const rateLimitedUntilRef = useRef(0);

    const handleSymbol = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setSettings(s => ({ ...s, symbol: e.target.value }));
    };
    const handleMarket = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setSettings(s => ({ ...s, market: e.target.value as Market }));
    };
    const handleTickCount = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = Math.max(20, Math.min(5000, Number(e.target.value) || 100));
        setSettings(s => ({ ...s, tickCount: v }));
    };
    const handleDigit = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setSettings(s => ({ ...s, digit: Number(e.target.value) }));
    };

    const refresh = useCallback(() => {
        genRef.current += 1;
        setTicks([]);
        setLive(false);
        ticksRef.current = [];
        setStatus('Refreshing…');
    }, []);

    const subscribeLive = useCallback(() => {
        const ws = window._newSystemWS;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            setStatus('WebSocket not connected — waiting…');
            return false;
        }
        const { symbol: sym } = cfgRef.current;
        const n = cfgRef.current.tickCount;
        const gen = genRef.current;
        setStatus(`Loading last ${n} ticks…`);
        ws.send(JSON.stringify({ ticks_history: sym, style: 'ticks', count: n, end: 'latest', req_id: gen }));
        ws.send(JSON.stringify({ ticks: sym, subscribe: 1, req_id: gen }));
        return true;
    }, []);

    // Wire socket messages
    useEffect(() => {
        const unsub = onNewSystemMessage((event: any) => {
            let data: any;
            try {
                data = JSON.parse(event.data);
            } catch {
                return;
            }
            const mt = data?.msg_type;
            const reqSym = cfgRef.current.symbol;
            const gen = genRef.current;
            if (data?.error) {
                const msg = `${data.error.message || ''} ${data.error.code || ''}`;
                if (/rate limit/i.test(msg)) {
                    rateLimitedUntilRef.current = Date.now() / 1000 + 30;
                    setStatus('Rate limited — pausing briefly');
                }
                return;
            }
            if (mt === 'history') {
                if (data.echo_req?.ticks_history !== reqSym) return;
                if (data.echo_req?.req_id !== undefined && data.echo_req.req_id !== gen) return;
                const prices = data.history?.prices;
                if (!Array.isArray(prices) || !prices.length) {
                    setStatus('No ticks returned');
                    return;
                }
                const times = data.history?.times;
                const arr = prices.map((p: any, i: number) => ({
                    p: Number(p),
                    t: Array.isArray(times) ? Number(times[i]) || 0 : 0,
                }));
                ticksRef.current = arr;
                setTicks(arr);
                if (!live) setLive(true);
            } else if (mt === 'tick') {
                const tick = data.tick;
                if (!tick || tick.symbol !== reqSym) return;
                if (data.echo_req?.req_id !== undefined && data.echo_req?.req_id !== gen) return;
                lastLiveRef.current = Date.now() / 1000;
                if (data.subscription?.id && !subIdRef.current) {
                    subIdRef.current = data.subscription.id;
                }
                const max = cfgRef.current.tickCount;
                const arr = [
                    ...ticksRef.current.slice(-(max - 1)),
                    { p: Number(tick.quote), t: Number(tick.epoch) || Math.floor(Date.now() / 1000) },
                ];
                ticksRef.current = arr;
                setTicks(arr);
                if (status === '' || status === '' ) setLive(true);
            }
        });
        unsubRef.current = unsub;

        // Load on mount / gen change
        const timer = setTimeout(() => subscribeLive(), 0);
        // Tick-health watchdog: resubscribe if ticks stall
        const watchdog = setInterval(() => {
            if (!window._newSystemWS || window._newSystemWS.readyState !== WebSocket.OPEN) return;
            if (Date.now() / 1000 < rateLimitedUntilRef.current) return;
            const idle = Date.now() / 1000 - lastLiveRef.current;
            // resubscribe only if we already have some data and ticks went cold
            if (ticksRef.current.length > 0 && idle > 15 && Date.now() / 1000 - lastResubRef.current > 20) {
                lastResubRef.current = Date.now() / 1000;
                if (subIdRef.current) {
                    window._newSystemWS.send(JSON.stringify({ forget: subIdRef.current }));
                    subIdRef.current = null;
                }
                setTicks([]);
                ticksRef.current = [];
                setLive(false);
                setStatus('Ticks stalled — re-subscribing…');
                subscribeLive();
            }
        }, 4000);
        return () => {
            clearTimeout(timer);
            clearInterval(watchdog);
            unsub();
            if (subIdRef.current && window._newSystemWS?.readyState === WebSocket.OPEN) {
                try {
                    window._newSystemWS.send(JSON.stringify({ forget: subIdRef.current }));
                } catch {
                    // ignore
                }
            }
            subIdRef.current = null;
        };
    }, [subscribeLive]);

    // Re-subscribe when controls change
    useEffect(() => {
        genRef.current += 1;
        setTicks([]);
        ticksRef.current = [];
        setLive(false);
        subIdRef.current = null;
        const id = setTimeout(() => subscribeLive(), 150);
        return () => clearTimeout(id);
    }, [symbol, market, tickCount, digit, subscribeLive]);

    const stats = useMemo(() => {
        const n = ticks.length;
        if (n === 0) return null;
        const m = cfgRef.current.market;
        const d = cfgRef.current.digit;
        const digits = ticks.map(t => digitOf(t.p));

        const longestRun = (pred: (i: number) => boolean) => {
            let best = 0;
            let cur = 0;
            for (let i = 0; i < n; i++) {
                if (pred(i)) {
                    cur++;
                    best = Math.max(best, cur);
                } else cur = 0;
            }
            return best;
        };
        const currentRun = (pred: (i: number) => boolean) => {
            let run = 0;
            for (let i = n - 1; i >= 0 && pred(i); i--) run++;
            return run;
        };
        const base = {
            total: n,
            last: ticks[n - 1].p,
            first: ticks[0].p,
            change: ticks[n - 1].p - ticks[0].p,
        };

        if (m === 'even_odd') {
            const even = digits.filter(x => x % 2 === 0).length;
            const odd = n - even;
            const dominant = even >= odd ? 'EVEN' : 'ODD';
            const evenPred = (i: number) => digits[i] % 2 === 0;
            const lastEven = digits[n - 1] % 2 === 0;
            const current = lastEven ? currentRun(evenPred) : currentRun((i: number) => digits[i] % 2 !== 0);
            return {
                ...base,
                kind: 'even_odd' as const,
                counts: { even, odd },
                pcts: { even: (even / n) * 100, odd: (odd / n) * 100 },
                dominant,
                longest: longestRun(evenPred),
                current,
            };
        }

        if (m === 'rise_fall') {
            let rise = 0;
            let fall = 0;
            let flat = 0;
            for (let i = 1; i < n; i++) {
                const diff = ticks[i].p - ticks[i - 1].p;
                if (diff > 0) rise++;
                else if (diff < 0) fall++;
                else flat++;
            }
            const cmp = n - 1;
            const dominant = rise >= fall ? 'RISE' : 'FALL';
            const risePred = (i: number) => i > 0 && ticks[i].p - ticks[i - 1].p > 0;
            const fallPred = (i: number) => i > 0 && ticks[i].p - ticks[i - 1].p < 0;
            const longestRise = longestRun(risePred);
            const longestFall = longestRun(fallPred);
            const current = dominant === 'RISE' ? currentRun(risePred) : currentRun(fallPred);
            return {
                ...base,
                kind: 'rise_fall' as const,
                counts: { rise, fall, flat },
                pcts: { rise: (rise / cmp) * 100, fall: (fall / cmp) * 100 },
                cmp,
                dominant,
                longest: dominant === 'RISE' ? longestRise : longestFall,
                current,
                longestRise,
                longestFall,
            };
        }

        const under = digits.filter(x => x < d).length;
        const over = digits.filter(x => x > d).length;
        const eq = n - under - over;
        const dominant = under >= over ? 'UNDER' : 'OVER';
        const underPred = (i: number) => digits[i] < d;
        const overPred = (i: number) => digits[i] > d;
        const longestUnder = longestRun(underPred);
        const longestOver = longestRun(overPred);
        const curUnder = currentRun(underPred);
        const curOver = currentRun(overPred);
        return {
            ...base,
            kind: 'over_under' as const,
            counts: { under, over, eq },
            pcts: { under: (under / n) * 100, over: (over / n) * 100 },
            dominant,
            longest: dominant === 'UNDER' ? longestUnder : longestOver,
            current: dominant === 'UNDER' ? curUnder : curOver,
            longestUnder,
            longestOver,
            target: d,
        };
    }, [ticks]);

    const chips = useMemo<Chip[]>(() => {
        const n = ticks.length;
        if (n === 0) return [];
        const start = Math.max(0, n - 20);
        const m = cfgRef.current.market;
        const d = cfgRef.current.digit;
        const out: Chip[] = [];
        for (let i = start; i < n; i++) {
            const t = ticks[i];
            const dig = digitOf(t.p);
            let label = '—';
            let cls = 'flat';
            if (m === 'even_odd') {
                label = dig % 2 === 0 ? 'E' : 'O';
                cls = dig % 2 === 0 ? 'even' : 'odd';
            } else if (m === 'over_under') {
                label = dig < d ? 'U' : dig > d ? 'O' : '=';
                cls = dig < d ? 'under' : dig > d ? 'over' : 'flat';
            } else {
                const prev = ticks[i - 1];
                if (prev) {
                    const diff = t.p - prev.p;
                    if (diff > 0) {
                        label = 'R';
                        cls = 'rise';
                    } else if (diff < 0) {
                        label = 'F';
                        cls = 'fall';
                    } else {
                        label = '=';
                        cls = 'flat';
                    }
                }
            }
            out.push({ label, cls, price: t.p, time: t.t, newest: i === n - 1 });
        }
        return out;
    }, [ticks]);

    const distribution = useMemo(() => {
        if (cfgRef.current.market === 'rise_fall') return null;
        const counts = Array(10).fill(0);
        ticks.forEach(t => {
            counts[digitOf(t.p)]++;
        });
        const max = Math.max(...counts, 1);
        const total = ticks.length || 1;
        return counts.map((c, i) => ({ digit: i, count: c, pct: (c / total) * 100, barPct: (c / max) * 100 }));
    }, [ticks]);

    const fmtTime = (t: number) => {
        if (!t) return '';
        return new Date(t * 1000).toLocaleTimeString();
    };

    const theme = MARKET_THEME[market];

    const statusText = live ? (ticks.length ? `Live — ${ticks.length} ticks analyzed` : 'Live — receiving ticks…') : status || 'Stopped';

    return (
        <div className='analysis'>
            <div className='analysis__controls'>
                <div className='analysis__field'>
                    <label htmlFor='an-symbol'>Volatility</label>
                    <select id='an-symbol' value={symbol} onChange={handleSymbol}>
                        {ALL_SYMBOLS.map(s => (
                            <option key={s} value={s}>
                                {SYMBOL_LABELS[s] || s}
                            </option>
                        ))}
                    </select>
                </div>
                <div className='analysis__field'>
                    <label htmlFor='an-market'>Market</label>
                    <select id='an-market' value={market} onChange={handleMarket}>
                        {MARKETS.map(m => (
                            <option key={m.value} value={m.value}>
                                {m.label}
                            </option>
                        ))}
                    </select>
                </div>
                <div className='analysis__field'>
                    <label htmlFor='an-count'>Ticks to analyse</label>
                    <input
                        id='an-count'
                        type='number'
                        min={20}
                        max={5000}
                        step={10}
                        value={tickCount}
                        onChange={handleTickCount}
                    />
                </div>
                {market === 'over_under' && (
                    <div className='analysis__field'>
                        <label htmlFor='an-digit'>Target digit</label>
                        <select id='an-digit' value={digit} onChange={handleDigit}>
                            {Array.from({ length: 10 }, (_, i) => (
                                <option key={i} value={i}>
                                    Digit {i}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
                <div className='analysis__actions'>
                    <button type='button' className={`analysis__refresh has-market-${theme}`} onClick={refresh}>
                        Refresh
                    </button>
                    <div className='analysis__status' title={statusText}>
                        <span className={`analysis__dot ${live ? 'is-ok' : 'is-wait'}`} />
                        <span className='analysis__status-text'>{statusText}</span>
                    </div>
                </div>
            </div>

            <div className={`analysis__body has-market-${theme}`}>
                <section className='analysis__card analysis__histogram'>
                    <header className='analysis__card-head'>
                        <h3>{MARKETS.find(m => m.value === market)?.label} histogram</h3>
                        {stats && (
                            <span className='analysis__dominant'>
                                Dominant: <strong>{stats.dominant}</strong>
                            </span>
                        )}
                    </header>
                    {stats ? (
                        <div className='analysis__bars'>
                            {barsFor(stats).map(b => (
                                <div key={b.key} className='analysis__bar-row'>
                                    <div className='analysis__bar-meta'>
                                        <span className={`analysis__bar-label ${b.cls}`}>{b.label}</span>
                                        <span className='analysis__bar-count'>
                                            {b.count} {b.count === 1 ? 'tick' : 'ticks'}
                                        </span>
                                    </div>
                                    <div className='analysis__bar-track'>
                                        <div className={`analysis__bar-fill ${b.cls}`} style={{ width: `${Math.max(2, b.pct)}%` }} />
                                    </div>
                                    <span className='analysis__bar-pct'>{b.pct.toFixed(1)}%</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className='analysis__empty'>Choose a volatility and press Refresh to begin</div>
                    )}
                </section>

                <section className='analysis__card analysis__stats'>
                    <header className='analysis__card-head'>
                        <h3>Live stats</h3>
                    </header>
                    {stats ? (
                        <div className='analysis__stat-grid'>
                            <StatRow label='Last price' value={stats.last.toFixed(2)} />
                            <StatRow label='Range' value={`${stats.change >= 0 ? '+' : ''}${stats.change.toFixed(2)}`} />
                            <StatRow label='Ticks analysed' value={String(stats.total)} />
                            <StatRow label='Dominant' value={stats.dominant} highlight />
                            <StatRow label='Current streak' value={String(stats.current)} />
                            <StatRow label='Longest streak' value={String(stats.longest)} />
                            {stats.kind === 'rise_fall' && (
                                <>
                                    <StatRow label='Longest rise run' value={String(stats.longestRise)} />
                                    <StatRow label='Longest fall run' value={String(stats.longestFall)} />
                                    <StatRow label='Flat ticks' value={String(stats.counts.flat)} />
                                </>
                            )}
                            {stats.kind === 'over_under' && (
                                <>
                                    <StatRow label={`Equal to ${stats.target}`} value={String(stats.counts.eq)} />
                                    <StatRow label={`Longest under/over`} value={`${stats.longestUnder} / ${stats.longestOver}`} />
                                </>
                            )}
                        </div>
                    ) : (
                        <div className='analysis__empty'>Waiting for data…</div>
                    )}
                </section>

                {distribution && (
                    <section className={`analysis__card analysis__distribution has-market-${theme}`}>
                        <header className='analysis__card-head'>
                            <h3>Digit distribution 0–9</h3>
                            <span className='analysis__hint'>last digit of price</span>
                        </header>
                        <div className='analysis__dist-bars'>
                            {distribution.map(dd => (
                                <div
                                    key={dd.digit}
                                    className='analysis__dist-col'
                                    title={`${dd.count} ticks (${dd.pct.toFixed(1)}%)`}
                                >
                                    <span className='analysis__dist-count'>{dd.count}</span>
                                    <div className='analysis__dist-track'>
                                        <div className='analysis__dist-fill' style={{ height: `${Math.max(4, dd.barPct)}%` }} />
                                    </div>
                                    <span className='analysis__dist-digit'>{dd.digit}</span>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>

            <section className='analysis__card analysis__ticks'>
                <header className='analysis__card-head'>
                    <h3>Last 20 ticks</h3>
                    <span className='analysis__hint'>
                        {market === 'even_odd' && 'E = even digit, O = odd digit'}
                        {market === 'rise_fall' && 'R = rise, F = fall, = = unchanged'}
                        {market === 'over_under' && `U = under ${digit}, O = over ${digit}, = = equal`}
                    </span>
                </header>
                <div className='analysis__chips'>
                    {chips.length > 0 ? (
                        chips.map((c, i) => (
                            <div
                                key={i}
                                className={`analysis__chip ${c.cls}${c.newest ? ' is-newest' : ''}`}
                                title={`${c.price.toFixed(2)} @ ${fmtTime(c.time)}`}
                            >
                                {c.label}
                            </div>
                        ))
                    ) : (
                        <div className='analysis__empty'>Waiting for ticks…</div>
                    )}
                </div>
            </section>
        </div>
    );
};

interface Chip {
    label: string;
    cls: string;
    price: number;
    time: number;
    newest: boolean;
}

const StatRow = ({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) => (
    <div className={`analysis__stat ${highlight ? 'is-highlight' : ''}`}>
        <span className='analysis__stat-label'>{label}</span>
        <span className='analysis__stat-value'>{value}</span>
    </div>
);

function barsFor(stats: any) {
    if (stats.kind === 'even_odd') {
        return [
            { key: 'even', label: 'Even', count: stats.counts.even, pct: stats.pcts.even, cls: 'even' },
            { key: 'odd', label: 'Odd', count: stats.counts.odd, pct: stats.pcts.odd, cls: 'odd' },
        ];
    }
    if (stats.kind === 'rise_fall') {
        return [
            { key: 'rise', label: 'Rise', count: stats.counts.rise, pct: stats.pcts.rise, cls: 'rise' },
            { key: 'fall', label: 'Fall', count: stats.counts.fall, pct: stats.pcts.fall, cls: 'fall' },
        ];
    }
    return [
        { key: 'under', label: `Under ${stats.target}`, count: stats.counts.under, pct: stats.pcts.under, cls: 'under' },
        { key: 'over', label: `Over ${stats.target}`, count: stats.counts.over, pct: stats.pcts.over, cls: 'over' },
    ];
}

export default Analysis;
