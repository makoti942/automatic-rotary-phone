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

let _buySeq = 0;

interface TradeEntry {
    contractId: string;
    strategy: MultiKillerStrategy;
    stake: number;
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
    const [running, setRunning] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);

    const tradesRef = useRef<TradeEntry[]>([]);
    const runningRef = useRef(false);
    const selectedRef = useRef<MultiKillerStrategy[]>([]);
    const stakesRef = useRef<Record<string, string>>({});
    const barriersRef = useRef<Record<string, string>>({ over: '5', under: '5', differs: '5' });
    const delaysRef = useRef<Record<string, number>>({ rise: 0, fall: 0 });
    const tickDirectionRef = useRef(0);
    const genRef = useRef(0);
    const pendingDelaysRef = useRef<PendingDelay[]>([]);

    // Tick direction tracking
    const lastTickPriceRef = useRef<number | null>(null);
    const consecutiveDirRef = useRef(0);
    const tickDirResolveRef = useRef<(() => void) | null>(null);
    const tickDirTargetRef = useRef(0);

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
    useEffect(() => { tickDirectionRef.current = parseInt(tickDirection) || 0; }, [tickDirection]);

    // Tick listener — handles BOTH tick delays AND tick direction monitoring
    useEffect(() => {
        if (!running) return;
        lastTickPriceRef.current = null;
        consecutiveDirRef.current = 0;

        const unsub = onNewSystemMessage((event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.msg_type !== 'tick') return;
                const price = parseFloat(data.tick?.quote ?? data.tick?.price);
                if (isNaN(price)) return;

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
                const target = tickDirTargetRef.current;
                if (target > 0 && tickDirResolveRef.current) {
                    const last = lastTickPriceRef.current;
                    if (last !== null) {
                        if (price > last) {
                            // UP tick
                            if (consecutiveDirRef.current > 0) {
                                consecutiveDirRef.current++;
                            } else {
                                consecutiveDirRef.current = 1;
                            }
                        } else if (price < last) {
                            // DOWN tick
                            if (consecutiveDirRef.current < 0) {
                                consecutiveDirRef.current--;
                            } else {
                                consecutiveDirRef.current = -1;
                            }
                        }
                        // price === last: no change, keep counter

                        const absCount = Math.abs(consecutiveDirRef.current);
                        const dir = consecutiveDirRef.current > 0 ? 'UP' : 'DOWN';

                        if (absCount >= target) {
                            log(`📊 Tick direction: ${absCount} ${dir} — executing round!`);
                            const resolve = tickDirResolveRef.current;
                            tickDirResolveRef.current = null;
                            consecutiveDirRef.current = 0;
                            lastTickPriceRef.current = price;
                            resolve();
                            return;
                        }

                        if (absCount > 1) {
                            log(`📊 Ticks ${dir}: ${absCount}/${target}`);
                        }
                    }
                    lastTickPriceRef.current = price;
                } else {
                    lastTickPriceRef.current = price;
                }
            } catch {}
        });
        return unsub;
    }, [running, log]);

    // Wait for N ticks in same direction
    const waitForTickDirection = useCallback((target: number, gen: number): Promise<boolean> => {
        return new Promise((resolve) => {
            if (target <= 0) { resolve(true); return; }
            tickDirTargetRef.current = target;
            consecutiveDirRef.current = 0;
            lastTickPriceRef.current = null;
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
    const buyOne = useCallback((strategy: MultiKillerStrategy, stakeNum: number): Promise<{ cid: string; strategy: MultiKillerStrategy } | null> => {
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

            const handler = (event: any) => {
                try {
                    const data = JSON.parse(event.detail?.data ?? event.data);
                    if (data.req_id !== reqId) return;
                    window.removeEventListener('newSystemMessage', handler);

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

            window.addEventListener('newSystemMessage', handler);
            ws.send(JSON.stringify(toSend));

            setTimeout(() => {
                window.removeEventListener('newSystemMessage', handler);
                log(`❌ ${LABELS[strategy]}: timeout`);
                resolve(null);
            }, 15000);
        });
    }, [market, log, transactions]);

    // Settlement listener
    useEffect(() => {
        const unsub = onNewSystemMessage((event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.msg_type !== 'proposal_open_contract') return;
                const poc = data.proposal_open_contract;
                if (!poc?.is_sold) return;
                const cid = String(poc.contract_id);
                const profit = parseFloat(poc.profit) || 0;

                const idx = tradesRef.current.findIndex(t => t.contractId === cid);
                if (idx === -1) return;
                const t = tradesRef.current[idx];

                const icon = profit >= 0 ? '✅' : '❌';
                log(`${icon} ${LABELS[t.strategy]}: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} (${t.stake}$ bet)`);
                tradesRef.current.splice(idx, 1);
                settledCountRef.current++;

                try {
                    transactions.onBotContractEvent({
                        contract_id: Number(cid),
                        transaction_ids: { buy: Number(cid) },
                        buy_price: t.stake,
                        sell_price: t.stake + profit,
                        currency: 'USD',
                        contract_type: CONTRACT_TYPE[t.strategy],
                        underlying: market,
                        display_name: market,
                        date_start: poc.entry_tick_time || Math.floor(Date.now() / 1000),
                        date_expiry: poc.exit_tick_time || Math.floor(Date.now() / 1000),
                        entry_spot: poc.entry_tick != null ? String(poc.entry_tick) : undefined,
                        entry_tick: poc.entry_tick != null ? String(poc.entry_tick) : undefined,
                        entry_tick_time: poc.entry_tick_time || undefined,
                        exit_spot: poc.exit_tick != null ? String(poc.exit_tick) : undefined,
                        exit_tick: poc.exit_tick != null ? String(poc.exit_tick) : undefined,
                        exit_tick_time: poc.exit_tick_time || undefined,
                        profit,
                        is_sold: true,
                        is_completed: true,
                        status: 'sold',
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

        const tdTarget = parseInt(tickDirectionRef.current.toString()) || 0;

        // ── TICK DIRECTION PHASE ──
        if (tdTarget > 0) {
            log(`📊 Waiting for ${tdTarget} ticks in same direction...`);
            const ok = await waitForTickDirection(tdTarget, gen);
            if (genRef.current !== gen || !runningRef.current) return;
            if (!ok) return;
        }

        const totalCost = sel.reduce((sum, s) => sum + getStake(s), 0);
        log(`🚀 Round: ${sel.length} contracts = $${totalCost.toFixed(2)} total`);

        // ── BUY PHASE ──
        buyPhaseDoneRef.current = false;
        expectedSettlementsRef.current = 0;
        settledCountRef.current = 0;

        const promises = sel.map(async (s) => {
            const delayTicks = HAS_DELAY[s] ? (delaysRef.current[s] ?? 0) : 0;
            if (delayTicks > 0) {
                log(`⏱ ${LABELS[s]} waiting ${delayTicks} tick${delayTicks > 1 ? 's' : ''}...`);
                await waitForTicks(delayTicks, gen);
                if (genRef.current !== gen) return null;
                log(`⏱ ${LABELS[s]} tick delay done — buying`);
            }
            return buyOne(s, getStake(s));
        });

        const results = await Promise.all(promises);

        if (genRef.current !== gen) return;

        const bought: TradeEntry[] = [];
        results.forEach(r => {
            if (r) bought.push({ contractId: r.cid, strategy: r.strategy, stake: getStake(r.strategy) });
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
            log(`🔄 Round complete — next round in 5s`);
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

        log(`🔄 Round complete — next round in 5s`);
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
    }, [buyOne, log, waitForTicks, waitForTickDirection, getStake]);

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
        consecutiveDirRef.current = 0;
        lastTickPriceRef.current = null;
        log('▶️ Started');
        runRoundRef.current?.();
    }, [running, selected, log]);

    const stop = useCallback(() => {
        genRef.current++;
        runningRef.current = false;
        setRunning(false);
        tradesRef.current = [];
        pendingDelaysRef.current = [];
        buyPhaseDoneRef.current = false;
        tickDirResolveRef.current = null;
        if (roundCompleteResolveRef.current) {
            roundCompleteResolveRef.current();
            roundCompleteResolveRef.current = null;
        }
        log('⏹ Stopped');
    }, [log]);

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
                <div className='mw-field'>
                    <label className='mw-label'>Tick Direction</label>
                    <input className='mw-input' type='number' min='0' max='20' step='1'
                        value={tickDirection}
                        onChange={e => setTickDirection(e.target.value)} />
                    <span className='mw-hint'>0 = off</span>
                </div>
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
            </div>

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
