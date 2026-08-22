import { useState, useRef, useCallback, useEffect } from 'react';
import { onNewSystemMessage, sendViaNewSystem } from '@/auth/NewDerivAuth';
import {
    VOLATILITY_LIST, computeSymbolStats, requestAiPlan,
    AiPlan, SymbolStats, volPipSize, VolatilitySymbol,
} from './ai-analyst';

export type AiPhase = 'idle' | 'collecting' | 'analyzing' | 'ready' | 'running' | 'error';

interface RunState {
    pnl: number;
    trades: number;
    wins: number;
    losses: number;
    openId: number | null;
}

const MAX_LOGS = 250;

export function useAiAnalyst() {
    const [open, setOpen] = useState(false);
    const [apiKey, setApiKeyState] = useState(() => localStorage.getItem('makoti_ai_key') ?? '');
    const [stake, setStake] = useState('1');
    const [takeProfit, setTakeProfit] = useState('5');
    const [stopLoss, setStopLoss] = useState('5');
    const [phase, setPhase] = useState<AiPhase>('idle');
    const [progress, setProgress] = useState('');
    const [logs, setLogs] = useState<string[]>([]);
    const [plan, setPlan] = useState<AiPlan | null>(null);
    const [run, setRun] = useState<RunState>({ pnl: 0, trades: 0, wins: 0, losses: 0, openId: null });

    const mountedRef = useRef(true);
    const reqCounter = useRef(0);
    const tickSubId = useRef<string | null>(null);
    const liveDigits = useRef<number[]>([]);
    const runStateRef = useRef<RunState>({ ...run });
    const planRef = useRef<AiPlan | null>(null);
    const stakeRef = useRef(0);
    const tpRef = useRef(0);
    const slRef = useRef(0);
    const busyTrade = useRef(false);
    const stopRequested = useRef(false);
    const phaseRef = useRef<AiPhase>(phase);

    const log = useCallback((msg: string) => {
        if (!mountedRef.current) return;
        const ts = new Date().toLocaleTimeString([], { hour12: false });
        setLogs(prev => [...prev.slice(-(MAX_LOGS - 1)), `[${ts}] ${msg}`]);
    }, []);

    const setApiKey = useCallback((key: string) => {
        setApiKeyState(key);
        localStorage.setItem('makoti_ai_key', key);
    }, []);

    /**
     * Strict request helper: resolves ONLY on exact req_id match (never on
     * msg_type), so concurrent/foreign traffic on the shared socket can never
     * cross-resolve. Times out after `timeoutMs`.
     */
    const request = useCallback(<T = any,>(msg: Record<string, unknown>, timeoutMs = 20000): Promise<T> => {
        return new Promise((resolve, reject) => {
            const reqId = Date.now() * 100 + (++reqCounter.current % 100);
            let done = false;
            const handler = (event: MessageEvent) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.req_id !== reqId || done) return;
                    done = true;
                    window.removeEventListener('newSystemMessage', handler);
                    if (data.error) reject(new Error(data.error.message ?? 'Request failed'));
                    else resolve(data as T);
                } catch (_) { /* ignore unparsable */ }
            };
            window.addEventListener('newSystemMessage', handler);
            sendViaNewSystem({ ...msg, req_id: reqId });
            setTimeout(() => {
                if (!done) {
                    done = true;
                    window.removeEventListener('newSystemMessage', handler);
                    reject(new Error(`Timeout waiting for ${Object.keys(msg)[0]} response`));
                }
            }, timeoutMs);
        });
    }, []);

    // ── ANALYZE ─────────────────────────────────────────────────────────
    const analyze = useCallback(async () => {
        if (phase === 'collecting' || phase === 'analyzing') return;
        if (!apiKey.trim()) {
            setPhase('error');
            setProgress('Add your Gemini API key first.');
            return;
        }
        try {
            setPhase('collecting');
            setProgress('Loading 1000 ticks per market…');
            log(`Collecting ${VOLATILITY_LIST.length} × 1000 ticks…`);
            const stats: SymbolStats[] = [];
            for (let i = 0; i < VOLATILITY_LIST.length; i++) {
                const sym = VOLATILITY_LIST[i];
                setProgress(`Loading ${sym} (${i + 1}/${VOLATILITY_LIST.length})…`);
                const res: any = await request({
                    ticks_history: sym, count: 1000, end: 'latest', style: 'ticks',
                });
                const prices: number[] = (res?.history?.prices ?? []).map(Number).filter(Number.isFinite);
                if (prices.length < 100) throw new Error(`${sym}: only ${prices.length} ticks returned`);
                stats.push(computeSymbolStats(sym, prices));
                log(`${sym}: ${prices.length} ticks analysed.`);
            }
            setPhase('analyzing');
            setProgress('Gemini is breaking down the data…');
            log('Sending digest to Gemini for strategy selection…');
            const p = await requestAiPlan(apiKey.trim(), stats);
            planRef.current = p;
            setPlan(p);
            setPhase('ready');
            setProgress('');
            log(`PLAN → ${p.market} ${p.contract_type}${p.barrier_digit != null ? ` ${p.barrier_digit}` : ''} · ${p.duration_ticks}t · trigger=${p.entry_trigger.type}:${p.entry_trigger.digit}${p.entry_trigger.min_gap ? `+gap${p.entry_trigger.min_gap}` : ''} · confidence ${p.confidence}%`);
            log(p.rationale);
        } catch (e: any) {
            if (!mountedRef.current) return;
            setPhase('error');
            setProgress(e?.message ?? 'Analysis failed.');
            log(`ERROR: ${e?.message ?? 'Analysis failed.'}`);
        }
    }, [apiKey, phase, request, log]);

    // ── RUN ENGINE ──────────────────────────────────────────────────────
    const settleAndContinue = useCallback(async (contractId: number, profit: number) => {
        const rs = runStateRef.current;
        rs.openId = null;
        rs.pnl += profit;
        rs.trades += 1;
        if (profit >= 0) rs.wins += 1; else rs.losses += 1;
        setRun({ ...rs });
        log(`Settled #${contractId}: ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} USD · session ${rs.pnl >= 0 ? '+' : ''}${rs.pnl.toFixed(2)} (${rs.wins}W/${rs.losses}L)`);

        if (stopRequested.current) { stopRun('Stopped by user.'); return; }
        if (tpRef.current > 0 && rs.pnl >= tpRef.current) { stopRun(`Take profit reached (+${rs.pnl.toFixed(2)}).`); return; }
        if (slRef.current > 0 && rs.pnl <= -slRef.current) { stopRun(`Stop loss hit (${rs.pnl.toFixed(2)}).`); return; }

        void maybeFire(); // look for the next entry right away
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const executeTrade = useCallback(async () => {
        const p = planRef.current;
        const rs = runStateRef.current;
        if (!p || rs.openId !== null || busyTrade.current || stopRequested.current) return;
        busyTrade.current = true;
        try {
            const amount = stakeRef.current;
            const params: any = {
                proposal: 1, amount, basis: 'stake',
                contract_type: p.contract_type, currency: 'USD',
                duration: p.duration_ticks, duration_unit: 't', symbol: p.market,
            };
            if (p.barrier_digit != null) params.barrier = p.barrier_digit;
            const propRes: any = await request(params);
            const prop = propRes?.proposal;
            if (!prop?.id) throw new Error(propRes?.error?.message ?? 'No proposal');
            const buyRes: any = await request({ buy: prop.id, price: prop.ask_price });
            if (!buyRes?.buy) throw new Error(buyRes?.error?.message ?? 'Buy failed');
            rs.openId = buyRes.buy.contract_id;
            setRun({ ...rs });
            log(`TRADE #${rs.openId} · ${p.contract_type}${p.barrier_digit != null ? ` ${p.barrier_digit}` : ''} · $${amount.toFixed(2)} · ${p.duration_ticks}t`);
        } catch (e: any) {
            log(`Trade error: ${e?.message ?? 'unknown'} — retrying on next signal.`);
        } finally {
            busyTrade.current = false;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [request, log]);

    /** Checks the current live digit stream against the plan's entry trigger. */
    const maybeFire = useCallback(() => {
        const p = planRef.current;
        const rs = runStateRef.current;
        if (!p || rs.openId !== null || busyTrade.current || stopRequested.current) return;
        if (liveDigits.current.length === 0) return;
        const t = p.entry_trigger;
        if (t.type === 'immediate') { void executeTrade(); return; }
        if (t.type === 'last_digit_equals') {
            if (liveDigits.current[liveDigits.current.length - 1] === t.digit) void executeTrade();
            return;
        }
        // gap_reached: how many ticks since `digit` last appeared
        let gap = 0;
        for (let i = liveDigits.current.length - 1; i >= 0; i--) {
            if (liveDigits.current[i] === t.digit) break;
            gap++;
        }
        if (gap >= t.min_gap && gap > 0) void executeTrade();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [executeTrade]);

    const stopRun = useCallback((reason?: string) => {
        stopRequested.current = true;
        if (tickSubId.current) {
            sendViaNewSystem({ forget: tickSubId.current });
            tickSubId.current = null;
        }
        runStateRef.current.openId = null;
        busyTrade.current = false;
        if (mountedRef.current) {
            setPhase('ready');
            setProgress('');
            log(reason ? `RUN STOPPED — ${reason}` : 'RUN STOPPED.');
        }
    }, [log]);

    const startRun = useCallback(async () => {
        const p = planRef.current;
        if (!p || phase === 'running') return;
        const amt = parseFloat(stake);
        if (!amt || amt <= 0) { log('Enter a valid stake before running.'); return; }
        stakeRef.current = amt;
        tpRef.current = parseFloat(takeProfit) || 0;
        slRef.current = parseFloat(stopLoss) || 0;

        stopRequested.current = false;
        busyTrade.current = false;
        runStateRef.current = { pnl: 0, trades: 0, wins: 0, losses: 0, openId: null };
        setRun({ ...runStateRef.current });

        try {
            setPhase('running');
            log(`RUN started → watching ${p.market} for trigger "${p.entry_trigger.type}" (digit ${p.entry_trigger.digit}${p.entry_trigger.min_gap ? `, min gap ${p.entry_trigger.min_gap}` : ''}). TP ${tpRef.current || '∞'} / SL ${slRef.current || '∞'}.`);

            // Seed gaps + own live stream for the chosen market
            const res: any = await request({
                ticks_history: p.market, count: 1500, end: 'latest', style: 'ticks', subscribe: 1,
            });
            const pip = volPipSize(p.market);
            const digitsOf = (v: number) => Number(Number(v).toFixed(pip).slice(-1));
            const prices: number[] = (res?.history?.prices ?? []).map(Number).filter(Number.isFinite);
            liveDigits.current = prices.map(digitsOf);
            if (res?.subscription?.id) tickSubId.current = res.subscription.id;
            log(`${p.market} stream armed with ${liveDigits.current.length} seeded ticks.`);

            void maybeFire();
        } catch (e: any) {
            log(`Run failed to start: ${e?.message}`);
            stopRun('Start failure.');
        }
    }, [phase, stake, takeProfit, stopLoss, request, log, maybeFire, stopRun]);

    // Global listener: live ticks for the running market + settlements of OUR contracts
    useEffect(() => {
        mountedRef.current = true;
        const unsub = onNewSystemMessage((event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                const p = planRef.current;
                if (data.msg_type === 'tick' && data.tick && phaseRef.current === 'running' && p) {
                    if (data.tick.symbol !== p.market) return;
                    const pip = volPipSize(p.market as VolatilitySymbol);
                    const d = Number(Number(data.tick.quote).toFixed(pip).slice(-1));
                    if (d >= 0 && d <= 9) {
                        liveDigits.current.push(d);
                        if (liveDigits.current.length > 3000) liveDigits.current.shift();
                        void maybeFire();
                    }
                    return;
                }
                if (data.msg_type === 'proposal_open_contract') {
                    const list = Array.isArray(data.proposal_open_contract)
                        ? data.proposal_open_contract
                        : [data.proposal_open_contract];
                    list.forEach((poc: any) => {
                        const oid = runStateRef.current.openId;
                        if (oid && poc.contract_id === oid && poc.is_sold) {
                            void settleAndContinue(Number(poc.contract_id), Number(poc.profit ?? 0));
                        }
                    });
                }
            } catch (_) { /* ignore */ }
        });
        return () => { unsub(); mountedRef.current = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // phaseRef mirrors state for use inside stable listener
    useEffect(() => { phaseRef.current = phase; }, [phase]);

    // Cleanup subscription on unmount
    useEffect(() => () => {
        if (tickSubId.current) sendViaNewSystem({ forget: tickSubId.current });
    }, []);

    return {
        open, setOpen,
        apiKey, setApiKey,
        stake, setStake, takeProfit, setTakeProfit, stopLoss, setStopLoss,
        phase, progress, logs, plan, run,
        analyze, startRun, stopRun: () => stopRun(),
    };
}
