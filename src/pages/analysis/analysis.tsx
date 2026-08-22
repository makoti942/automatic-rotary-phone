import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onNewSystemMessage } from '@/auth/NewDerivAuth';
import { ALL_SYMBOLS, SYMBOL_LABELS } from '@/components/makoti-widget/makoti-ws';
import './analysis.scss';

type Market = 'even_odd' | 'rise_fall' | 'over_under';

const MARKETS: { value: Market; label: string }[] = [
    { value: 'even_odd', label: 'Even / Odd' },
    { value: 'rise_fall', label: 'Rise / Fall' },
    { value: 'over_under', label: 'Over / Under' },
];

interface Tick {
    p: number;
    t: number;
    quote: string;
}

interface Chip {
    label: string;
    cls: string;
    price: number;
    time: number;
    newest: boolean;
}

// Last digit of the spot price exactly as shown in the manual-trade tab
// (the right-most digit of the price text), NOT the integer units digit.
const lastDigitOf = (quote: string | number): number => {
    const digits = String(quote).match(/\d/g);
    if (!digits || digits.length === 0) return 0;
    return Number(digits[digits.length - 1]);
};

const STORAGE_KEY = 'analysis_settings';

const DEFAULTS = { symbol: 'R_100', market: 'even_odd' as Market, tickCount: 100, digit: 5 };

// Read on every mount (NOT once per page load): SPA tab navigation remounts
// this component, so the initializer must see the latest saved values.
const readSaved = (): Partial<typeof DEFAULTS> => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

