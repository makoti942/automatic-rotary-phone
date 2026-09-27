import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onNewSystemMessage } from '@/auth/NewDerivAuth';
import { ALL_SYMBOLS, SYMBOL_LABELS } from '@/components/makoti-widget/makoti-ws';
import './analysis-tool.scss';

type Tick = { price: number; quote: string; epoch: number };
type Family = 'digit' | 'direction' | 'touch' | 'range' | 'multiplier';
type Contract = { value: string; label: string; family: Family; barrier?: boolean; description: string };

const CONTRACTS: Contract[] = [
    { value: 'DIGITDIFF', label: 'Differs', family: 'digit', barrier: true, description: 'Last digit differs from the barrier.' },
    { value: 'DIGITMATCH', label: 'Matches', family: 'digit', barrier: true, description: 'Last digit matches the barrier.' },
    { value: 'DIGITOVER', label: 'Over', family: 'digit', barrier: true, description: 'Last digit is above the barrier.' },
    { value: 'DIGITUNDER', label: 'Under', family: 'digit', barrier: true, description: 'Last digit is below the barrier.' },
    { value: 'DIGITEVEN', label: 'Even', family: 'digit', description: 'Last digit is even.' },
    { value: 'DIGITODD', label: 'Odd', family: 'digit', description: 'Last digit is odd.' },
    { value: 'CALL', label: 'Rise', family: 'direction', description: 'Exit price is above entry.' },
    { value: 'PUT', label: 'Fall', family: 'direction', description: 'Exit price is below entry.' },
    { value: 'ONETOUCH', label: 'Touch', family: 'touch', barrier: true, description: 'Price touches the barrier before expiry.' },
    { value: 'NOTOUCH', label: 'No Touch', family: 'touch', barrier: true, description: 'Price avoids the barrier until expiry.' },
    { value: 'RANGE', label: 'Stays In', family: 'range', barrier: true, description: 'Price remains inside the observed range.' },
    { value: 'RANGEBREAK', label: 'Goes Out', family: 'range', barrier: true, description: 'Price breaks outside the observed range.' },
    { value: 'MULTUP', label: 'Multiplier Up', family: 'multiplier', description: 'Upward momentum with stop-loss discipline.' },
    { value: 'MULTDOWN', label: 'Multiplier Down', family: 'multiplier', description: 'Downward momentum with stop-loss discipline.' },
];
const FAMILIES: { value: Family; label: string }[] = [
    { value: 'digit', label: 'Digits' }, { value: 'direction', label: 'Rise / Fall' }, { value: 'touch', label: 'Touch' }, { value: 'range', label: 'Range' }, { value: 'multiplier', label: 'Multipliers' },
];
const STORAGE_KEY = 'analysis_tool_settings_v2';
const DEFAULTS = { symbol: 'R_100', family: 'digit' as Family, contract: 'DIGITDIFF', ticks: 500, duration: 1, barrier: 5, risk: 1 };
const digitOf = (quote: string | number) => Number(String(quote).replace(/\D/g, '').slice(-1) || 0);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const safeMean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

function readSettings(): Partial<typeof DEFAULTS> {
    try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
}

function outcome(contract: string, from: Tick, to: Tick, path: Tick[], barrier: number): boolean {
    const digit = digitOf(to.quote);
    if (contract === 'DIGITDIFF') return digit !== barrier;
    if (contract === 'DIGITMATCH') return digit === barrier;
    if (contract === 'DIGITOVER') return digit > barrier;
    if (contract === 'DIGITUNDER') return digit < barrier;
    if (contract === 'DIGITEVEN') return digit % 2 === 0;
    if (contract === 'DIGITODD') return digit % 2 === 1;
    if (contract === 'CALL' || contract === 'MULTUP') return to.price > from.price;
    if (contract === 'PUT' || contract === 'MULTDOWN') return to.price < from.price;
    const prices = path.map(t => t.price);
    const range = Math.max(...prices) - Math.min(...prices);
    if (contract === 'ONETOUCH') return prices.some(price => Math.abs(price - from.price) >= Math.max(range * 0.35, Math.abs(from.price) * 0.00015));
    if (contract === 'NOTOUCH') return !outcome('ONETOUCH', from, to, path, barrier);
    if (contract === 'RANGEBREAK') return to.price > Math.max(...prices.slice(0, -1)) || to.price < Math.min(...prices.slice(0, -1));
    if (contract === 'RANGE') return !outcome('RANGEBREAK', from, to, path, barrier);
    return false;
}

