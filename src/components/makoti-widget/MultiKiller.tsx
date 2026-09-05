import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ALL_SYMBOLS } from '@/components/makoti-widget/makoti-ws';
import { onNewSystemMessage } from '@/auth/NewDerivAuth';
import { useStore } from '@/hooks/useStore';
import './makoti-widget.scss';

type MultiKillerStrategy =
    | 'over'
    | 'under'
    | 'rise'
    | 'fall'
    | 'differs'
    | 'only_ups'
    | 'only_downs';

const LABELS: Record<MultiKillerStrategy, string> = {
    over: 'Over', under: 'Under', rise: 'Rise', fall: 'Fall',
    differs: 'Differs',
    only_ups: 'Only Ups', only_downs: 'Only Downs',
};

const CONTRACT_TYPE: Record<MultiKillerStrategy, string> = {
    over: 'DIGITOVER', under: 'DIGITUNDER', rise: 'CALL', fall: 'PUT',
    differs: 'DIGITDIFF',
    only_ups: 'RUNHIGH', only_downs: 'RUNLOW',
};

const DURATION: Record<MultiKillerStrategy, number> = {
    over: 1, under: 1, rise: 1, fall: 1, differs: 1,
    only_ups: 2, only_downs: 2,
};

const NEEDS_BARRIER: Record<MultiKillerStrategy, boolean> = {
    over: true, under: true, rise: false, fall: false,
    differs: true, only_ups: false, only_downs: false,
};

const HAS_DELAY: Record<MultiKillerStrategy, boolean> = {
    over: false, under: false, rise: true, fall: true,
    differs: false, only_ups: false, only_downs: false,
};

const USES_TICK_DIR: Record<MultiKillerStrategy, boolean> = {
    over: false, under: false, rise: true, fall: true,
    differs: false, only_ups: true, only_downs: true,
};

let _buySeq = 0;

interface TradeEntry {
    contractId: string;
    strategy: MultiKillerStrategy;
    stake: number;
    roundId: number;
}

interface PendingDelay {
    ticksNeeded: number;
    resolve: () => void;
    gen: number;
}