const Analysis = () => {
    // Initialize directly from the saved settings: a mount-time save effect must
    // never run before restore, or it overwrites storage with defaults.
    const [symbol, setSymbol] = useState<string>(() => {
        const saved = readSaved();
        return saved.symbol && ALL_SYMBOLS.includes(saved.symbol) ? saved.symbol : DEFAULTS.symbol;
    });
    const [market, setMarket] = useState<Market>(() => readSaved().market ?? DEFAULTS.market);
    const [tickCount, setTickCount] = useState<number>(() => Number(readSaved().tickCount) || DEFAULTS.tickCount);
    const [digit, setDigit] = useState<number>(() => {
        const n = Number(readSaved().digit);
        return Number.isFinite(n) ? n : DEFAULTS.digit;
    });
    const [ticks, setTicks] = useState<Tick[]>([]);
    const [status, setStatus] = useState<string>('Pick a volatility and press Refresh.');
    const [live, setLive] = useState<boolean>(false);

    // Persist settings so tab-switching never resets them.
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ symbol, market, tickCount, digit }));
        } catch {}
    }, [symbol, market, tickCount, digit]);

    const cfgRef = useRef({ symbol, market, tickCount, digit });
    cfgRef.current = { symbol, market, tickCount, digit };
    const ticksRef = useRef<Tick[]>([]);
    const subIdRef = useRef<string | null>(null);
    const genRef = useRef(0);
    const histReqIdRef = useRef(0);
    const subReqIdRef = useRef(0);
    const lastLiveRef = useRef(0);
    const lastResetRef = useRef(0);
    const lastSeedAttemptRef = useRef(0);
    const seedAttemptsRef = useRef(0);

    const load = useCallback(() => {
        const ws = window._newSystemWS;
        ticksRef.current = [];
        setTicks([]);
        setLive(false);
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            setStatus('WebSocket not connected — waiting…');
            return;
        }
        // Forget only OUR previous subscription — never one borrowed from the bot.
        if (subIdRef.current) {
            try {
                ws.send(JSON.stringify({ forget: subIdRef.current }));
            } catch {}
            subIdRef.current = null;
        }
        subReqIdRef.current = 0;
        const { symbol: sym, tickCount: n } = cfgRef.current;
        setStatus(`Loading last ${n} ticks…`);
        const gen = ++genRef.current;
        histReqIdRef.current = gen;
        seedAttemptsRef.current = 0;
        lastSeedAttemptRef.current = Date.now();
        lastResetRef.current = Date.now() / 1000;
        // Plain history fetch (no subscribe) — can never collide with the bot's
        // own ticks_history subscription on the shared socket.
        ws.send(JSON.stringify({ ticks_history: sym, style: 'ticks', count: n, end: 'latest', req_id: gen }));
        // Own live subscription. If the bot already streams this symbol the
        // server answers AlreadySubscribed and we fall back to its stream.
        const subGen = ++genRef.current;
        subReqIdRef.current = subGen;
        ws.send(
            JSON.stringify({
                ticks_history: sym,
                style: 'ticks',
                count: 1,
                end: 'latest',
                subscribe: 1,
                req_id: subGen,
            })
        );
    }, []);

    const unsubscribeAll = useCallback(() => {
        if (subIdRef.current && window._newSystemWS?.readyState === WebSocket.OPEN) {
            try {
                window._newSystemWS.send(JSON.stringify({ forget: subIdRef.current }));
            } catch {}
        }
        subIdRef.current = null;
    }, []);

    useEffect(() => {
        const unsub = onNewSystemMessage((event: any) => {
            let data: any;
            try {
                data = JSON.parse(event.data);
            } catch {
                return;
            }
            const mt = data?.msg_type;

            if (data?.error) {
                // Our subscribe was rejected because the bot already streams
                // this symbol on the shared socket — share its stream instead.
                if (data.echo_req?.req_id === subReqIdRef.current) {
                    subReqIdRef.current = 0;
                    if (data.error?.code === 'AlreadySubscribed') {
                        setStatus('Live — sharing stream with bot');
                    } else {
                        setStatus(`Stream error: ${data.error?.message || data.error?.code || 'unknown'}`);
                    }
                }
                return;
            }

            if (mt === 'history') {
                // Only accept the seed from our own plain history fetch.
                if (data.echo_req?.req_id !== histReqIdRef.current) return;
                const prices = data.history?.prices;
                const times = data.history?.times;
                if (!Array.isArray(prices) || prices.length === 0) {
                    setStatus('No ticks returned for this symbol.');
                    return;
                }
                seedAttemptsRef.current = 0;
                const arr: Tick[] = prices.map((p: any, i: number) => ({
                    p: Number(p),
                    t: Array.isArray(times) ? Number(times[i]) || 0 : 0,
                    quote: String(p),
                }));
                ticksRef.current = arr;
                setTicks(arr);
                setLive(true);
                setStatus('');
            } else if (mt === 'tick') {
                const tick = data.tick;
                // Accept any tick for our symbol regardless of which
                // subscription produced it (ours or the bot's shared one).
                if (!tick || tick.symbol !== cfgRef.current.symbol) return;
                lastLiveRef.current = Date.now() / 1000;
                // Capture the subscription id ONLY for a subscription we own,
                // so we never forget the bot's stream on cleanup.
                if (data.subscription?.id && !subIdRef.current && data.echo_req?.req_id === subReqIdRef.current) {
                    subIdRef.current = data.subscription.id;
                }
                const max = cfgRef.current.tickCount;
                const arr = [
                    ...ticksRef.current.slice(-(max - 1)),
                    { p: Number(tick.quote), t: Number(tick.epoch) || Math.floor(Date.now() / 1000), quote: String(tick.quote) },
                ];
                ticksRef.current = arr;
                setTicks(arr);
                setLive(true);
            }
        });
        return () => {
            unsub();
            unsubscribeAll();
        };
    }, [unsubscribeAll]);

    // (re)subscribe when controls change
    useEffect(() => {
        const id = setTimeout(() => {
            load();
        }, 200);
        return () => clearTimeout(id);
    }, [symbol, market, tickCount, digit, load]);

    // gentle seed retry while the socket is open but no history arrived yet,
    // and a single recovery (no re-seed) if the live stream goes cold.
    useEffect(() => {
        const id = setInterval(() => {
            const ws = window._newSystemWS;
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            const now = Date.now() / 1000;
            // cold start: no data at all yet -> re-seed, but cap the attempts
            if (ticksRef.current.length === 0) {
                if (Date.now() - lastSeedAttemptRef.current > 4000 && seedAttemptsRef.current < 3) {
                    lastSeedAttemptRef.current = Date.now();
                    seedAttemptsRef.current += 1;
                    load();
                }
                return;
            }
            // Data exists but OUR live stream stalled -> re-subscribe once.
            // In passive mode (sharing the bot's stream) leave it alone.
            if (now - lastLiveRef.current > 30 && now - lastResetRef.current > 60 && subIdRef.current) {
                lastResetRef.current = now;
                try {
                    ws.send(JSON.stringify({ forget: subIdRef.current }));
                } catch {}
                subIdRef.current = null;
                const { symbol: sym } = cfgRef.current;
                const subGen = ++genRef.current;
                subReqIdRef.current = subGen;
                setStatus('Reconnecting live stream…');
                ws.send(
                    JSON.stringify({
                        ticks_history: sym,
                        style: 'ticks',
                        count: 1,
                        end: 'latest',
                        subscribe: 1,
                        req_id: subGen,
                    })
                );
            }
        }, 4000);
        return () => clearInterval(id);
    }, [load]);

    const stats = useMemo(() => {
        const n = ticks.length;
        if (n === 0) return null;
        const m = cfgRef.current.market;
        const d = cfgRef.current.digit;
        const digits = ticks.map(t => lastDigitOf(t.quote));

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

        if (m === 'even_odd') {
            const even = digits.filter(x => x % 2 === 0).length;
            const odd = n - even;
            const dominant = even >= odd ? 'EVEN' : 'ODD';
            return {
                kind: 'even_odd' as const,
                bars: [
                    { key: 'even', label: 'Even', count: even, pct: (even / n) * 100, cls: 'even' },
                    { key: 'odd', label: 'Odd', count: odd, pct: (odd / n) * 100, cls: 'odd' },
                ],
                dominant,
                dominantCount: even >= odd ? even : odd,
            };
        }
        if (m === 'rise_fall') {
            let rise = 0;
            let fall = 0;
            for (let i = 1; i < n; i++) {
                const diff = ticks[i].p - ticks[i - 1].p;
                if (diff > 0) rise++;
                else if (diff < 0) fall++;
            }
            const cmp = Math.max(n - 1, 1);
            const dominant = rise >= fall ? 'RISE' : 'FALL';
            const risePred = (i: number) => i > 0 && ticks[i].p - ticks[i - 1].p > 0;
            const fallPred = (i: number) => i > 0 && ticks[i].p - ticks[i - 1].p < 0;
            return {
                kind: 'rise_fall' as const,
                bars: [
                    { key: 'rise', label: 'Rise', count: rise, pct: (rise / cmp) * 100, cls: 'rise' },
                    { key: 'fall', label: 'Fall', count: fall, pct: (fall / cmp) * 100, cls: 'fall' },
                ],
                dominant,
                dominantCount: rise >= fall ? rise : fall,
                longestRise: longestRun(risePred),
                longestFall: longestRun(fallPred),
            };
        }
        const under = digits.filter(x => x < d).length;
        const over = digits.filter(x => x > d).length;
        const eq = n - under - over;
        const dominant = under >= over ? 'UNDER' : 'OVER';
        return {
            kind: 'over_under' as const,
            bars: [
                { key: 'under', label: `Under ${d}`, count: under, pct: (under / n) * 100, cls: 'under' },
                { key: 'over', label: `Over ${d}`, count: over, pct: (over / n) * 100, cls: 'over' },
                { key: 'equal', label: `Equal ${d}`, count: eq, pct: (eq / n) * 100, cls: 'flat' },
            ],
            dominant,
            dominantCount: under >= over ? under : over,
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
            const dig = lastDigitOf(t.quote);
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

    const fmtTime = (t: number) => (!t ? '' : new Date(t * 1000).toLocaleTimeString());
    const symbolLabel = SYMBOL_LABELS[symbol] || symbol;

    return (
        <div className='analysis'>
            <div className={`analysis__controls has-market-${cfgRef.current.market.replace('_', '-')} `}>
                <div className='analysis__field'>
                    <label htmlFor='an-symbol'>Volatility</label>
                    <select id='an-symbol' value={symbol} onChange={e => setSymbol(e.target.value)}>
                        {ALL_SYMBOLS.map(s => (
                            <option key={s} value={s}>
                                {SYMBOL_LABELS[s] || s}
                            </option>
                        ))}
                    </select>
                </div>
                <div className='analysis__field'>
                    <label htmlFor='an-market'>Market</label>
                    <select id='an-market' value={market} onChange={e => setMarket(e.target.value as Market)}>
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
                        onChange={e => setTickCount(Math.max(20, Math.min(5000, Number(e.target.value) || 100)))}
                    />
                </div>
                {market === 'over_under' && (
                    <div className='analysis__field'>
                        <label htmlFor='an-digit'>Target digit</label>
                        <select id='an-digit' value={digit} onChange={e => setDigit(Number(e.target.value))}>
                            {Array.from({ length: 10 }, (_, i) => (
                                <option key={i} value={i}>
                                    {i}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
                <div className='analysis__actions'>
                    <button type='button' className='analysis__refresh' onClick={load}>
                        Refresh
                    </button>
                    <div className={`analysis__status ${live ? 'is-ok' : 'is-wait'}`}>
                        <span className='analysis__dot' />
                        <span className='analysis__status-text'>{live ? `Live — ${symbolLabel}` : status}</span>
                    </div>
                </div>
            </div>

            <div className='analysis__body'>
                <section className={`analysis__card analysis__histogram has-market-${market.replace('_', '-')}`}>
                    <header className='analysis__card-head'>
                        <div>
                            <h3>{MARKETS.find(m => m.value === market)?.label} histogram</h3>
                            <span className='analysis__subtitle'>{symbolLabel}</span>
                        </div>
                        {stats && (
                            <span className='analysis__dominant'>
                                Dominant: <strong>{stats.dominant}</strong> ({stats.dominantCount})
                            </span>
                        )}
                    </header>
                    {stats ? (
                        <div className='analysis__bars'>
                            {stats.bars.map(b => (
                                <div key={b.key} className='analysis__bar-row'>
                                    <div className='analysis__bar-meta'>
                                        <span className={`analysis__bar-label ${b.cls}`}>{b.label}</span>
                                        <span className='analysis__bar-count'>
                                            {b.count} {b.count === 1 ? 'tick' : 'ticks'}
                                        </span>
                                    </div>
                                    <div className='analysis__bar-track'>
                                        <div
                                            className={`analysis__bar-fill ${b.cls}`}
                                            style={{ width: `${Math.max(4, b.pct)}%` }}
                                        />
                                    </div>
                                    <span className='analysis__bar-pct'>{b.pct.toFixed(1)}%</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className='analysis__empty'>Press Refresh to load ticks.</div>
                    )}
                </section>

                <section className={`analysis__card analysis__ticks has-market-${market.replace('_', '-')}`}>
                    <header className='analysis__card-head'>
                        <div>
                            <h3>Last 20 ticks</h3>
                            <span className='analysis__subtitle'>
                                {market === 'even_odd' && 'E = even, O = odd'}
                                {market === 'rise_fall' && 'R = rise, F = fall, = = unchanged'}
                                {market === 'over_under' && `U = under ${digit}, O = over ${digit}, = = equal`}
                            </span>
                        </div>
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
                    {stats?.kind === 'rise_fall' && (
                        <div className='analysis__streaks'>
                            <span>Longest rise run: {stats.longestRise}</span>
                            <span>Longest fall run: {stats.longestFall}</span>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
};

export default Analysis;
