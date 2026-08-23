import { useState, useRef, useCallback, useEffect } from 'react';
import { onNewSystemMessage, sendViaNewSystem } from '@/auth/NewDerivAuth';
import { observer } from '@/external/bot-skeleton/utils/observer';
import {
    VOLATILITY_LIST, computeSymbolStats, requestAiPlan,
    AiPlan, SymbolStats, volPipSize, VolatilitySymbol, AiFocus,
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
    const [stake, setStake] = useState('1');
    const [takeProfit, setTakeProfit] = useState('5');
    const [stopLoss, setStopLoss] = useState('5');
    const [focusType, setFocusType] = useState<AiFocus>('auto');
    const focusRef = useRef<AiFocus>('auto');
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
    const analyzingRef = useRef(false);
    const tradesSinceRefresh = useRef(0);
    const consecutiveLosses = useRef(0);
    const lastRefreshAt = useRef(0);
    const lastAiCallAt = useRef(0);
    // Groq free tier: keep ≥15s between AI calls so repeated Analyze runs
    // never trip the per-minute token/request limits.
    const AI_COOLDOWN_MS = 15000;

    const log = useCallback((msg: string) => {
        if (!mountedRef.current) return;
        const ts = new Date().toLocaleTimeString([], { hour12: false });
        setLogs(prev => [...prev.slice(-(MAX_LOGS - 1)), `[${ts}] ${msg}`]);
        // Push to the app-wide Journal via the established event bus.
        try { observer.emit('ui.log.notify', { message: `[AI] ${msg}`, sound: undefined }); } catch (_) {}
    }, []);

    /**
     * Strict request helper — resolves ONLY when the response echoes OUR
     * req_id back via echo_req (the same field the manual-trade bulk loader
     * matches on; the relay does not reliably return a top-level req_id).
     * Never matches on msg_type, so concurrent fetches can't cross-resolve.
     */
    const request = useCallback(<T = any,>(msg: Record<string, unknown>, timeoutMs = 20000): Promise<T> => {
        return new Promise((resolve, reject) => {
            const reqId = Date.now() * 100 + (++reqCounter.current % 100);
            let done = false;
            const handler = (event: any) => {
                try {
                    // The relay dispatches CustomEvent({detail: <raw MessageEvent>}),
                    // so the payload string lives at event.detail.data.
                    const data = JSON.parse(event.detail.data);
                    const echoed = data?.echo_req?.req_id ?? data?.req_id;
                    if (echoed !== reqId || done) return;
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
    /** Shared evidence collection used by both Analyze and live re-planning. */
    const collectStats = useCallback(async (onProgress?: (s: string) => void): Promise<SymbolStats[]> => {
        const fetchWithRetry = async (sym: VolatilitySymbol): Promise<any> => {
            let lastErr: any;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    return await request(
                        { ticks_history: sym, count: 1000, end: 'latest', style: 'ticks' },
                        12000,
                    );
                } catch (e: any) {
                    lastErr = e;
                    if (attempt < 3) {
                        log(`${sym} attempt ${attempt} failed (${e?.message ?? 'error'}) — retrying…`);
                        await new Promise(r => setTimeout(r, 400));
                    }
                }
            }
            throw new Error(`${sym}: ${lastErr?.message ?? 'fetch failed'}`);
        };
        const stats: SymbolStats[] = [];
        const BATCH = 5;
        for (let i = 0; i < VOLATILITY_LIST.length; i += BATCH) {
            const slice = VOLATILITY_LIST.slice(i, i + BATCH);
            onProgress?.(`Loading ${slice.join(', ')}…`);
            const results = await Promise.all(slice.map(sym => fetchWithRetry(sym)));
            results.forEach((res: any, j: number) => {
                const prices: number[] = (res?.history?.prices ?? []).map(Number).filter(Number.isFinite);
                if (prices.length < 100) throw new Error(`${slice[j]}: only ${prices.length} ticks returned`);
                stats.push(computeSymbolStats(slice[j], prices));
            });
        }
        return stats;
    }, [request, log]);

    const analyze = useCallback(async () => {
        if (phase === 'collecting' || phase === 'analyzing') return;
        const since = Date.now() - lastAiCallAt.current;
        if (since < AI_COOLDOWN_MS) {
            const wait = Math.ceil((AI_COOLDOWN_MS - since) / 1000);
            setProgress(`AI rate-limit cooldown — try again in ${wait}s.`);
            log(`Rate-limit guard: next AI call available in ${wait}s.`);
            return;
        }
        focusRef.current = focusType;
        try {
            // Clean slate: forget the previous plan and evidence entirely.
            planRef.current = null;
            setPlan(null);
            setPhase('collecting');
            setProgress('Loading 1000 ticks × 10 markets…');
            log(focusType === 'auto'
                ? 'Fresh collection — 10 × 1000 ticks (batches of 5, auto-retry)…'
                : `Fresh collection — 10 × 1000 ticks… (focus: ${focusType})`);
            const t0 = Date.now();

            const stats = await collectStats(s => mountedRef.current && setProgress(s));
            log(`All 10 markets analysed in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);

            setPhase('analyzing');
            setProgress('AI is cross-checking every pattern…');
            log('Sending full evidence digest to the AI backend…');
            lastAiCallAt.current = Date.now();
            const p = await requestAiPlan(stats, focusRef.current);
            planRef.current = p;
            setPlan(p);
            setPhase('ready');
            setProgress('');
            log(`DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s → PLAN: ${p.market} ${p.contract_type}${p.barrier_digit != null ? ` ${p.barrier_digit}` : ''} · ${p.duration_ticks}t · trigger=${p.entry_trigger.type}:${p.entry_trigger.digit}${p.entry_trigger.min_gap ? `+gap${p.entry_trigger.min_gap}` : ''} · confidence ${p.confidence}%`);
            log(p.rationale);
        } catch (e: any) {
            if (!mountedRef.current) return;
            setPhase('error');
            setProgress(e?.message ?? 'Analysis failed.');
            log(`ERROR: ${e?.message ?? 'Analysis failed.'}`);
        }
    }, [phase, focusType, request, log, collectStats]);

    // ── RUN ENGINE ──────────────────────────────────────────────────────
    /**
     * Live re-plan: after every few trades, after consecutive losses, or on a
     * timer, refetch fresh ticks and ask the AI for an updated strategy — the
     * runner never sticks to one stale signal.
     */
    const refreshPlan = useCallback(async (reason: string) => {
        if (analyzingRef.current || stopRequested.current) return;
        analyzingRef.current = true;
        try {
            log(`Re-planning (${reason}) — refreshing evidence…`);
            const stats = await collectStats();
            const p = await requestAiPlan(stats, focusRef.current);
            planRef.current = p;
            setPlan(p);
            tradesSinceRefresh.current = 0;
            lastRefreshAt.current = Date.now();
            log(`NEW PLAN → ${p.market} ${p.contract_type}${p.barrier_digit != null ? ` ${p.barrier_digit}` : ''} · ${p.duration_ticks}t · trigger=${p.entry_trigger.type}:${p.entry_trigger.digit}${p.entry_trigger.min_gap ? `+gap${p.entry_trigger.min_gap}` : ''} · confidence ${p.confidence}%`);
            log(p.rationale);
        } catch (e: any) {
            log(`Re-plan failed (${e?.message ?? 'unknown'}) — keeping current plan.`);
        } finally {
            analyzingRef.current = false;
        }
    }, [collectStats, log]);

    const settleAndContinue = useCallback(async (contractId: number, profit: number) => {
        const rs = runStateRef.current;
        // De-dupe: the sold push AND the poller may both report the same trade.
        if (rs.openId !== contractId) return;
        rs.openId = null;
        rs.pnl += profit;
        rs.trades += 1;
        tradesSinceRefresh.current += 1;
        if (profit >= 0) { rs.wins += 1; consecutiveLosses.current = 0; }
        else { rs.losses += 1; consecutiveLosses.current += 1; }
        setRun({ ...rs });
        log(`Settled #${contractId}: ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} USD · session ${rs.pnl >= 0 ? '+' : ''}${rs.pnl.toFixed(2)} (${rs.wins}W/${rs.losses}L)`);

        if (stopRequested.current) { stopRun('Stopped by user.'); return; }
        if (tpRef.current > 0 && rs.pnl >= tpRef.current) { stopRun(`Take profit reached (+${rs.pnl.toFixed(2)}).`); return; }
        if (slRef.current > 0 && rs.pnl <= -slRef.current) { stopRun(`Stop loss hit (${rs.pnl.toFixed(2)}).`); return; }

        // Adaptive loop: rotate signals based on fresh live data.
        if (profit < 0 && consecutiveLosses.current >= 2) {
            void refreshPlan('2 losses in a row — signal may be exhausted');
        } else if (profit >= 0) {
            // Re-analyze after every win: market is evolving, find the next edge.
            void refreshPlan('Win secured — finding next edge');
        } else if (tradesSinceRefresh.current >= 3) {
            void refreshPlan('3 trades on this plan');
        } else if (Date.now() - lastRefreshAt.current > 5 * 60 * 1000) {
            void refreshPlan('5 minutes elapsed');
        }

        void maybeFire(); // look for the next entry right away
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /**
     * Active settlement polling — the socket's single "sold" push can be
     * missed, leaving a 3-tick trade hanging forever. Poll every 3s until the
     * contract confirms as sold (or 2min give-up). Pushes still settle faster
     * when they arrive; this is the safety net.
     */
    const pollSettlement = useCallback((contractId: number) => {
        const started = Date.now();
        const timer = setInterval(async () => {
            if (!mountedRef.current || runStateRef.current.openId !== contractId) {
                clearInterval(timer);
                return;
            }
            if (Date.now() - started > 120000) {
                clearInterval(timer);
                if (runStateRef.current.openId === contractId) {
                    runStateRef.current.openId = null;
                    setRun({ ...runStateRef.current });
                    log(`#${contractId}: no settlement confirmation in 2 min — released tracking.`);
                    void maybeFire();
                }
                return;
            }
            try {
                const res: any = await request({ proposal_open_contract: 1, contract_id: contractId }, 8000);
                const poc = res?.proposal_open_contract;
                if (poc?.is_sold && runStateRef.current.openId === contractId) {
                    clearInterval(timer);
                    log(`#${contractId} settled via polling (${(Number(poc.profit) >= 0 ? '+' : '')}${Number(poc.profit).toFixed(2)}).`);
                    void settleAndContinue(contractId, Number(poc.profit ?? 0));
                }
            } catch (_) { /* transient — keep polling */ }
        }, 3000);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [request]);

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
            pollSettlement(rs.openId);
        } catch (e: any) {
            log(`Trade error: ${e?.message ?? 'unknown'} — retrying on next signal.`);
        } finally {
            busyTrade.current = false;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [request, log, pollSettlement]);

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
        analyzingRef.current = false;
        tradesSinceRefresh.current = 0;
        consecutiveLosses.current = 0;
        lastRefreshAt.current = Date.now();
        runStateRef.current = { pnl: 0, trades: 0, wins: 0, losses: 0, openId: null };
        setRun({ ...runStateRef.current });

        try {
            setPhase('running');
            log(`RUN started → watching ${p.market} for trigger "${p.entry_trigger.type}" (digit ${p.entry_trigger.digit}${p.entry_trigger.min_gap ? `, min gap ${p.entry_trigger.min_gap}` : ''}). TP ${tpRef.current || '∞'} / SL ${slRef.current || '∞'}.`);

            // Seed gaps from a plain history fetch (can never conflict with
            // another tab/component's subscription).
            const res: any = await request({
                ticks_history: p.market, count: 1500, end: 'latest', style: 'ticks',
            });
            const pip = volPipSize(p.market);
            const digitsOf = (v: number) => Number(Number(v).toFixed(pip).slice(-1));
            const prices: number[] = (res?.history?.prices ?? []).map(Number).filter(Number.isFinite);
            liveDigits.current = prices.map(digitsOf);

            // Own live stream on top; if something already streams this symbol,
            // share it passively instead of failing — pushes reach us anyway.
            try {
                const sub: any = await request(
                    { ticks_history: p.market, count: 1, end: 'latest', style: 'ticks', subscribe: 1 },
                    8000,
                );
                if (sub?.subscription?.id) tickSubId.current = sub.subscription.id;
            } catch (e: any) {
                if (/already/i.test(e?.message ?? '')) {
                    log(`${p.market}: sharing an existing live stream (already subscribed).`);
                } else {
                    throw e;
                }
            }
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

    // Auto-analyze when the panel is first opened so a plan is always ready.
    useEffect(() => {
        if (open && !planRef.current && phase === 'idle') {
            void analyze();
        }
    }, [open, phase, analyze]);

    return {
        open, setOpen,
        stake, setStake, takeProfit, setTakeProfit, stopLoss, setStopLoss,
        focusType, setFocusType,
        phase, progress, logs, plan, run,
        analyze, startRun, stopRun: () => stopRun(),
    };
}