const AnalysisTool = () => {
    const saved = useMemo(readSettings, []);
    const [symbol, setSymbol] = useState(() => ALL_SYMBOLS.includes(saved.symbol || '') ? saved.symbol! : DEFAULTS.symbol);
    const [family, setFamily] = useState<Family>(() => FAMILIES.some(item => item.value === saved.family) ? saved.family! : DEFAULTS.family);
    const [contract, setContract] = useState(() => CONTRACTS.some(item => item.value === saved.contract) ? saved.contract! : DEFAULTS.contract);
    const [tickCount, setTickCount] = useState(() => clamp(Number(saved.ticks) || DEFAULTS.ticks, 100, 5000));
    const [duration, setDuration] = useState(() => clamp(Number(saved.duration) || DEFAULTS.duration, 1, 10));
    const [barrier, setBarrier] = useState(() => clamp(Number(saved.barrier ?? DEFAULTS.barrier), 0, 9));
    const [risk, setRisk] = useState(() => clamp(Number(saved.risk) || DEFAULTS.risk, .25, 5));
    const [ticks, setTicks] = useState<Tick[]>([]);
    const [status, setStatus] = useState('Waiting for a market data connection');
    const [live, setLive] = useState(false);
    const ticksRef = useRef<Tick[]>([]);
    const requestRef = useRef(0);
    const subscriptionRef = useRef<string | null>(null);
    const configRef = useRef({ symbol, tickCount });
    configRef.current = { symbol, tickCount };

    const contracts = useMemo(() => CONTRACTS.filter(item => item.family === family), [family]);
    const selected = CONTRACTS.find(item => item.value === contract) || CONTRACTS[0];
    useEffect(() => { if (!contracts.some(item => item.value === contract)) setContract(contracts[0].value); }, [contract, contracts]);
    useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify({ symbol, family, contract, ticks: tickCount, duration, barrier, risk })); }, [symbol, family, contract, tickCount, duration, barrier, risk]);

    const load = useCallback(() => {
        const ws = window._newSystemWS;
        ticksRef.current = []; setTicks([]); setLive(false);
        if (!ws || ws.readyState !== WebSocket.OPEN) { setStatus('WebSocket not connected — open the workspace first'); return; }
        if (subscriptionRef.current) { try { ws.send(JSON.stringify({ forget: subscriptionRef.current })); } catch {} subscriptionRef.current = null; }
        const reqId = ++requestRef.current;
        setStatus(`Loading ${configRef.current.tickCount.toLocaleString()} ticks…`);
        ws.send(JSON.stringify({ ticks_history: configRef.current.symbol, style: 'ticks', count: configRef.current.tickCount, end: 'latest', subscribe: 1, req_id: reqId }));
    }, []);

    useEffect(() => {
        const unsubscribe = onNewSystemMessage((event: any) => {
            let data: any; try { data = JSON.parse(event.data); } catch { return; }
            if (data?.error) { if (data.echo_req?.req_id === requestRef.current) setStatus(data.error.message || 'Market data request failed'); return; }
            if (data?.msg_type === 'history' && data.echo_req?.req_id === requestRef.current) {
                const prices = data.history?.prices || []; const times = data.history?.times || [];
                const next = prices.map((price: any, i: number) => ({ price: Number(price), quote: String(price), epoch: Number(times[i]) || Date.now() / 1000 }));
                ticksRef.current = next; setTicks(next); setLive(true); setStatus('Live market data'); if (data.subscription?.id) subscriptionRef.current = data.subscription.id;
            }
            if (data?.msg_type === 'tick' && data.tick?.symbol === configRef.current.symbol) {
                const next = [...ticksRef.current, { price: Number(data.tick.quote), quote: String(data.tick.quote), epoch: Number(data.tick.epoch) }].slice(-configRef.current.tickCount);
                ticksRef.current = next; setTicks(next); setLive(true);
            }
        });
        return () => { unsubscribe(); if (subscriptionRef.current && window._newSystemWS?.readyState === WebSocket.OPEN) window._newSystemWS.send(JSON.stringify({ forget: subscriptionRef.current })); };
    }, []);
    useEffect(() => { const id = window.setTimeout(load, 200); return () => window.clearTimeout(id); }, [load, symbol, tickCount]);

    const metrics = useMemo(() => {
        const n = ticks.length; if (!n) return null;
        const digits = ticks.map(tick => digitOf(tick.quote));
        const changes = ticks.slice(1).map((tick, index) => tick.price - ticks[index].price);
        const rises = changes.filter(value => value > 0).length; const falls = changes.filter(value => value < 0).length;
        const freq = Array.from({ length: 10 }, (_, digit) => digits.filter(value => value === digit).length);
        const recent = ticks.slice(-50); const recentDigits = recent.map(tick => digitOf(tick.quote));
        const recentFreq = Array.from({ length: 10 }, (_, digit) => recentDigits.filter(value => value === digit).length);
        const mean = safeMean(ticks.map(tick => tick.price)); const variance = safeMean(ticks.map(tick => (tick.price - mean) ** 2));
        const returns = changes.map((change, i) => Math.abs(change) / Math.max(Math.abs(ticks[i].price), Number.EPSILON));
        const entropy = -freq.filter(Boolean).reduce((sum, count) => { const p = count / n; return sum + p * Math.log2(p); }, 0);
        const longest = (predicate: (value: number) => boolean) => { let best = 0; let run = 0; digits.forEach(value => { run = predicate(value) ? run + 1 : 0; best = Math.max(best, run); }); return best; };
        const current = (predicate: (value: number) => boolean) => { let run = 0; for (let i = digits.length - 1; i >= 0 && predicate(digits[i]); i--) run++; return run; };
        const probability = (type: string, windowTicks = ticks) => {
            let wins = 0; let samples = 0;
            for (let i = 0; i + duration < windowTicks.length; i++) { const path = windowTicks.slice(i, i + duration + 1); if (outcome(type, path[0], path[path.length - 1], path, barrier)) wins++; samples++; }
            return { wins, samples, value: samples ? wins / samples : 0 };
        };
        const selectedProb = probability(selected.value);
        const baseline = selected.value === 'DIGITMATCH' ? .1 : selected.value === 'DIGITEVEN' || selected.value === 'DIGITODD' ? .5 : selected.value === 'DIGITOVER' ? (9 - barrier) / 10 : selected.value === 'DIGITUNDER' ? barrier / 10 : selected.value === 'DIGITDIFF' ? .9 : .5;
        const edge = selectedProb.value - baseline;
        const shortProb = probability(selected.value, ticks.slice(-100));
        const topDigit = freq.indexOf(Math.max(...freq)); const recentTopDigit = recentFreq.indexOf(Math.max(...recentFreq));
        const direction = rises === falls ? 'FLAT' : rises > falls ? 'UP' : 'DOWN';
        const directionStrength = Math.abs(rises - falls) / Math.max(changes.length, 1);
        const confidence = clamp(Math.round(50 + Math.abs(edge) * 220 + directionStrength * 18 + (n >= 250 ? 6 : 0) - (entropy > 3.15 ? 8 : 0)), 38, 94);
        const priceMin = Math.min(...ticks.map(tick => tick.price)); const priceMax = Math.max(...ticks.map(tick => tick.price));
        const path = ticks.slice(-80).map(tick => ((tick.price - priceMin) / Math.max(priceMax - priceMin, Number.EPSILON)) * 100);
        const contractRows = ['DIGITDIFF', 'DIGITMATCH', 'DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD', 'CALL', 'PUT'].map(type => ({ type, probability: probability(type) }));
        let signal = 'WAIT';
        if (selectedProb.samples >= 50 && edge >= .04) signal = `${selected.label.toUpperCase()} BIAS`;
        if (selectedProb.samples >= 50 && edge <= -.04) signal = 'NO EDGE';
        return { n, digits, freq, recentFreq, topDigit, recentTopDigit, rises, falls, direction, directionStrength, mean, volatility: Math.sqrt(variance), avgMove: safeMean(returns), entropy, selectedProb, shortProb, baseline, edge, confidence, signal, priceMin, priceMax, path, contractRows, currentEven: current(value => value % 2 === 0), currentOdd: current(value => value % 2 === 1), longestEven: longest(value => value % 2 === 0), longestOdd: longest(value => value % 2 === 1), last: ticks[n - 1] };
    }, [ticks, barrier, duration, selected]);

    const symbolLabel = SYMBOL_LABELS[symbol] || symbol;
    const fairPayout = metrics && metrics.selectedProb.value > 0 ? (1 / metrics.selectedProb.value - 1) : 0;
    const windowLabel = ticks.length >= 100 ? 'Last 100 ticks' : `Last ${ticks.length} ticks`;
    const formatPrice = (value: number) => Number.isFinite(value) ? value.toFixed(Math.max(2, String(value).split('.')[1]?.length || 2)) : '—';

    return <div className='analysis-tool'>
        <header className='analysis-tool__hero'><div><span className='analysis-tool__eyebrow'>DERIV MARKET INTELLIGENCE / LIVE TICK LAB</span><h1>Analysis Tool</h1><p>Measure observed contract outcomes, momentum, randomness and regime change before you decide whether to trade.</p></div><div className={`analysis-tool__live ${live ? 'is-live' : ''}`}><span />{live ? 'LIVE FEED' : 'CONNECTING'}</div></header>
        <section className='analysis-tool__control-panel'>
            <div className='analysis-tool__field analysis-tool__field--wide'><label>Market / volatility</label><select value={symbol} onChange={event => setSymbol(event.target.value)}>{ALL_SYMBOLS.map(item => <option key={item} value={item}>{SYMBOL_LABELS[item] || item}</option>)}</select></div>
            <div className='analysis-tool__field'><label>Contract family</label><select value={family} onChange={event => setFamily(event.target.value as Family)}>{FAMILIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
            <div className='analysis-tool__field analysis-tool__field--wide'><label>Contract type</label><select value={contract} onChange={event => setContract(event.target.value)}>{contracts.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
            {selected.barrier && <div className='analysis-tool__field'><label>Barrier digit</label><select value={barrier} onChange={event => setBarrier(Number(event.target.value))}>{Array.from({ length: 10 }, (_, value) => <option key={value} value={value}>{value}</option>)}</select></div>}
            <div className='analysis-tool__field'><label>Expiry duration</label><select value={duration} onChange={event => setDuration(Number(event.target.value))}>{[1, 2, 3, 5, 10].map(value => <option key={value} value={value}>{value} tick{value === 1 ? '' : 's'}</option>)}</select></div>
            <div className='analysis-tool__field'><label>Sample size</label><select value={tickCount} onChange={event => setTickCount(Number(event.target.value))}>{[100, 250, 500, 1000, 2500, 5000].map(value => <option key={value} value={value}>{value.toLocaleString()} ticks</option>)}</select></div>
            <div className='analysis-tool__field'><label>Risk cap / trade</label><select value={risk} onChange={event => setRisk(Number(event.target.value))}>{[.25, .5, 1, 2, 3, 5].map(value => <option key={value} value={value}>{value}% of balance</option>)}</select></div>
            <button className='analysis-tool__refresh' type='button' onClick={load}>Refresh analysis</button>
        </section>
        <div className='analysis-tool__contract-note'><strong>{selected.label}</strong><span>{selected.description}</span><em>{symbolLabel} · {duration} tick expiry · {status}</em></div>
        <main className='analysis-tool__grid'>
            <section className={`analysis-tool__signal-card ${metrics?.signal.includes('BIAS') ? 'is-actionable' : ''}`}><div className='analysis-tool__card-kicker'>CONTRACT VERDICT</div><div className='analysis-tool__signal-row'><div><h2>{metrics?.signal || 'Collecting data'}</h2><p>{metrics ? `${pct(metrics.selectedProb.value)} observed success across ${metrics.selectedProb.samples.toLocaleString()} historical samples.` : 'Connect to Deriv to calculate historical outcomes.'}</p></div><div className='analysis-tool__score'>{metrics ? `${metrics.confidence}%` : '—'}<small>signal quality</small></div></div><div className='analysis-tool__meter'><span style={{ width: `${metrics?.confidence || 0}%` }} /></div><div className='analysis-tool__signal-foot'><span>Observed edge <b>{metrics ? `${metrics.edge >= 0 ? '+' : ''}${pct(metrics.edge)}` : '—'}</b></span><span>Fair net payout <b>{metrics ? `${(fairPayout * 100).toFixed(1)}%+` : '—'}</b></span><span>Risk cap <b>{risk}%</b></span></div></section>
            <section className='analysis-tool__card analysis-tool__card--snapshot'><div className='analysis-tool__card-kicker'>MARKET SNAPSHOT</div><div className='analysis-tool__stats'>{[['Last quote', metrics?.last?.quote || '—'], ['Regime', metrics?.direction || '—'], ['Volatility', metrics ? formatPrice(metrics.volatility) : '—'], ['Avg move', metrics ? pct(metrics.avgMove) : '—'], ['Entropy', metrics ? `${metrics.entropy.toFixed(2)} / 3.32` : '—'], ['Window', metrics ? `${metrics.n} ticks` : '—']].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></section>
            <section className='analysis-tool__card analysis-tool__card--chart'><div className='analysis-tool__card-title'><div><div className='analysis-tool__card-kicker'>PRICE STRUCTURE</div><h3>Recent quote path</h3></div><span>{metrics ? `${formatPrice(metrics.priceMin)} — ${formatPrice(metrics.priceMax)}` : 'No data'}</span></div>{metrics ? <svg className='analysis-tool__sparkline' viewBox='0 0 800 220' preserveAspectRatio='none' role='img' aria-label='Recent price path'><defs><linearGradient id='analysis-fill' x1='0' x2='0' y1='0' y2='1'><stop offset='0%' stopColor='#7568ff' stopOpacity='.35' /><stop offset='100%' stopColor='#7568ff' stopOpacity='0' /></linearGradient></defs><polyline points={`0,220 ${metrics.path.map((value, index) => `${(index / Math.max(metrics.path.length - 1, 1)) * 800},${220 - value * 1.8}`).join(' ')} 800,220`} fill='url(#analysis-fill)' stroke='none' /><polyline points={metrics.path.map((value, index) => `${(index / Math.max(metrics.path.length - 1, 1)) * 800},${220 - value * 1.8}`).join(' ')} fill='none' stroke='#6558ef' strokeWidth='4' strokeLinejoin='round' /></svg> : <div className='analysis-tool__empty'>Refresh data to draw the live price path.</div>}<div className='analysis-tool__chart-labels'><span>Oldest</span><span>Latest · {metrics?.last?.quote || '—'}</span></div></section>
            <section className='analysis-tool__card analysis-tool__card--digits'><div className='analysis-tool__card-title'><div><div className='analysis-tool__card-kicker'>DIGIT INTELLIGENCE</div><h3>Distribution vs fair baseline</h3></div><span>Mode {metrics?.topDigit ?? '—'} · recent {metrics?.recentTopDigit ?? '—'}</span></div><div className='analysis-tool__digit-grid'>{metrics ? metrics.freq.map((count, digit) => <div className={`analysis-tool__digit ${digit === metrics.topDigit ? 'is-top' : ''}`} key={digit}><div className='analysis-tool__digit-head'><b>{digit}</b><span>{pct(count / metrics.n)}</span></div><div className='analysis-tool__digit-track'><i style={{ height: `${Math.max(5, (count / Math.max(...metrics.freq)) * 100)}%` }} /><mark style={{ bottom: '10%' }} /></div><small>{count}</small></div>) : <div className='analysis-tool__empty'>No digit sample yet.</div>}</div><div className='analysis-tool__legend'><span><i className='is-observed' />Observed</span><span><i className='is-fair' />10% fair baseline</span></div></section>
            <section className='analysis-tool__card analysis-tool__card--matrix'><div className='analysis-tool__card-title'><div><div className='analysis-tool__card-kicker'>CONTRACT MATRIX</div><h3>Historical outcome screen</h3></div><span>{windowLabel}</span></div><div className='analysis-tool__matrix'>{metrics ? metrics.contractRows.map(row => <div className={`analysis-tool__matrix-row ${row.type === contract ? 'is-selected' : ''}`} key={row.type}><span>{CONTRACTS.find(item => item.value === row.type)?.label}</span><div><i><b style={{ width: `${row.probability.value * 100}%` }} /></i><strong>{pct(row.probability.value)}</strong></div><small>{row.probability.samples} tests</small></div>) : <div className='analysis-tool__empty'>Historical outcomes will appear here.</div>}</div></section>
            <section className='analysis-tool__card analysis-tool__card--quality'><div className='analysis-tool__card-kicker'>QUALITY CHECKS</div><h3>Is the signal usable?</h3><div className='analysis-tool__quality-list'>{[['Sample size', metrics ? (metrics.n >= 250 ? 'PASS' : 'LOW') : 'WAIT', metrics ? `${metrics.n} ticks` : '—'], ['Short vs full window', metrics ? (Math.abs(metrics.shortProb.value - metrics.selectedProb.value) < .08 ? 'STABLE' : 'SHIFTING') : 'WAIT', metrics ? `${pct(metrics.shortProb.value)} recent` : '—'], ['Randomness', metrics ? (metrics.entropy > 3.15 ? 'HIGH' : 'STRUCTURED') : 'WAIT', metrics ? metrics.entropy.toFixed(2) : '—'], ['Directional pressure', metrics ? (metrics.directionStrength > .08 ? 'VISIBLE' : 'WEAK') : 'WAIT', metrics ? `${pct(metrics.directionStrength)} split` : '—']].map(([label, state, value]) => <div key={label}><span>{label}</span><b className={`is-${String(state).toLowerCase()}`}>{state}</b><small>{value}</small></div>)}</div></section>
            <section className='analysis-tool__card analysis-tool__card--plan'><div className='analysis-tool__card-kicker'>DISCIPLINED TRADE PLAN</div><h3>Guardrails before execution</h3><ul className='analysis-tool__checklist'><li><span>01</span>Only consider a contract when its observed probability beats the fair baseline by at least <b>4 percentage points</b>.</li><li><span>02</span>Compare the full sample with the last 100 ticks; if they disagree, label the market <b>SHIFTING</b>.</li><li><span>03</span>Keep stake at or below <b>{risk}%</b> of balance and never use loss-chasing.</li><li><span>04</span>Validate payout, barrier, duration and account limits in the Deriv contract proposal before entry.</li></ul></section>
        </main>
        <footer className='analysis-tool__disclaimer'><strong>Risk notice</strong><span>This is a statistical decision-support tool, not a profit guarantee. Historical tick outcomes are not independent promises about the next contract. Payout, latency, execution, regime change and randomness can erase an apparent edge. Use demo mode and a hard daily loss limit.</span></footer>
    </div>;
};

export default AnalysisTool;
