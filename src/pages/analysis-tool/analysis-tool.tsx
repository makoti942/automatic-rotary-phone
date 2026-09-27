import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onNewSystemMessage } from '@/auth/NewDerivAuth';
import { ALL_SYMBOLS, SYMBOL_LABELS } from '@/components/makoti-widget/makoti-ws';
import './analysis-tool.scss';

type Tick = { price: number; quote: string; epoch: number };
type ContractGroup = 'digit' | 'direction' | 'touch' | 'range' | 'accumulator' | 'multiplier';

type Contract = { value: string; label: string; group: ContractGroup; barrier?: boolean; description: string };

const CONTRACTS: Contract[] = [
    { value: 'DIGITDIFF', label: 'Matches / Differs — Differs', group: 'digit', barrier: true, description: 'Last digit differs from the selected barrier.' },
    { value: 'DIGITMATCH', label: 'Matches / Differs — Matches', group: 'digit', barrier: true, description: 'Last digit matches the selected barrier.' },
    { value: 'DIGITOVER', label: 'Over / Under — Over', group: 'digit', barrier: true, description: 'Last digit finishes above the selected barrier.' },
    { value: 'DIGITUNDER', label: 'Over / Under — Under', group: 'digit', barrier: true, description: 'Last digit finishes below the selected barrier.' },
    { value: 'DIGITEVEN', label: 'Even', group: 'digit', description: 'Last digit finishes even.' },
    { value: 'DIGITODD', label: 'Odd', group: 'digit', description: 'Last digit finishes odd.' },
    { value: 'CALL', label: 'Rise', group: 'direction', description: 'Exit price is higher than entry.' },
    { value: 'PUT', label: 'Fall', group: 'direction', description: 'Exit price is lower than entry.' },
    { value: 'ONETOUCH', label: 'Touch', group: 'touch', barrier: true, description: 'Price touches the selected barrier before expiry.' },
    { value: 'NOTOUCH', label: 'No Touch', group: 'touch', barrier: true, description: 'Price avoids the selected barrier until expiry.' },
    { value: 'RANGE', label: 'Stays In', group: 'range', barrier: true, description: 'Price remains between the contract barriers.' },
    { value: 'RANGEBREAK', label: 'Goes Out', group: 'range', barrier: true, description: 'Price breaks outside the contract barriers.' },
    { value: 'ACCU', label: 'Accumulator', group: 'accumulator', description: 'Accumulates payout while price remains within the growth range.' },
    { value: 'MULTUP', label: 'Multiplier Up', group: 'multiplier', description: 'Multiplier position in an upward move with a stop-loss plan.' },
    { value: 'MULTDOWN', label: 'Multiplier Down', group: 'multiplier', description: 'Multiplier position in a downward move with a stop-loss plan.' },
];

const GROUPS: { value: ContractGroup; label: string }[] = [
    { value: 'digit', label: 'Digits' },
    { value: 'direction', label: 'Rise / Fall' },
    { value: 'touch', label: 'Touch' },
    { value: 'range', label: 'Range' },
    { value: 'accumulator', label: 'Accumulator' },
    { value: 'multiplier', label: 'Multipliers' },
];

const STORAGE_KEY = 'analysis_tool_settings_v1';
const DEFAULTS = { symbol: 'R_100', group: 'digit' as ContractGroup, contract: 'DIGITDIFF', ticks: 250, duration: 1, barrier: 5, risk: 1 };
const lastDigit = (quote: string) => Number(String(quote).replace(/\D/g, '').slice(-1) || 0);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const readSettings = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
};

