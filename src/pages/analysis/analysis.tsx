import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onNewSystemMessage } from '@/auth/NewDerivAuth';
import { ALL_SYMBOLS, SYMBOL_LABELS } from '@/components/makoti-widget/makoti-ws';
import './analysis.scss';

type Market = 'even_odd' | 'rise_fall' | 'over_under';

interface Tick {
    p: number;
    t: number;
}

interface Chip {
    label: string;
    cls: string;
    price: number;
    time: number;
    newest: boolean;
}

const MARKETS: { value: Market; label: string }[] = [
    { value: 'even_odd', label: 'Even / Odd' },
    { value: 'rise_fall', label: 'Rise / Fall' },
    { value: 'over_under', label: 'Over / Under' },
];

const digitOf = (p: number) => Math.floor(p) % 10;

const Analysis = () => {
    const [symbol, setSymbol] = useState<string>('R_100');
    const [market, setMarket] = useState<Market>('even_odd');
    const [tickCount, setTickCount] = useState<number>(100);
    const [digit, setDigit] = useState<number>(5);
    const [ticks, setTicks] = useState<Tick[]>([]);
    const [status, setStatus] = useState<string>('Waiting for connection…');
    const [statusOk, setStatusOk] = useState<boolean>(false);
    const [lastUpdate, setLastUpdate] = useState<number | null>(null);

    const cfgRef = useRef({ symbol, market, tickCount, digit });
    cfgRef.current = { symbol, market, tickCount, digit };
    const ticksRef = useRef<Tick[]>([]);
    const subIdRef = useRef<string | null>(null);
    const genRef = useRef(0);
    const lastLoadRef = useRef(0);
    const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const load = useCallback(() => {
        const gen = ++genRef.current;
        lastLoadRef.current = Date.now();
        const ws = window._newSystemWS;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            setStatus('WebSocket not connected — waiting…');
            setStatusOk(false);
            return;
        }
        if (subIdRef.current) {
            try {
                ws.send(JSON.stringify({ forget: subIdRef.current }));
            } catch {
                // ignore — best effort cleanup
            }
            subIdRef.current = null;
        }
        const { symbol: sym, tickCount: n } = cfgRef.current;
        ticksRef.current = [];
        setTicks([]);
        setStatus(`Loading last ${n} ticks for ${SYMBOL_LABELS[sym] || sym}…`);
        setStatusOk(false);
        ws.send(JSON.stringify({ ticks_history: sym, style: 'ticks', count: n, end: 'latest', req_id: gen }));
        ws.send(JSON.stringify({ ticks: sym, subscribe: 1, req_id: gen }));
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
            if (mt === 'history') {
                const reqSym = data.echo_req?.ticks_history;
                if (reqSym !== cfgRef.current.symbol) return;
                if (data.echo_req?.req_id && data.echo_req.req_id !== genRef.current) return;
                if (data.error) {
                    setStatus(`Error: ${data.error.message || 'unknown'}`);
                    setStatusOk(false);
                    return;
                }
                const prices = data.history?.prices;
                const times = data.history?.times;
                if (!Array.isArray(prices) || prices.length === 0) {
                    setStatus('Server returned no ticks — try again');
                    setStatusOk(false);
                    return;
                }
                const arr: Tick[] = prices.map((p: any, i: number) => ({
                    p: Number(p),
                    t: Array.isArray(times) ? Number(times[i]) || 0 : 0,
                }));
                ticksRef.current = arr;
                setTicks(arr);
                setStatus(`Analyzing ${arr.length} ticks — live updates ON`);
                setStatusOk(true);
                setLastUpdate(Date.now());
            } else if (mt === 'tick') {
                const tick = data.tick;
                if (!tick || tick.symbol !== cfgRef.current.symbol) return;
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
                setLastUpdate(Date.now());
            }
        });
        return () => {
            unsub();
            if (subIdRef.current && window._newSystemWS?.readyState === WebSocket.OPEN) {
                try {
                    window._newSystemWS.send(JSON.stringify({ forget: subIdRef.current }));
                } catch {
                    // ignore
                }
            }
            subIdRef.current = null;
            if (retryTimerRef.current) {
                clearInterval(retryTimerRef.current);
                retryTimerRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            load();
            if (retryTimerRef.current) {
                clearInterval(retryTimerRef.current);
            }
            retryTimerRef.current = setInterval(() => {
                const ws = window._newSystemWS;
                if (ws?.readyState === WebSocket.OPEN && ticksRef.current.length === 0 && Date.now() - lastLoadRef.current > 10000) {
                    load();
                }
            }, 2000);
        }, 250);
        return () => {
            clearTimeout(timer);
        };
    }, [symbol, market, tickCount, digit, load]);

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
                } else {
                    cur = 0;
                }
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
                even,
                odd,
                evenPct: (even / n) * 100,
                oddPct: (odd / n) * 100,
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
            const curRise = currentRun(risePred);
            const curFall = currentRun(fallPred);
            return {
                ...base,
                kind: 'rise_fall' as const,
                rise,
                fall,
                flat,
                cmp,
                risePct: (rise / cmp) * 100,
                fallPct: (fall / cmp) * 100,
                dominant,
                longest: dominant === 'RISE' ? longestRise : longestFall,
                current: dominant === 'RISE' ? curRise : curFall,
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
            under,
            over,
            eq,
            underPct: (under / n) * 100,
            overPct: (over / n) * 100,
            dominant,
            longest: dominant === 'UNDER' ? longestUnder : longestOver,
            current: dominant === 'UNDER' ? curUnder : curOver,
            longestUnder,
            longestOver,
            target: d,
        };
    }, [ticks]);

    const chips: Chip[] = useMemo(() => {
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
        return counts.map((c, i) => ({
            digit: i,
            count: c,
            pct: (c / total) * 100,
            barPct: (c / max) * 100,
        }));
    }, [ticks]);

    const fmtTime = (t: number) => {
        if (!t) return '';
        return new Date(t * 1000).toLocaleTimeString();
    };
    const lastUpd = lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : '—';

    const bars =
        stats && stats.kind === 'even_odd'
            ? [
                  { key: 'even', label: 'Even', count: stats.even, pct: stats.evenPct, cls: 'even' },
                  { key: 'odd', label: 'Odd', count: stats.odd, pct: stats.oddPct, cls: 'odd' },
              ]
            : stats && stats.kind === 'rise_fall'
              ? [
                    { key: 'rise', label: 'Rise', count: stats.rise, pct: stats.risePct, cls: 'rise' },
                    { key: 'fall', label: 'Fall', count: stats.fall, pct: stats.fallPct, cls: 'fall' },
                ]
              : stats && stats.kind === 'over_under'
                ? [
                      { key: 'under', label: `Under ${stats.target}`, count: stats.under, pct: stats.underPct, cls: 'under' },
                      { key: 'over', label: `Over ${stats.target}`, count: stats.over, pct: stats.overPct, cls: 'over' },
                  ]
                : [];

    return (
        <div className='analysis'>
            <div className='analysis__controls'>
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
                    <div className={`analysis__status ${statusOk ? 'is-ok' : 'is-wait'}`}>
                        <span className='analysis__dot' />
                        {status}
                    </div>
                </div>
            </div>

            <div className='analysis__body'>
                <section className='analysis__card analysis__histogram'>
                    <header className='analysis__card-head'>
                        <h3>{MARKETS.find(m => m.value === market)?.label} histogram</h3>
                        {stats && (
                            <span className='analysis__dominant'>
                                Dominant: <strong>{stats.dominant}</strong>
                            </span>
                        )}
                    </header>
                    <div className='analysis__bars'>
                        {bars.map(b => (
                            <div key={b.key} className='analysis__bar-row'>
                                <div className='analysis__bar-meta'>
                                    <span className={`analysis__bar-label ${b.cls}`}>{b.label}</span>
                                    <span className='analysis__bar-count'>
                                        {b.count} ticks
                                    </span>
                                </div>
                                <div className='analysis__bar-track'>
                                    <div
                                        className={`analysis__bar-fill ${b.cls}`}
                                        style={{ width: `${Math.max(2, b.pct)}%` }}
                                    />
                                </div>
                                <span className='analysis__bar-pct'>{b.pct.toFixed(1)}%</span>
                            </div>
                        ))}
                    </div>
                    {!stats && <div className='analysis__empty'>Select a volatility and press Refresh to begin</div>}
                </section>

                <section className='analysis__card analysis__stats'>
                    <header className='analysis__card-head'>
                        <h3>Live stats</h3>
                    </header>
                    {stats ? (
                        <div className='analysis__stat-grid'>
                            <div className='analysis__stat'>
                                <span className='analysis__stat-label'>Last price</span>
                                <span className='analysis__stat-value'>{stats.last.toFixed(2)}</span>
                            </div>
                            <div className='analysis__stat'>
                                <span className='analysis__stat-label'>Range</span>
                                <span className='analysis__stat-value'>{stats.change >= 0 ? '+' : ''}{stats.change.toFixed(2)}</span>
                            </div>
                            <div className='analysis__stat'>
                                <span className='analysis__stat-label'>Ticks analysed</span>
                                <span className='analysis__stat-value'>{stats.total}</span>
                            </div>
                            <div className='analysis__stat'>
                                <span className='analysis__stat-label'>Current streak</span>
                                <span className='analysis__stat-value'>{stats.current}</span>
                            </div>
                            <div className='analysis__stat'>
                                <span className='analysis__stat-label'>Longest streak</span>
                                <span className='analysis__stat-value'>{stats.longest}</span>
                            </div>
                            <div className='analysis__stat'>
                                <span className='analysis__stat-label'>Last update</span>
                                <span className='analysis__stat-value'>{lastUpd}</span>
                            </div>
                            {stats.kind === 'rise_fall' && (
                                <>
                                    <div className='analysis__stat'>
                                        <span className='analysis__stat-label'>Longest rise run</span>
                                        <span className='analysis__stat-value'>{stats.longestRise}</span>
                                    </div>
                                    <div className='analysis__stat'>
                                        <span className='analysis__stat-label'>Longest fall run</span>
                                        <span className='analysis__stat-value'>{stats.longestFall}</span>
                                    </div>
                                </>
                            )}
                            {stats.kind === 'over_under' && (
                                <>
                                    <div className='analysis__stat'>
                                        <span className='analysis__stat-label'>Equal ({stats.target})</span>
                                        <span className='analysis__stat-value'>{stats.eq} ticks</span>
                                    </div>
                                    <div className='analysis__stat'>
                                        <span className='analysis__stat-label'>Longest under/over</span>
                                        <span className='analysis__stat-value'>
                                            {stats.longestUnder} / {stats.longestOver}
                                        </span>
                                    </div>
                                </>
                            )}
                            {stats.kind === 'rise_fall' && (
                                <div className='analysis__stat'>
                                    <span className='analysis__stat-label'>Flat ticks</span>
                                    <span className='analysis__stat-value'>{stats.flat}</span>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className='analysis__empty'>No data yet</div>
                    )}
                </section>

                {distribution && (
                    <section className='analysis__card analysis__distribution'>
                        <header className='analysis__card-head'>
                            <h3>Digit distribution 0–9</h3>
                            <span className='analysis__hint'>last digit of each price</span>
                        </header>
                        <div className='analysis__dist-bars'>
                            {distribution.map(d => (
                                <div key={d.digit} className='analysis__dist-col' title={`${d.count} ticks (${d.pct.toFixed(1)}%)`}>
                                    <span className='analysis__dist-pct'>{d.count}</span>
                                    <div className='analysis__dist-track'>
                                        <div className='analysis__dist-fill' style={{ height: `${Math.max(3, d.barPct)}%` }} />
                                    </div>
                                    <span className='analysis__dist-digit'>{d.digit}</span>
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
                        {market === 'even_odd' && 'E = even, O = odd'}
                        {market === 'rise_fall' && 'R = rise, F = fall, = = flat'}
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
                <div className='analysis__legend'>
                    <span className='analysis__legend-item'>
                        <span className='analysis__chip is-mini even'>E</span> Even
                    </span>
                    <span className='analysis__legend-item'>
                        <span className='analysis__chip is-mini odd'>O</span> Odd
                    </span>
                    {market === 'rise_fall' && (
                        <span className='analysis__legend-item'>
                            <span className='analysis__chip is-mini rise'>R</span> Rise
                        </span>
                    )}
                    {market === 'rise_fall' && (
                        <span className='analysis__legend-item'>
                            <span className='analysis__chip is-mini fall'>F</span> Fall
                        </span>
                    )}
                    {market === 'over_under' && (
                        <span className='analysis__legend-item'>
                            <span className='analysis__chip is-mini under'>U</span> Under {digit}
                        </span>
                    )}
                    {market === 'over_under' && (
                        <span className='analysis__legend-item'>
                            <span className='analysis__chip is-mini over'>O</span> Over {digit}
                        </span>
                    )}
                </div>
            </section>
        </div>
    );
};

export default Analysis;