export const MultiKiller: React.FC = () => {
    const { transactions } = useStore();
    const [market, setMarket] = useState('R_100');
    const [selected, setSelected] = useState<MultiKillerStrategy[]>([]);
    const [stakes, setStakes] = useState<Record<string, string>>({});
    const [barriers, setBarriers] = useState<Record<string, string>>({
        over: '5', under: '5', differs: '5',
    });
    const [delays, setDelays] = useState<Record<string, number>>({
        rise: 0, fall: 0,
    });
    const [tickDirection, setTickDirection] = useState('0');
    const [tickDirMode, setTickDirMode] = useState<'any' | 'ups' | 'downs'>('any');
    const [running, setRunning] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [analyzing, setAnalyzing] = useState(false);
    const [analyzeResult, setAnalyzeResult] = useState<string | null>(null);

    const tradesRef = useRef<TradeEntry[]>([]);
    const runningRef = useRef(false);
    const selectedRef = useRef<MultiKillerStrategy[]>([]);
    const stakesRef = useRef<Record<string, string>>({});
    const barriersRef = useRef<Record<string, string>>({ over: '5', under: '5', differs: '5' });
    const delaysRef = useRef<Record<string, number>>({ rise: 0, fall: 0 });
    const genRef = useRef(0);
    const roundIdRef = useRef(0);
    const pendingDelaysRef = useRef<PendingDelay[]>([]);
    const buyListenersRef = useRef<Array<() => void>>([]);

    // Tick direction tracking
    const lastTickPriceRef = useRef<number | null>(null);
    const consecutiveUpRef = useRef(0);
    const consecutiveDownRef = useRef(0);
    const tickDirResolveRef = useRef<(() => void) | null>(null);
    const tickDirTargetRef = useRef(0);
    const tickDirActiveRef = useRef(false);
    const tickDirModeRef = useRef<'any' | 'ups' | 'downs'>('any');

    // Round lifecycle
    const expectedSettlementsRef = useRef(0);
    const settledCountRef = useRef(0);
    const buyPhaseDoneRef = useRef(false);
    const roundCompleteResolveRef = useRef<(() => void) | null>(null);

    const log = useCallback((msg: string) => {
        const t = new Date().toLocaleTimeString();
        setLogs(p => [`[${t}] ${msg}`, ...p].slice(0, 80));
    }, []);

    // Keep refs in sync
    useEffect(() => { selectedRef.current = selected; }, [selected]);
    useEffect(() => { stakesRef.current = stakes; }, [stakes]);
    useEffect(() => { barriersRef.current = barriers; }, [barriers]);
    useEffect(() => { delaysRef.current = delays; }, [delays]);
    useEffect(() => { tickDirModeRef.current = tickDirMode; }, [tickDirMode]);

    const showTickDir = selected.some(s => USES_TICK_DIR[s]);

    // Tick listener — handles tick delays AND tick direction
    useEffect(() => {
        if (!running) return;

        const unsub = onNewSystemMessage((event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.msg_type !== 'tick') return;
                const price = parseFloat(data.tick?.quote ?? data.tick?.bid ?? data.tick?.ask);
                if (isNaN(price)) return;

                // ── Always update lastTickPrice for next comparison ──
                const prevPrice = lastTickPriceRef.current;
                lastTickPriceRef.current = price;

                // ── Tick delay resolution (Rise/Fall 0t/1t/2t) ──
                const pending = pendingDelaysRef.current;
                for (let i = pending.length - 1; i >= 0; i--) {
                    const p = pending[i];
                    if (p.gen !== genRef.current) {
                        pending.splice(i, 1);
                        continue;
                    }
                    p.ticksNeeded--;
                    if (p.ticksNeeded <= 0) {
                        pending.splice(i, 1);
                        p.resolve();
                    }
                }

                // ── Tick direction tracking ──
                if (!tickDirActiveRef.current) return;
                if (prevPrice === null) {
                    log(`📊 Baseline: ${price}`);
                    return;
                }

                const target = tickDirTargetRef.current;
                if (target <= 0 || !tickDirResolveRef.current) return;

                const diff = price - prevPrice;
                const mode = tickDirModeRef.current;

                if (diff > 0) {
                    if (mode !== 'downs') {
                        consecutiveUpRef.current++;
                    }
                    consecutiveDownRef.current = 0;
                } else if (diff < 0) {
                    if (mode !== 'ups') {
                        consecutiveDownRef.current++;
                    }
                    consecutiveUpRef.current = 0;
                }
                // diff === 0: no change to counters

                const upCount = consecutiveUpRef.current;
                const downCount = consecutiveDownRef.current;

                if (upCount >= target) {
                    log(`📊 ${upCount} consecutive UP (${prevPrice}→${price}) — GO!`);
                    const resolve = tickDirResolveRef.current;
                    tickDirResolveRef.current = null;
                    tickDirActiveRef.current = false;
                    consecutiveUpRef.current = 0;
                    consecutiveDownRef.current = 0;
                    resolve();
                    return;
                }

                if (downCount >= target) {
                    log(`📊 ${downCount} consecutive DOWN (${prevPrice}→${price}) — GO!`);
                    const resolve = tickDirResolveRef.current;
                    tickDirResolveRef.current = null;
                    tickDirActiveRef.current = false;
                    consecutiveUpRef.current = 0;
                    consecutiveDownRef.current = 0;
                    resolve();
                    return;
                }

                if (upCount > 0) {
                    log(`  ↑ UP ${upCount}/${target} (${prevPrice}→${price})`);
                } else if (downCount > 0) {
                    log(`  ↓ DOWN ${downCount}/${target} (${prevPrice}→${price})`);
                }
            } catch {}
        });
        return unsub;
    }, [running, log]);

    // Wait for N ticks in same direction — returns true if matched, false if cancelled
    const waitForTickDirection = useCallback((target: number, gen: number): Promise<boolean> => {
        return new Promise((resolve) => {
            if (target <= 0) { resolve(true); return; }
            tickDirTargetRef.current = target;
            tickDirActiveRef.current = true;
            consecutiveUpRef.current = 0;
            consecutiveDownRef.current = 0;
            lastTickPriceRef.current = null;
            // Store resolve so stop() can call it to unblock
            tickDirResolveRef.current = () => {
                if (genRef.current === gen) resolve(true);
                else resolve(false);
            };
        });
    }, []);

    // Wait for N ticks (for Rise/Fall delay)
    const waitForTicks = useCallback((ticks: number, gen: number): Promise<void> => {
        return new Promise((resolve) => {
            if (ticks <= 0) { resolve(); return; }
            pendingDelaysRef.current.push({ ticksNeeded: ticks, resolve, gen });
        });
    }, []);

    const getStake = useCallback((strategy: MultiKillerStrategy): number => {
        return parseFloat(stakesRef.current[strategy] ?? '10') || 10;
    }, []);

    // Buy a single contract
    const buyOne = useCallback((strategy: MultiKillerStrategy, stakeNum: number, roundId: number): Promise<{ cid: string; strategy: MultiKillerStrategy } | null> => {
        return new Promise((resolve) => {
            const ws = window._newSystemWS;
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                log('❌ WS not open');
                resolve(null);
                return;
            }

            const reqId = Date.now() * 1000 + (++_buySeq);
            const ct = CONTRACT_TYPE[strategy];
            const dur = DURATION[strategy];
            const needBarrier = NEEDS_BARRIER[strategy];
            const rawBarrier = barriersRef.current[strategy] ?? '5';
            const barrier = needBarrier ? String(parseInt(rawBarrier) || 5) : undefined;

            const params: Record<string, any> = {
                amount: stakeNum,
                basis: 'stake',
                contract_type: ct,
                currency: 'USD',
                duration: dur,
                duration_unit: 't',
                symbol: market,
            };
            if (barrier !== undefined) params.barrier = barrier;

            const toSend: any = {
                buy: '1',
                price: stakeNum,
                parameters: { ...params, underlying_symbol: params.symbol },
                req_id: reqId,
            };
            delete toSend.parameters.symbol;

            log(`📤 ${LABELS[strategy]} ${ct}${barrier !== undefined ? ' B' + barrier : ''} ${dur}t $${stakeNum}`);

            const cleanup = () => {
                window.removeEventListener('newSystemMessage', handler);
                const idx = buyListenersRef.current.indexOf(cleanup);
                if (idx !== -1) buyListenersRef.current.splice(idx, 1);
            };

            const handler = (event: any) => {
                try {
                    const data = JSON.parse(event.detail?.data ?? event.data);
                    if (data.req_id !== reqId) return;
                    cleanup();

                    if (data.error) {
                        log(`❌ ${LABELS[strategy]}: ${data.error.message || 'error'}`);
                        resolve(null);
                        return;
                    }

                    const cid = String(data.buy?.contract_id ?? data.contract_id);
                    if (cid && cid !== 'undefined') {
                        ws.send(JSON.stringify({ proposal_open_contract: 1, subscribe: 1 }));

                        try {
                            transactions.onBotContractEvent({
                                contract_id: Number(cid),
                                transaction_ids: { buy: data.buy?.transaction_id ?? Number(cid) },
                                buy_price: stakeNum,
                                currency: 'USD',
                                contract_type: ct,
                                underlying: market,
                                display_name: market,
                                date_start: Math.floor(Date.now() / 1000),
                                status: 'open',
                                entry_tick: data.buy?.entry_tick,
                                entry_tick_time: data.buy?.entry_tick_time,
                            } as any);
                        } catch {}

                        log(`✅ ${LABELS[strategy]} bought (#${cid})`);
                        resolve({ cid, strategy });
                    } else {
                        log(`⚠️ ${LABELS[strategy]}: no contract_id`);
                        resolve(null);
                    }
                } catch {}
            };

            buyListenersRef.current.push(cleanup);
            window.addEventListener('newSystemMessage', handler);
            ws.send(JSON.stringify(toSend));

            setTimeout(() => {
                cleanup();
                log(`❌ ${LABELS[strategy]}: timeout`);
                resolve(null);
            }, 15000);
        });
    }, [market, log, transactions]);

    // Settlement listener — only counts contracts from current round
    useEffect(() => {
        const unsub = onNewSystemMessage((event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.msg_type !== 'proposal_open_contract') return;
                const poc = data.proposal_open_contract;
                if (!poc?.is_sold) return;
                const cid = String(poc.contract_id);
                const profit = parseFloat(poc.profit) || 0;

                const currentRound = roundIdRef.current;
                const idx = tradesRef.current.findIndex(t => t.contractId === cid && t.roundId === currentRound);
                if (idx === -1) return;
                const t = tradesRef.current[idx];

                const icon = profit >= 0 ? '✅' : '❌';
                log(`${icon} ${LABELS[t.strategy]}: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} (${t.stake}$ bet)`);
                tradesRef.current.splice(idx, 1);
                settledCountRef.current++;

                try {
                    transactions.onBotContractEvent({
                        ...poc,
                        contract_id: cid,
                        transaction_ids: { buy: poc.transaction_ids?.buy ?? cid },
                        buy_price: t.stake,
                        sell_price: t.stake + profit,
                        display_name: poc.display_name ?? market,
                        status: 'sold',
                        profit,
                        is_sold: true,
                        is_completed: true,
                    } as any);
                } catch {}

                log(`  (${settledCountRef.current}/${expectedSettlementsRef.current} settled)`);

                if (buyPhaseDoneRef.current && settledCountRef.current >= expectedSettlementsRef.current) {
                    if (roundCompleteResolveRef.current) {
                        roundCompleteResolveRef.current();
                        roundCompleteResolveRef.current = null;
                    }
                }
            } catch {}
        });
        return unsub;
    }, [log, transactions, market]);

    const runRoundRef = useRef<() => Promise<void>>();

    // Execute a round — tick direction → buy phase → settlement phase
    const runRound = useCallback(async () => {
        if (!runningRef.current) return;
        const gen = genRef.current;
        const sel = selectedRef.current;
        if (sel.length === 0) {
            log('⚠️ No strategies selected');
            runningRef.current = false;
            setRunning(false);
            return;
        }

        // Increment round ID — old contracts from previous rounds are ignored
        roundIdRef.current++;
        const myRound = roundIdRef.current;

        const tdTarget = showTickDir ? (parseInt(tickDirection) || 0) : 0;

        // ── TICK DIRECTION PHASE ──
        if (tdTarget > 0) {
            log(`📊 Waiting for ${tdTarget} ticks in same direction...`);
            const ok = await waitForTickDirection(tdTarget, gen);
            if (genRef.current !== gen || !runningRef.current) return;
            if (!ok) return;
        }

        const totalCost = sel.reduce((sum, s) => sum + getStake(s), 0);
        log(`🚀 Round #${myRound}: ${sel.length} contracts = $${totalCost.toFixed(2)} total`);

        // ── BUY PHASE ──
        buyPhaseDoneRef.current = false;
        expectedSettlementsRef.current = 0;
        settledCountRef.current = 0;
        // Clean up any stale buy listeners from previous round
        buyListenersRef.current.forEach(c => c());
        buyListenersRef.current = [];

        const promises = sel.map(async (s) => {
            const delayTicks = HAS_DELAY[s] ? (delaysRef.current[s] ?? 0) : 0;
            if (delayTicks > 0) {
                log(`⏱ ${LABELS[s]} waiting ${delayTicks} tick${delayTicks > 1 ? 's' : ''}...`);
                await waitForTicks(delayTicks, gen);
                if (genRef.current !== gen) return null;
                log(`⏱ ${LABELS[s]} tick delay done — buying`);
            }
            return buyOne(s, getStake(s), myRound);
        });

        const results = await Promise.all(promises);

        if (genRef.current !== gen) return;

        // Register bought contracts — tagged with roundId
        const bought: TradeEntry[] = [];
        results.forEach(r => {
            if (r) bought.push({ contractId: r.cid, strategy: r.strategy, stake: getStake(r.strategy), roundId: myRound });
        });

        if (bought.length === 0) {
            log('❌ All buys failed');
            runningRef.current = false;
            setRunning(false);
            return;
        }

        tradesRef.current.push(...bought);
        expectedSettlementsRef.current = bought.length;
        buyPhaseDoneRef.current = true;
        log(`✅ ${bought.length} open — waiting for all settlements`);

        // ── SETTLEMENT PHASE ──
        if (settledCountRef.current >= expectedSettlementsRef.current) {
            log(`🔄 Round #${myRound} complete — next round in 5s`);
            await new Promise<void>(r => {
                const g = genRef.current;
                setTimeout(() => {
                    if (runningRef.current && genRef.current === g) r();
                    else r();
                }, 5000);
            });
            if (genRef.current === gen && runningRef.current) {
                runRoundRef.current?.();
            }
            return;
        }

        await new Promise<void>((resolve) => {
            roundCompleteResolveRef.current = resolve;
        });

        if (genRef.current !== gen) return;

        log(`🔄 Round #${myRound} complete — next round in 5s`);
        await new Promise<void>(r => {
            const g = genRef.current;
            setTimeout(() => {
                if (runningRef.current && genRef.current === g) r();
                else r();
            }, 5000);
        });

        if (genRef.current === gen && runningRef.current) {
            runRoundRef.current?.();
        }
    }, [buyOne, log, waitForTicks, waitForTickDirection, getStake, showTickDir, tickDirection]);

    runRoundRef.current = runRound;

    const start = useCallback(() => {
        if (running || selected.length === 0) return;
        setRunning(true);
        setLogs([]);
        runningRef.current = true;
        genRef.current++;
        tradesRef.current = [];
        pendingDelaysRef.current = [];
        buyPhaseDoneRef.current = false;
        expectedSettlementsRef.current = 0;
        settledCountRef.current = 0;
        tickDirResolveRef.current = null;
        tickDirActiveRef.current = false;
        consecutiveUpRef.current = 0;
        consecutiveDownRef.current = 0;
        lastTickPriceRef.current = null;
        log('▶️ Started');
        runRoundRef.current?.();
    }, [running, selected, log]);

    const stop = useCallback(() => {
        genRef.current++;
        runningRef.current = false;
        setRunning(false);
        tradesRef.current = [];
        buyPhaseDoneRef.current = false;
        tickDirActiveRef.current = false;
        // Unblock all waiting promises
        buyListenersRef.current.forEach(c => c());
        buyListenersRef.current = [];
        pendingDelaysRef.current.forEach(p => p.resolve());
        pendingDelaysRef.current = [];
        if (tickDirResolveRef.current) {
            tickDirResolveRef.current();
            tickDirResolveRef.current = null;
        }
        if (tickDirResolveRef.current) {
            tickDirResolveRef.current();
            tickDirResolveRef.current = null;
        }
        if (roundCompleteResolveRef.current) {
            roundCompleteResolveRef.current();
            roundCompleteResolveRef.current = null;
        }
        log('⏹ Stopped');
    }, [log]);

    const analyzeVolatilities = useCallback(async () => {
        const ws = window._newSystemWS;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            setAnalyzeResult('❌ WebSocket not connected');
            return;
        }

        setAnalyzing(true);
        setAnalyzeResult(null);
        setLogs(p => ['📊 Loading last 200 ticks from all volatilities...', ...p].slice(0, 80));

        const VOL_SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];

        const fetchTicks = (sym: string): Promise<number[]> => new Promise((resolve) => {
            const id = Date.now() + Math.random();
            const handler = (e: Event) => {
                try {
                    const data = JSON.parse((e as CustomEvent).detail.data);
                    if (data.req_id !== id) return;
                    window.removeEventListener('newSystemMessage', handler);
                    const ticks = data.history?.prices || [];
                    resolve(ticks.map(Number));
                } catch { resolve([]); }
            };
            window.addEventListener('newSystemMessage', handler);
            ws.send(JSON.stringify({ ticks_history: sym, style: 'ticks', count: 200, end: 'latest', req_id: id }));
            setTimeout(() => { window.removeEventListener('newSystemMessage', handler); resolve([]); }, 10000);
        });

        const allData = await Promise.all(VOL_SYMBOLS.map(async (sym) => {
            const prices = await fetchTicks(sym);
            return { sym, prices };
        }));

        const results: Array<{
            sym: string;
            label: string;
            maxStreak: number;
            over4Count: number;
            totalMoves: number;
            over4Pct: number;
            upCount: number;
            downCount: number;
            avgMove: number;
        }> = [];

        for (const { sym, prices } of allData) {
            if (prices.length < 20) {
                results.push({ sym, label: sym, maxStreak: 0, over4Count: 0, totalMoves: 0, over4Pct: 100, upCount: 0, downCount: 0, avgMove: 0 });
                continue;
            }

            let maxStreak = 0;
            let currentStreak = 1;
            let over4Count = 0;
            let streakDir = 0;
            let upCount = 0;
            let downCount = 0;
            let totalMovement = 0;

            for (let i = 1; i < prices.length; i++) {
                const diff = prices[i] - prices[i - 1];
                let dir = 0;
                if (diff > 0) { dir = 1; upCount++; }
                else if (diff < 0) { dir = -1; downCount++; }
                totalMovement += Math.abs(diff);

                if (dir === streakDir && dir !== 0) {
                    currentStreak++;
                } else {
                    if (currentStreak > maxStreak) maxStreak = currentStreak;
                    if (currentStreak > 4) over4Count++;
                    currentStreak = dir !== 0 ? 1 : 0;
                    streakDir = dir;
                }
            }
            if (currentStreak > maxStreak) maxStreak = currentStreak;
            if (currentStreak > 4) over4Count++;

            const totalMoves = prices.length - 1;
            const over4Pct = totalMoves > 0 ? Math.round((over4Count / totalMoves) * 100) : 100;
            const avgMove = totalMoves > 0 ? totalMovement / totalMoves : 0;
            results.push({ sym, label: `Vol ${sym.replace('R_', '')}`, maxStreak, over4Count, totalMoves, over4Pct, upCount, downCount, avgMove });
        }

        results.sort((a, b) => a.over4Pct - b.over4Pct || a.maxStreak - b.maxStreak);

        let msg = '📊 TICK MOVEMENT ANALYSIS\n\n';
        results.forEach((r, i) => {
            const rank = i === 0 ? '🏆' : i === 1 ? '✅' : '  ';
            const warn = r.over4Pct > 10 ? ' ⚠️' : '';
            msg += `${rank} ${r.label}: up ${r.upCount} | down ${r.downCount} | avg move ${r.avgMove.toFixed(2)} | streaks >4: ${r.over4Pct}%${warn}\n`;
        });

        const best = results[0];
        msg += `\n💡 BEST: ${best.label}\n`;
        msg += `Only ${best.over4Pct}% of moves exceed 4 ticks — safest for tick direction`;

        setAnalyzeResult(msg);
        setMarket(best.sym);
        setAnalyzing(false);
        setLogs(p => [`📊 Best: ${best.label} — auto-selected`, ...p].slice(0, 80));
    }, []);

    const toggle = (s: MultiKillerStrategy) => {
        if (running) return;
        setSelected(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);
        if (!stakes[s]) setStakes(p => ({ ...p, [s]: '10' }));
    };

    return (
        <div className='mw-killer'>
            <div className='mw-killer__fields'>
                <div className='mw-field'>
                    <label className='mw-label'>Market</label>
                    <select className='mw-input' value={market} onChange={e => setMarket(e.target.value)}>
                        {ALL_SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>
                {showTickDir && (
                    <div className='mw-field'>
                        <label className='mw-label'>Tick Direction</label>
                        <div className='mw-tickdir-row'>
                            <input className='mw-input' type='number' min='1' max='20' step='1'
                                value={tickDirection}
                                onChange={e => setTickDirection(e.target.value)} />
                            <select className='mw-input mw-tickdir-select'
                                value={tickDirMode}
                                onChange={e => setTickDirMode(e.target.value as any)}>
                                <option value='any'>Any</option>
                                <option value='ups'>Ups Only</option>
                                <option value='downs'>Downs Only</option>
                            </select>
                        </div>
                        <span className='mw-hint'>0 = off</span>
                    </div>
                )}
            </div>

            <div className='mw-killer__types'>
                <label className='mw-label'>Strategies</label>
                <div className='mw-types-row'>
                    {(Object.keys(LABELS) as MultiKillerStrategy[]).map(s => (
                        <label key={s} className='mw-type-cb'>
                            <input type='checkbox' checked={selected.includes(s)}
                                onChange={() => toggle(s)} disabled={running} />
                            <span>{LABELS[s]}</span>
                            {HAS_DELAY[s] && selected.includes(s) && (
                                <select
                                    className='mw-type-delay'
                                    value={delays[s] ?? 0}
                                    onChange={e => setDelays(p => ({ ...p, [s]: Number(e.target.value) }))}
                                    disabled={running}
                                    onClick={e => e.stopPropagation()}
                                >
                                    <option value={0}>0t</option>
                                    <option value={1}>1t</option>
                                    <option value={2}>2t</option>
                                </select>
                            )}
                        </label>
                    ))}
                </div>
            </div>

            {selected.length > 0 && (
                <div className='mw-killer__fields'>
                    {selected.map(s => (
                        <div key={s} className='mw-field'>
                            <label className='mw-label'>{LABELS[s]} Stake ($)</label>
                            <input className='mw-input' type='number' min='0.35' step='0.01'
                                value={stakes[s] ?? '10'}
                                onChange={e => setStakes(p => ({ ...p, [s]: e.target.value }))} />
                        </div>
                    ))}
                </div>
            )}

            {selected.some(s => NEEDS_BARRIER[s]) && (
                <div className='mw-killer__fields'>
                    {selected.filter(s => NEEDS_BARRIER[s]).map(s => (
                        <div key={s} className='mw-field'>
                            <label className='mw-label'>{LABELS[s]} Barrier</label>
                            <input className='mw-input' type='number' min='0' max='9' step='1'
                                value={barriers[s] ?? '5'}
                                onChange={e => setBarriers(p => ({ ...p, [s]: e.target.value }))} />
                        </div>
                    ))}
                </div>
            )}

            <div className='mw-killer__actions'>
                {running
                    ? <button className='mw-btn mw-btn--stop' onClick={stop}>Stop</button>
                    : <button className='mw-btn mw-btn--run' disabled={!selected.length} onClick={start}>Run</button>
                }
                {showTickDir && (
                    <button className={`mw-btn mw-btn--analyze ${analyzing ? 'mw-btn--analyzing' : ''}`}
                        disabled={analyzing || running}
                        onClick={analyzeVolatilities}>
                        {analyzing ? '⏳ Loading...' : '📊 Analyze'}
                    </button>
                )}
            </div>

            {analyzeResult && (
                <div className='mw-analyze-result'>
                    <pre>{analyzeResult}</pre>
                </div>
            )}

            <div className='mw-killer__logs'>
                <div className='mw-killer__logs-head'>Log</div>
                <div className='mw-killer__log-list'>
                    {logs.length === 0
                        ? <div className='mw-killer__log-empty'>Select strategies → Run</div>
                        : logs.map((l, i) => <div key={i} className='mw-killer__log-line'>{l}</div>)
                    }
                </div>
            </div>
        </div>
    );
};