const AnalysisTool = () => {
    const saved = useMemo(readSettings, []);
    const [symbol, setSymbol] = useState(() => ALL_SYMBOLS.includes(saved.symbol) ? saved.symbol : DEFAULTS.symbol);
    const [group, setGroup] = useState<ContractGroup>(() => GROUPS.some(g => g.value === saved.group) ? saved.group : DEFAULTS.group);
    const [contract, setContract] = useState(() => CONTRACTS.some(c => c.value === saved.contract) ? saved.contract : DEFAULTS.contract);
    const [tickCount, setTickCount] = useState(() => clamp(Number(saved.ticks) || DEFAULTS.ticks, 50, 5000));
    const [duration, setDuration] = useState(() => clamp(Number(saved.duration) || DEFAULTS.duration, 1, 10));
    const [barrier, setBarrier] = useState(() => clamp(Number(saved.barrier), 0, 9));
    const [risk, setRisk] = useState(() => clamp(Number(saved.risk) || DEFAULTS.risk, 0.25, 5));
    const [ticks, setTicks] = useState<Tick[]>([]);
    const [status, setStatus] = useState('Waiting for live market data');
    const [live, setLive] = useState(false);
    const requestRef = useRef(0);
    const subscriptionRef = useRef<string | null>(null);
    const ticksRef = useRef<Tick[]>([]);
    const configRef = useRef({ symbol, tickCount });
    configRef.current = { symbol, tickCount };

    const contractsForGroup = useMemo(() => CONTRACTS.filter(c => c.group === group), [group]);
    const selected = CONTRACTS.find(c => c.value === contract) || CONTRACTS[0];

    useEffect(() => {
        if (!contractsForGroup.some(c => c.value === contract)) setContract(contractsForGroup[0].value);
    }, [contract, contractsForGroup]);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ symbol, group, contract, ticks: tickCount, duration, barrier, risk }));
    }, [symbol, group, contract, tickCount, duration, barrier, risk]);

    const load = useCallback(() => {
        const ws = window._newSystemWS;
        ticksRef.current = [];
        setTicks([]);
        setLive(false);
        if (!ws || ws.readyState !== WebSocket.OPEN) { setStatus('WebSocket not connected — open a trading workspace first'); return; }
        if (subscriptionRef.current) { try { ws.send(JSON.stringify({ forget: subscriptionRef.current })); } catch {} subscriptionRef.current = null; }
        const reqId = ++requestRef.current;
        setStatus(`Loading ${configRef.current.tickCount} ticks…`);
        ws.send(JSON.stringify({ ticks_history: configRef.current.symbol, style: 'ticks', count: configRef.current.tickCount, end: 'latest', subscribe: 1, req_id: reqId }));
    }, []);

    useEffect(() => {
        const unsubscribe = onNewSystemMessage((event: any) => {
            let data: any;
            try { data = JSON.parse(event.data); } catch { return; }
            if (data?.error) { if (data.echo_req?.req_id === requestRef.current) setStatus(data.error.message || 'Market data request failed'); return; }
            if (data?.msg_type === 'history' && data.echo_req?.req_id === requestRef.current) {
                const prices = data.history?.prices || [];
                const times = data.history?.times || [];
                const next = prices.map((p: any, i: number) => ({ price: Number(p), quote: String(p), epoch: Number(times[i]) || Date.now() / 1000 }));
                ticksRef.current = next;
                setTicks(next);
                setLive(true);
                setStatus('Live market data');
                if (data.subscription?.id) subscriptionRef.current = data.subscription.id;
            }
            if (data?.msg_type === 'tick' && data.tick?.symbol === configRef.current.symbol) {
                const next = [...ticksRef.current, { price: Number(data.tick.quote), quote: String(data.tick.quote), epoch: Number(data.tick.epoch) }].slice(-configRef.current.tickCount);
                ticksRef.current = next;
                setTicks(next);
                setLive(true);
            }
        });
        return () => { unsubscribe(); if (subscriptionRef.current && window._newSystemWS?.readyState === WebSocket.OPEN) window._newSystemWS.send(JSON.stringify({ forget: subscriptionRef.current })); };
    }, []);

    useEffect(() => { const id = window.setTimeout(load, 200); return () => window.clearTimeout(id); }, [load, symbol, tickCount]);

    const metrics = useMemo(() => {
        const n = ticks.length;
        if (!n) return null;
        const digits = ticks.map(t => lastDigit(t.quote));
        const freq = Array.from({ length: 10 }, (_, digit) => digits.filter(d => d === digit).length);
        const changes = ticks.slice(1).map((t, i) => t.price - ticks[i].price);
        const rises = changes.filter(x => x > 0).length;
        const falls = changes.filter(x => x < 0).length;
        const mean = ticks.reduce((sum, t) => sum + t.price, 0) / n;
        const variance = ticks.reduce((sum, t) => sum + (t.price - mean) ** 2, 0) / n;
        const recent = digits.slice(-30);
        const recentFreq = Array.from({ length: 10 }, (_, digit) => recent.filter(d => d === digit).length);
        const dominantDigit = freq.indexOf(Math.max(...freq));
        const recentDigit = recentFreq.indexOf(Math.max(...recentFreq));
        const even = digits.filter(d => d % 2 === 0).length;
        const under = digits.filter(d => d < barrier).length;
        const over = digits.filter(d => d > barrier).length;
        const streak = (predicate: (d: number) => boolean) => { let value = 0; for (let i = digits.length - 1; i >= 0 && predicate(digits[i]); i--) value++; return value; };
        const entropy = -freq.filter(Boolean).reduce((sum, count) => { const p = count / n; return sum + p * Math.log2(p); }, 0);
        const confidenceBase = group === 'digit' ? Math.max(...freq) / n : Math.max(rises, falls) / Math.max(changes.length, 1);
        const agreement = group === 'digit' ? Math.abs(even / n - 0.5) * 2 : Math.abs(rises - falls) / Math.max(changes.length, 1);
        const confidence = clamp(Math.round((50 + confidenceBase * 32 + agreement * 18) * (entropy > 3.1 ? 0.92 : 1)), 50, 92);
        let bias = 'WAIT';
        if (selected.value === 'DIGITDIFF') bias = `DIFFERS ${barrier}`;
        else if (selected.value === 'DIGITMATCH') bias = `MATCH ${barrier}`;
        else if (selected.value === 'DIGITOVER') bias = `OVER ${barrier}`;
        else if (selected.value === 'DIGITUNDER') bias = `UNDER ${barrier}`;
        else if (selected.value === 'DIGITEVEN') bias = even >= n / 2 ? 'EVEN' : 'WAIT';
        else if (selected.value === 'DIGITODD') bias = even < n / 2 ? 'ODD' : 'WAIT';
        else if (selected.value === 'CALL' || selected.value === 'MULTUP') bias = rises > falls ? 'RISE' : 'WAIT';
        else if (selected.value === 'PUT' || selected.value === 'MULTDOWN') bias = falls > rises ? 'FALL' : 'WAIT';
        else if (selected.value === 'RANGEBREAK') bias = Math.sqrt(variance) > 0 ? 'BREAKOUT WATCH' : 'WAIT';
        else if (selected.value === 'RANGE') bias = Math.sqrt(variance) < mean * 0.001 ? 'STAYS IN' : 'WAIT';
        else bias = selected.value === 'ONETOUCH' ? 'TOUCH WATCH' : selected.value === 'NOTOUCH' ? 'NO TOUCH WATCH' : 'WAIT';
        const edge = confidence >= 68 && bias !== 'WAIT';
        return { n, freq, dominantDigit, recentDigit, rises, falls, even, under, over, mean, volatility: Math.sqrt(variance), entropy, confidence, bias, edge, last: ticks[n - 1], streakEven: streak(d => d % 2 === 0), streakOdd: streak(d => d % 2 === 1), streakUnder: streak(d => d < barrier), streakOver: streak(d => d > barrier) };
    }, [ticks, barrier, group, selected]);

    const symbolLabel = SYMBOL_LABELS[symbol] || symbol;
    const groupLabel = GROUPS.find(g => g.value === group)?.label;

    return <div className='analysis-tool'>
        <header className='analysis-tool__hero'>
            <div><span className='analysis-tool__eyebrow'>DERIV MARKET INTELLIGENCE</span><h1>Analysis Tool</h1><p>Evidence-based contract screening across digits, direction, touch, range and multiplier markets.</p></div>
            <div className={`analysis-tool__live ${live ? 'is-live' : ''}`}><span />{live ? 'LIVE FEED' : 'CONNECTING'}</div>
        </header>
        <section className='analysis-tool__control-panel'>
            <div className='analysis-tool__field analysis-tool__field--wide'><label>Market / volatility</label><select value={symbol} onChange={e => setSymbol(e.target.value)}>{ALL_SYMBOLS.map(s => <option key={s} value={s}>{SYMBOL_LABELS[s] || s}</option>)}</select></div>
            <div className='analysis-tool__field'><label>Contract family</label><select value={group} onChange={e => setGroup(e.target.value as ContractGroup)}>{GROUPS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}</select></div>
            <div className='analysis-tool__field analysis-tool__field--wide'><label>Contract type</label><select value={contract} onChange={e => setContract(e.target.value)}>{contractsForGroup.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
            {selected.barrier && <div className='analysis-tool__field'><label>Barrier digit</label><select value={barrier} onChange={e => setBarrier(Number(e.target.value))}>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i}>{i}</option>)}</select></div>}
            <div className='analysis-tool__field'><label>Duration (ticks)</label><select value={duration} onChange={e => setDuration(Number(e.target.value))}>{[1, 2, 3, 5, 10].map(v => <option key={v} value={v}>{v} {v === 1 ? 'tick' : 'ticks'}</option>)}</select></div>
            <div className='analysis-tool__field'><label>Sample size</label><select value={tickCount} onChange={e => setTickCount(Number(e.target.value))}>{[100, 250, 500, 1000, 2500, 5000].map(v => <option key={v} value={v}>{v.toLocaleString()} ticks</option>)}</select></div>
            <div className='analysis-tool__field'><label>Risk / trade</label><select value={risk} onChange={e => setRisk(Number(e.target.value))}>{[0.25, 0.5, 1, 2, 3, 5].map(v => <option key={v} value={v}>{v}% of balance</option>)}</select></div>
            <button className='analysis-tool__refresh' type='button' onClick={load}>Refresh data</button>
        </section>
        <div className='analysis-tool__contract-note'><strong>{selected.label}</strong><span>{selected.description}</span><em>{groupLabel} · {symbolLabel} · {duration} tick{duration === 1 ? '' : 's'}</em></div>
        <main className='analysis-tool__grid'>
            <section className={`analysis-tool__signal-card ${metrics?.edge ? 'is-actionable' : ''}`}><div className='analysis-tool__card-kicker'>SCREENING RESULT</div><div className='analysis-tool__signal-row'><div><h2>{metrics?.bias || 'Waiting for data'}</h2><p>{metrics?.edge ? 'Conditions align with the selected contract.' : 'No strong statistical edge detected yet.'}</p></div><div className='analysis-tool__score'>{metrics ? `${metrics.confidence}%` : '—'}<small>confidence</small></div></div><div className='analysis-tool__meter'><span style={{ width: `${metrics?.confidence || 0}%` }} /></div><div className='analysis-tool__signal-foot'><span>Suggested risk: <b>{risk}%</b></span><span>Data: <b>{metrics?.n || 0} ticks</b></span><span>{status}</span></div></section>
            <section className='analysis-tool__card'><div className='analysis-tool__card-kicker'>MARKET SNAPSHOT</div><div className='analysis-tool__stats'>{[['Last quote', metrics?.last?.quote || '—'], ['Digit mode', metrics ? String(metrics.dominantDigit) : '—'], ['Recent mode', metrics ? String(metrics.recentDigit) : '—'], ['Volatility', metrics ? metrics.volatility.toFixed(5) : '—'], ['Entropy', metrics ? `${metrics.entropy.toFixed(2)} / 3.32` : '—'], ['Live status', live ? 'Streaming' : 'Waiting']].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></section>
            <section className='analysis-tool__card analysis-tool__card--wide'><div className='analysis-tool__card-title'><div><div className='analysis-tool__card-kicker'>DIGIT DISTRIBUTION</div><h3>Observed last-digit frequency</h3></div><span>Fair baseline: 10%</span></div><div className='analysis-tool__digit-grid'>{metrics ? metrics.freq.map((count, digit) => <div className={`analysis-tool__digit ${digit === metrics.dominantDigit ? 'is-top' : ''}`} key={digit}><div className='analysis-tool__digit-head'><b>{digit}</b><span>{((count / metrics.n) * 100).toFixed(1)}%</span></div><div className='analysis-tool__digit-track'><i style={{ height: `${Math.max(5, (count / Math.max(...metrics.freq)) * 100)}%` }} /></div><small>{count}</small></div>) : <div className='analysis-tool__empty'>Refresh data to calculate the distribution.</div>}</div></section>
            <section className='analysis-tool__card'><div className='analysis-tool__card-kicker'>DIRECTIONAL PRESSURE</div><h3>Rise / Fall balance</h3><div className='analysis-tool__duo'><div><b>{metrics ? `${((metrics.rises / Math.max(metrics.rises + metrics.falls, 1)) * 100).toFixed(1)}%` : '—'}</b><span>Rise</span></div><div><b>{metrics ? `${((metrics.falls / Math.max(metrics.rises + metrics.falls, 1)) * 100).toFixed(1)}%` : '—'}</b><span>Fall</span></div></div><div className='analysis-tool__split'><span style={{ width: `${metrics ? (metrics.rises / Math.max(metrics.rises + metrics.falls, 1)) * 100 : 50}%` }} /><i /></div><p className='analysis-tool__muted'>Momentum is descriptive, not predictive. Confirm with the selected contract’s payout and barrier distance.</p></section>
            <section className='analysis-tool__card'><div className='analysis-tool__card-kicker'>TRADE PLAN</div><h3>Execution guardrails</h3><ul className='analysis-tool__checklist'><li><span>1</span>Use a fixed stake capped at <b>{risk}%</b> of balance.</li><li><span>2</span>Skip when confidence is below <b>68%</b> or the signal says WAIT.</li><li><span>3</span>Do not increase stake after a loss; reassess after fresh ticks.</li><li><span>4</span>Stop the session after a pre-set daily loss limit.</li></ul></section>
        </main>
        <footer className='analysis-tool__disclaimer'><strong>Risk notice</strong><span>This tool surfaces statistical conditions from recent ticks; it cannot guarantee profit or predict the next contract. Payout, spread, latency and market randomness can erase any apparent edge. Test on demo and use a hard loss limit.</span></footer>
    </div>;
};

export default AnalysisTool;
