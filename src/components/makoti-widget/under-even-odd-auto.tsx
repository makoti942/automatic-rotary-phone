import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_SYMBOLS, PIP_SIZES, SYMBOL_LABELS } from './makoti-ws';
import { onNewSystemMessage, sendViaNewSystemWithPromise } from '@/auth/NewDerivAuth';
import { useStore } from '@/hooks/useStore';

type Phase = 'idle' | 'entry' | 'normal' | 'scanning' | 'pattern' | 'settling';
type Side = 'even' | 'odd';
interface OpenTrade { symbol: string; stake: number; kind: 'under' | 'parity'; contract: string; }
interface RecoveryPick { symbol: string; side: Side; evenPct: number; oddPct: number; trailingOpposite: number; lastEpoch?: number; }
const SYMBOLS = Array.from(new Set([...ALL_SYMBOLS, '1HZ15V', '1HZ30V', '1HZ90V', '1HZ150V', '1HZ200V', '1HZ250V', '1HZ300V']));
const BASE = { stake: '0.35', entryDigit: '2' };
const isEven = (d: number) => d % 2 === 0;
const digitOf = (quote: number, symbol: string) => Number(Number(quote).toFixed(PIP_SIZES[symbol] || 2).slice(-1));

export const UnderEvenOddAuto: React.FC = () => {
    const { transactions } = useStore();
    const [stake, setStake] = useState(() => localStorage.getItem('mw_ueo_stake') || BASE.stake);
    const [entryDigit, setEntryDigit] = useState(() => localStorage.getItem('mw_ueo_entry') || BASE.entryDigit);
    const [running, setRunning] = useState(false);
    const [phase, setPhase] = useState<Phase>('idle');
    const [normalCount, setNormalCount] = useState(0);
    const [selected, setSelected] = useState<RecoveryPick | null>(null);
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const [evenPct, setEvenPct] = useState(0);
    const [oddPct, setOddPct] = useState(0);
    const [lossBalance, setLossBalance] = useState(0);
    const [currentStake, setCurrentStake] = useState(Number(stake) || 0.35);
    const [logs, setLogs] = useState<string[]>([]);
    const runningRef = useRef(false);
    const phaseRef = useRef<Phase>('idle');
    const normalSymbolRef = useRef('1HZ25V');
    const stakeRef = useRef(Number(stake) || 0.35);
    const normalStartedRef = useRef(false);
    const normalCountRef = useRef(0);
    const lossRef = useRef(0);
    const currentStakeRef = useRef(Number(stake) || 0.35);
    const entryDigitRef = useRef(Number(entryDigit) || 2);
    const selectedRef = useRef<RecoveryPick | null>(null);
    const buffersRef = useRef<Record<string, number[]>>({});
    const openRef = useRef<Map<string, OpenTrade>>(new Map());
    const oppositeRef = useRef(0);
    const lastEpochRef = useRef<number | undefined>();
    const scanRunningRef = useRef(false);
    const addLog = useCallback((message: string) => {
        const line = `${new Date().toLocaleTimeString()} ${message}`;
        setLogs(prev => [...prev.slice(-119), line]);
    }, []);
    const setPhaseSafe = useCallback((next: Phase) => { phaseRef.current = next; setPhase(next); }, []);
    const notify = useCallback((message: string) => {
        addLog(message);
        try { window.dispatchEvent(new CustomEvent('makoti:notification', { detail: message })); } catch {}
    }, [addLog]);
    const sendTickSubscription = useCallback((symbol: string, count = 200) => {
        if (window._newSystemWS?.readyState === WebSocket.OPEN) {
            window._newSystemWS.send(JSON.stringify({ ticks_history: symbol, count, end: 'latest', style: 'ticks', subscribe: 1 }));
        }
    }, []);
    const updateBuffer = useCallback((symbol: string, prices: any[]) => {
        const digits = prices.map(Number).filter(Number.isFinite).map(price => digitOf(price, symbol));
        if (!digits.length) return;
        const old = buffersRef.current[symbol] || [];
        buffersRef.current[symbol] = [...old, ...digits].slice(-200);
    }, []);
    const recoveryStake = useCallback((loss: number) => {
        if (loss <= 0) return Number(stake) || 0.35;
        // Conservative default net payout assumption for parity contracts.
        return Math.max(0.35, Math.ceil((loss / 0.95) * 100) / 100);
    }, [stake]);
    const scanRecovery = useCallback(async () => {
        if (!runningRef.current || scanRunningRef.current) return;
        scanRunningRef.current = true;
        setPhaseSafe('scanning');
        notify(`RECOVERY SCAN: requesting 200 ticks from ${SYMBOLS.length} volatility indices`);
        try {
            const samples = await Promise.all(SYMBOLS.map(async symbol => {
                try {
                    const response: any = await sendViaNewSystemWithPromise({ ticks_history: symbol, count: 200, end: 'latest', style: 'ticks' });
                    const prices = response?.history?.prices || [];
                    updateBuffer(symbol, prices);
                    const digits = prices.slice(-100).map(Number).filter(Number.isFinite).map((p: number) => digitOf(p, symbol));
                    if (digits.length < 100) return null;
                    const evens = digits.filter(isEven).length;
                    const ep = evens / digits.length * 100;
                    const op = 100 - ep;
                    const side: Side = ep >= op ? 'even' : 'odd';
                    const target = side === 'even' ? isEven : (d: number) => !isEven(d);
                    let trailingOpposite = 0;
                    for (let i = digits.length - 1; i >= 0 && !target(digits[i]); i--) trailingOpposite++;
                    return { symbol, side, evenPct: ep, oddPct: op, trailingOpposite, lastEpoch: response?.history?.times?.at(-1) } as RecoveryPick;
                } catch { return null; }
            }));
            const usable = samples.filter(Boolean) as RecoveryPick[];
            if (!usable.length) { notify('RECOVERY SCAN: no index returned 100 usable ticks; retrying'); return; }
            usable.sort((a, b) => Math.max(b.evenPct, b.oddPct) - Math.max(a.evenPct, a.oddPct));
            const best = usable.find(x => Math.max(x.evenPct, x.oddPct) >= 60) || usable.sort((a, b) => Math.abs(Math.max(a.evenPct, a.oddPct) - 60) - Math.abs(Math.max(b.evenPct, b.oddPct) - 60))[0];
            selectedRef.current = best;
            setSelected(best);
            oppositeRef.current = best.trailingOpposite;
            lastEpochRef.current = best.lastEpoch;
            sendTickSubscription(best.symbol, 200);
            setPhaseSafe('pattern');
            const target = best.side.toUpperCase();
            notify(`RECOVERY SELECTED ${SYMBOL_LABELS[best.symbol] || best.symbol}: ${target} | even ${best.evenPct.toFixed(1)}% / odd ${best.oddPct.toFixed(1)}% | opposite streak ${oppositeRef.current}`);
        } finally { scanRunningRef.current = false; }
    }, [notify, sendTickSubscription, setPhaseSafe, updateBuffer]);
    const buy = useCallback(async (symbol: string, contract: string, amount: number, kind: OpenTrade['kind']) => {
        if (!runningRef.current || phaseRef.current === 'settling') return;
        setPhaseSafe('settling');
        const underBarrier = normalStartedRef.current ? '8' : '7';
        const label = contract === 'DIGITEVEN' ? 'EVEN' : contract === 'DIGITODD' ? 'ODD' : `UNDER ${contract === 'DIGITUNDER' ? underBarrier : ''}`;
        notify(`TRADE ${label} on ${SYMBOL_LABELS[symbol] || symbol} | stake $${amount.toFixed(2)}`);
        try {
            const response: any = await sendViaNewSystemWithPromise({ buy: 1, price: amount, parameters: { amount, basis: 'stake', currency: 'USD', duration: 1, duration_unit: 't', symbol, contract_type: contract, ...(contract === 'DIGITUNDER' ? { barrier: underBarrier } : {}) } });
            const cid = response?.buy?.contract_id ?? response?.contract_id;
            if (!cid) throw new Error('no contract id');
            if (kind === 'under') normalStartedRef.current = true;
            openRef.current.set(String(cid), { symbol, stake: amount, kind, contract });
            try { transactions.onBotContractEvent({ contract_id: cid, transaction_ids: { buy: response?.buy?.transaction_id }, buy_price: amount, currency: 'USD', contract_type: contract, underlying: symbol, display_name: SYMBOL_LABELS[symbol] || symbol, date_start: Math.floor(Date.now() / 1000), status: 'open' } as any); } catch {}
        } catch (error: any) {
            notify(`BUY ERROR: ${error?.error?.message || error?.message || 'request failed'}`);
            setPhaseSafe(kind === 'parity' ? 'pattern' : 'normal');
        }
    }, [notify, setPhaseSafe, transactions]);
    const handleSettled = useCallback((trade: OpenTrade, profit: number) => {
        const won = profit >= 0;
        notify(`${won ? 'WIN' : 'LOSS'} ${trade.contract} ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`);
        if (won) {
            if (trade.kind === 'parity') {
                const remaining = Math.max(0, lossRef.current - profit);
                lossRef.current = remaining; setLossBalance(remaining);
                if (remaining <= 0.0001) { notify('RECOVERY COMPLETE — returning to normal Under 8'); selectedRef.current = null; setSelected(null); currentStakeRef.current = Number(stakeRef.current) || 0.35; setCurrentStake(currentStakeRef.current); setPhaseSafe('normal'); }
                else { currentStakeRef.current = recoveryStake(remaining); setCurrentStake(currentStakeRef.current); setPhaseSafe('pattern'); }
            } else { normalCountRef.current++; setNormalCount(normalCountRef.current); currentStakeRef.current = Number(stakeRef.current) || 0.35; setCurrentStake(currentStakeRef.current); setPhaseSafe('normal'); }
        } else {
            const loss = Math.max(trade.stake, Math.abs(profit));
            lossRef.current += loss; setLossBalance(lossRef.current);
            currentStakeRef.current = recoveryStake(lossRef.current); setCurrentStake(currentStakeRef.current);
            notify(`RECOVERY ACTIVATED | balance $${lossRef.current.toFixed(2)} | next calculated stake $${currentStakeRef.current.toFixed(2)}`);
            void scanRecovery();
        }
    }, [notify, recoveryStake, scanRecovery, setPhaseSafe]);
    useEffect(() => {
        if (!running) return;
        const unsubscribe = onNewSystemMessage((event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.msg_type === 'ticks_history' && data.history?.prices) updateBuffer(data.echo_req?.ticks_history, data.history.prices);
                if (data.msg_type === 'tick' && data.tick?.symbol) {
                    const sym = data.tick.symbol; const digit = digitOf(Number(data.tick.quote), sym); const buf = buffersRef.current[sym] || [];
                    buffersRef.current[sym] = [...buf, digit].slice(-200);
                    if (sym === normalSymbolRef.current) setLastDigit(digit);
                    if (sym === selectedRef.current?.symbol) {
                        const pick = selectedRef.current; const target = pick.side === 'even' ? isEven(digit) : !isEven(digit);
                        const ds = buffersRef.current[sym].slice(-100); const ep = ds.filter(isEven).length / Math.max(1, ds.length) * 100;
                        setEvenPct(ep); setOddPct(100 - ep);
                        if (phaseRef.current === 'pattern') {
                            if (target) { if (oppositeRef.current >= 3) { oppositeRef.current = 0; void buy(sym, pick.side === 'even' ? 'DIGITEVEN' : 'DIGITODD', currentStakeRef.current, 'parity'); } else oppositeRef.current = 0; }
                            else { oppositeRef.current++; notify(`RECOVERY TICK ${digit} | even ${ep.toFixed(1)}% / odd ${(100 - ep).toFixed(1)}% | opposite ${oppositeRef.current}/3`); }
                        }
                    }
                    if (phaseRef.current === 'entry' && sym === normalSymbolRef.current && digit === entryDigitRef.current) { notify(`ENTRY DIGIT ${digit} CONFIRMED — Under 7`); void buy(sym, 'DIGITUNDER', currentStakeRef.current, 'under'); }
                }
                if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract?.is_sold) {
                    const cid = String(data.proposal_open_contract.contract_id); const trade = openRef.current.get(cid); if (!trade) return;
                    openRef.current.delete(cid); handleSettled(trade, Number(data.proposal_open_contract.profit) || 0);
                }
            } catch {}
        });
        return unsubscribe;
    }, [buy, handleSettled, notify, running, updateBuffer]);
    useEffect(() => { if (running) SYMBOLS.forEach(s => sendTickSubscription(s, 200)); }, [running, sendTickSubscription]);
    useEffect(() => { localStorage.setItem('mw_ueo_stake', stake); localStorage.setItem('mw_ueo_entry', entryDigit); }, [stake, entryDigit]);
    useEffect(() => {
        if (!running || phase !== 'normal') return;
        const timer = setTimeout(() => { if (runningRef.current) void buy(normalSymbolRef.current, 'DIGITUNDER', currentStakeRef.current, 'under'); }, 250);
        return () => clearTimeout(timer);
    }, [normalCount, phase, running, buy]);
    const start = () => {
        const amount = Math.max(0.35, Number(stake) || 0.35); stakeRef.current = amount; entryDigitRef.current = Math.min(9, Math.max(0, Number(entryDigit) || 2));
        normalSymbolRef.current = '1HZ25V'; normalStartedRef.current = false; normalCountRef.current = 0; lossRef.current = 0; currentStakeRef.current = amount; buffersRef.current = {}; openRef.current.clear(); selectedRef.current = null; oppositeRef.current = 0;
        setNormalCount(0); setLossBalance(0); setCurrentStake(amount); setSelected(null); setLastDigit(null); runningRef.current = true; setRunning(true); setPhaseSafe('entry'); notify(`STARTED — waiting for entry digit ${entryDigitRef.current} on ${SYMBOL_LABELS['1HZ25V']}; then Under 7 → Under 8`);
    };
    const stop = () => { runningRef.current = false; setRunning(false); setPhaseSafe('idle'); openRef.current.clear(); selectedRef.current = null; setSelected(null); notify('STOPPED'); };
    return <div className='mw-killer even-odd-theme'>
        <div className='mw-killer__fields'><div className='mw-field mw-field--grow'><label className='mw-label'>Initial stake</label><input className='mw-input' type='number' min='0.35' step='0.01' value={stake} onChange={e => setStake(e.target.value)} disabled={running} /></div><div className='mw-field mw-field--grow'><label className='mw-label'>Entry digit</label><input className='mw-input' type='number' min='0' max='9' step='1' value={entryDigit} onChange={e => setEntryDigit(e.target.value)} disabled={running} /></div></div>
        <div className='mw-analyze-result' style={{ display: 'block' }}><b>UNDER → EVEN/ODD AUTO</b><div>Phase: <strong>{phase}</strong> · Normal trades: {normalCount} · Recovery balance: ${lossBalance.toFixed(2)}</div><div>Last digit: {lastDigit ?? '—'} · Stake: ${currentStake.toFixed(2)}</div>{selected && <div>{SYMBOL_LABELS[selected.symbol] || selected.symbol}: Even {evenPct.toFixed(1)}% / Odd {oddPct.toFixed(1)}% · Target: {selected.side.toUpperCase()}</div>}</div>
        <div className='mw-killer__actions'>{running ? <button className='mw-btn mw-btn--stop' onClick={stop}>STOP · {phase.toUpperCase()}</button> : <button className='mw-btn mw-btn--run' onClick={start}>RUN UNDER → EVEN/ODD</button>}</div>
        <div className='mw-killer__logs'><div className='mw-killer__logs-head'>Automation log</div><div className='mw-killer__log-list'>{logs.length ? logs.map((line, i) => <div key={i} className='mw-killer__log-line'>{line}</div>) : <div className='mw-killer__log-empty'>Configure the entry digit and run</div>}</div></div>
    </div>;
};
