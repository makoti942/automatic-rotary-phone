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

let _buySeq = 0;

interface TradeEntry {
    contractId: string;
    strategy: MultiKillerStrategy;
    stake: number;
}

export const MultiKiller: React.FC = () => {
    const { transactions } = useStore();
    const [market, setMarket] = useState('R_100');
    const [stake, setStake] = useState('10');
    const [selected, setSelected] = useState<MultiKillerStrategy[]>([]);
    const [barriers, setBarriers] = useState<Record<string, string>>({
        over: '5', under: '5', differs: '5',
    });
    const [running, setRunning] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);

    const tradesRef = useRef<TradeEntry[]>([]);
    const runningRef = useRef(false);
    const roundDoneRef = useRef(0);
    const roundTotalRef = useRef(0);
    const selectedRef = useRef<MultiKillerStrategy[]>([]);
    const stakeRef = useRef('10');
    const barriersRef = useRef<Record<string, string>>({ over: '5', under: '5', differs: '5' });
    const genRef = useRef(0);

    const log = useCallback((msg: string) => {
        const t = new Date().toLocaleTimeString();
        setLogs(p => [`[${t}] ${msg}`, ...p].slice(0, 80));
    }, []);

    // Keep refs in sync
    useEffect(() => { selectedRef.current = selected; }, [selected]);
    useEffect(() => { stakeRef.current = stake; }, [stake]);
    useEffect(() => { barriersRef.current = barriers; }, [barriers]);

    // Buy a single contract with unique req_id — bypasses sendViaNewSystemWithPromise
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
                        // Subscribe to settlement updates for this contract
                        ws.send(JSON.stringify({ proposal_open_contract: 1, subscribe: 1 }));

                        // Register with main panel
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
                roundDoneRef.current++;

                // Update main panel with full tick data
                try {
                    const pip = market.startsWith('R_') ? 2 : 2;
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

                log(`  (${roundDoneRef.current}/${roundTotalRef.current} settled)`);

                if (roundDoneRef.current >= roundTotalRef.current) {
                    log(`🔄 Round complete — next round in 5s`);
                    if (runningRef.current) {
                        const gen = genRef.current;
                        setTimeout(() => {
                            if (runningRef.current && genRef.current === gen) {
                                runRoundRef.current?.();
                            }
                        }, 5000);
                    }
                }
            } catch {}
        });
        return unsub;
    }, [log, transactions, market]);

    const runRoundRef = useRef<() => Promise<void>>();

    // Execute a round — fire ALL buys simultaneously
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

        const stakeNum = parseFloat(stakeRef.current) || 10;
        roundTotalRef.current = 0;
        roundDoneRef.current = 0;

        log(`🚀 Round: ${sel.length} × $${stakeNum} = $${(sel.length * stakeNum).toFixed(2)}`);

        // Fire ALL buys at the same time
        const promises = sel.map(s => buyOne(s, stakeNum));
        const results = await Promise.all(promises);

        // Check if stopped during buys
        if (genRef.current !== gen) return;

        // Build trade list from successful results
        const bought: TradeEntry[] = [];
        results.forEach(r => {
            if (r) bought.push({ contractId: r.cid, strategy: r.strategy, stake: stakeNum });
        });

        if (bought.length === 0) {
            log('❌ All buys failed');
            runningRef.current = false;
            setRunning(false);
            return;
        }

        tradesRef.current.push(...bought);
        roundTotalRef.current = bought.length;
        log(`✅ ${bought.length} open — waiting for settlement`);
    }, [buyOne, log]);

    runRoundRef.current = runRound;

    const start = useCallback(() => {
        if (running || selected.length === 0) return;
        setRunning(true);
        setLogs([]);
        runningRef.current = true;
        genRef.current++;
        tradesRef.current = [];
        log('▶️ Started');
        runRoundRef.current?.();
    }, [running, selected, log]);

    const stop = useCallback(() => {
        genRef.current++;
        runningRef.current = false;
        setRunning(false);
        tradesRef.current = [];
        log('⏹ Stopped');
    }, [log]);

    const toggle = (s: MultiKillerStrategy) => {
        if (running) return;
        setSelected(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);
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
                    <label className='mw-label'>Stake ($)</label>
                    <input className='mw-input' type='number' min='0.35' step='0.01'
                        value={stake} onChange={e => setStake(e.target.value)} />
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
                        </label>
                    ))}
                </div>
            </div>

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
