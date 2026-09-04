import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ALL_SYMBOLS } from '@/components/makoti-widget/makoti-ws';
import { sendViaNewSystemWithPromise, onNewSystemMessage } from '@/auth/NewDerivAuth';
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

interface TradeEntry {
    contractId: number;
    strategy: MultiKillerStrategy;
    stake: number;
}

export const MultiKiller: React.FC = () => {
    const [market, setMarket] = useState('R_100');
    const [stake, setStake] = useState('10');
    const [selected, setSelected] = useState<MultiKillerStrategy[]>([]);
    const [barriers, setBarriers] = useState<Record<string, number>>({
        over: 5, under: 5, differs: 5,
    });
    const [running, setRunning] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);

    const tradesRef = useRef<TradeEntry[]>([]);
    const runningRef = useRef(false);
    const roundDoneRef = useRef(0);
    const roundTotalRef = useRef(0);
    const roundStakeRef = useRef(0);

    const log = useCallback((msg: string) => {
        const t = new Date().toLocaleTimeString();
        setLogs(p => [`[${t}] ${msg}`, ...p].slice(0, 80));
    }, []);

    // Listen for contract settlements via the newSystemMessage event
    useEffect(() => {
        const unsub = onNewSystemMessage((raw: any) => {
            try {
                const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract?.is_sold) {
                    const poc = data.proposal_open_contract;
                    const cid = poc.contract_id;
                    const profit = parseFloat(poc.profit) || 0;

                    const idx = tradesRef.current.findIndex(t => t.contractId === cid);
                    if (idx !== -1) {
                        const t = tradesRef.current[idx];
                        const icon = profit >= 0 ? '✅' : '❌';
                        log(`${icon} ${LABELS[t.strategy]} settled: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} (${t.stake}$)`);
                        tradesRef.current.splice(idx, 1);
                        roundDoneRef.current++;

                        if (roundDoneRef.current >= roundTotalRef.current) {
                            log(`🔄 Round done — all ${roundTotalRef.current} contracts settled`);
                            if (runningRef.current) {
                                setTimeout(() => runRound(), 500);
                            }
                        }
                    }
                }
            } catch { /* ignore */ }
        });
        return unsub;
    }, [log]);

    const buyOne = useCallback(async (strategy: MultiKillerStrategy, stakeNum: number): Promise<number | null> => {
        const ct = CONTRACT_TYPE[strategy];
        const dur = DURATION[strategy];
        const needBarrier = NEEDS_BARRIER[strategy];
        const barrier = needBarrier ? String(barriers[strategy] ?? 5) : undefined;

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

        log(`📤 BUY ${LABELS[strategy]} ${ct}${barrier !== undefined ? ' B' + barrier : ''} ${dur}t $${stakeNum}`);

        try {
            const res = await sendViaNewSystemWithPromise({
                buy: 1,
                price: stakeNum,
                parameters: params,
            });
            const cid = res?.buy?.contract_id ?? res?.contract_id;
            if (cid) {
                log(`✅ ${LABELS[strategy]} bought (#${cid})`);
                return cid;
            }
            log(`⚠️ ${LABELS[strategy]} buy returned no contract_id`);
            return null;
        } catch (e: any) {
            log(`❌ ${LABELS[strategy]} error: ${e?.error?.message || e?.message || 'timeout'}`);
            return null;
        }
    }, [barriers, market, log]);

    const runRound = useCallback(async () => {
        if (!runningRef.current || selected.length === 0) return;

        const stakeNum = parseFloat(stake) || 10;
        roundTotalRef.current = selected.length;
        roundDoneRef.current = 0;
        roundStakeRef.current = stakeNum;

        log(`🚀 Round: ${selected.length} × $${stakeNum} = $${(selected.length * stakeNum).toFixed(2)} total`);

        const results = await Promise.all(
            selected.map(s => buyOne(s, stakeNum))
        );

        const ok = results.filter(Boolean) as number[];
        if (ok.length === 0) {
            log('❌ All buys failed');
            runningRef.current = false;
            setRunning(false);
        } else {
            // register trades
            ok.forEach((cid, i) => {
                tradesRef.current.push({
                    contractId: cid,
                    strategy: selected[i],
                    stake: stakeNum,
                });
            });
            roundTotalRef.current = ok.length;
            roundDoneRef.current = 0;
            log(`✅ ${ok.length} open — waiting for settlement`);
        }
    }, [selected, stake, buyOne, log]);

    const start = useCallback(() => {
        if (running || selected.length === 0) return;
        setRunning(true);
        setLogs([]);
        runningRef.current = true;
        tradesRef.current = [];
        log('▶️ Started');
        runRound();
    }, [running, selected, runRound, log]);

    const stop = useCallback(() => {
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
                                value={barriers[s] ?? 5}
                                onChange={e => setBarriers(p => ({ ...p, [s]: parseInt(e.target.value) || 5 }))} />
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
