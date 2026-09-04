import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAiAnalyst } from '@/pages/manual-trade/use-ai-analyst';
import { AiFocus, AiPlan } from '@/pages/manual-trade/ai-analyst';
import { ALL_SYMBOLS, VOLATILITY_SYMBOLS } from '@/components/makoti-widget/makoti-ws';
import './makoti-widget.scss';

type MultiKillerStrategy = 
  | 'over' 
  | 'under' 
  | 'rise' 
  | 'fall' 
  | 'eve' 
  | 'odd' 
  | 'differs' 
  | 'only_ups' 
  | 'only_downs';

const STRATEGY_LABELS: Record<MultiKillerStrategy, string> = {
  over: 'Over',
  under: 'Under',
  rise: 'Rise',
  fall: 'Fall',
  eve: 'Even',
  odd: 'Odd',
  differs: 'Differs',
  only_ups: 'Only Ups',
  only_downs: 'Only Downs',
};

const STRATEGY_DURATION: Record<MultiKillerStrategy, number> = {
  over: 1,
  under: 1,
  rise: 1,
  fall: 1,
  eve: 1,
  odd: 1,
  differs: 1,
  only_ups: 2,
  only_downs: 2,
};

const STRATEGY_BARRIER: Record<MultiKillerStrategy, { type: 'digit' | 'none', digit?: number }> = {
  over: { type: 'digit' },
  under: { type: 'digit' },
  rise: { type: 'none' },
  fall: { type: 'none' },
  eve: { type: 'none' },
  odd: { type: 'none' },
  differs: { type: 'digit' },
  only_ups: { type: 'digit' },
  only_downs: { type: 'digit' },
};

interface MultiKillerConfig {
  market: string;
  stake: number;
  strategies: MultiKillerStrategy[];
  barriers: Record<MultiKillerStrategy, number | null>;
  running: boolean;
  isBusy: boolean;
  plan: AiPlan | null;
  progress: string | null;
  logs: string[];
  analyze: () => void;
  startRun: () => void;
  stopRun: () => void;
  setStake: (v: string) => void;
  setFocusType: (v: AiFocus) => void;
  toggleAllowedType: (key: string) => void;
}

export const MultiKiller: React.FC = () => {
  const [market, setMarket] = useState<string>('R_100');
  const [stake, setStake] = useState<string>('10');
  const [selectedStrategies, setSelectedStrategies] = useState<MultiKillerStrategy[]>([]);
  const [barriers, setBarriers] = useState<Record<MultiKillerStrategy, number | null>>({
    over: 5,
    under: 5,
    rise: null,
    fall: null,
    eve: null,
    odd: null,
    differs: 5,
    only_ups: 5,
    only_downs: 5,
  });
  const [running, setRunning] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const ai = useAiAnalyst({
    focusType: 'auto',
    allowedTypes: {
      DIGITOVER: true,
      DIGITUNDER: true,
      DIGITDIFF: true,
      DIGITMATCH: false,
    },
  });

  const {
    focusType,
    allowedTypes,
    stake: aiStake,
    takeProfit,
    stopLoss,
    autoRun,
    stakeMultiplierEnabled,
    running: aiRunning,
    isBusy: aiIsBusy,
    plan: aiPlan,
    progress: aiProgress,
    logs: aiLogs,
    analyze,
    startRun: aiStartRun,
    stopRun: aiStopRun,
    setFocusType: aiSetFocusType,
    toggleAllowedType: aiToggleAllowedType,
    setStake: aiSetStake,
  } = ai;

  // Update plan from AI analyst
  useEffect(() => {
    if (aiPlan) {
      setPlan(aiPlan);
    }
  }, [aiPlan]);

  // Update logs from AI analyst
  useEffect(() => {
    if (aiLogs) {
      setLogs(prev => [...prev, ...aiLogs].slice(-50));
    }
  }, [aiLogs]);

  // Update progress
  useEffect(() => {
    if (aiProgress) {
      setProgress(aiProgress);
    }
  }, [aiProgress]);

  const handleAnalyze = useCallback(async () => {
    setIsBusy(true);
    setLogs([]);
    await analyze();
    setIsBusy(false);
  }, [analyze]);

  const startMultiKiller = useCallback(async () => {
    if (running || isBusy || selectedStrategies.length === 0) return;
    
    setRunning(true);
    setIsBusy(true);
    setLogs([]);
    
    try {
      const stakeNum = parseFloat(stake) || 10;
      const duration = STRATEGY_DURATION;
      
      // Execute all selected strategies simultaneously
      const promises = selectedStrategies.map(async (strategy) => {
        const barrier = STRATEGY_BARRIER[strategy].type === 'digit' 
          ? (barriers[strategy as keyof Record<MultiKillerStrategy, number | null>] || 5)
          : null;
        
        // Send trade signal for this strategy
        const signal: any = {
          market,
          contract_type: strategy as any,
          barrier_digit: barrier,
          duration_ticks: duration[strategy],
          stake: stakeNum,
          entry_trigger: {
            type: 'immediate',
            digit: 0,
            min_gap: 0,
          },
          confidence: 50,
        };
        
        // Log the trade
        const time = new Date().toLocaleTimeString();
        setLogs(prev => [{
          time,
          msg: `🔄 Multi-Killer: ${STRATEGY_LABELS[strategy]} ${signal.contract_type} @ barrier=${barrier} stake=${stakeNum} ticks=${duration[strategy]}`,
          type: 'trade',
        }, ...prev].slice(0, 100));
        
        // In a real implementation, this would send via WebSocket
        // For now, we'll just log
        return { strategy, signal };
      });
      
      await Promise.all(promises);
      
      setLogs(prev => [{
        time: new Date().toLocaleTimeString(),
        msg: `✅ Multi-Kicker started ${selectedStrategies.length} contracts simultaneously`,
        type: 'info',
      }, ...prev].slice(0, 100));
      
    } catch (err) {
      setLogs(prev => [{
        time: new Date().toLocaleTimeString(),
        msg: `❌ Multi-Killer error: ${(err as Error).message}`,
        type: 'error',
      }, ...prev].slice(0, 100));
    } finally {
      setIsBusy(false);
      // Don't auto-stop - let user stop manually
    }
  }, [stake, selectedStrategies, barriers, running, isBusy, market]);

  const stopMultiKiller = useCallback(() => {
    setRunning(false);
    setIsBusy(false);
    setLogs(prev => [{
      time: new Date().toLocaleTimeString(),
      msg: '⏹ Multi-Killer stopped',
      type: 'info',
    }, ...prev].slice(0, 100));
  }, []);

  return (
    <div className='mw-killer'>
      <div className='mw-killer__fields'>
        <div className='mw-field'>
          <label className='mw-label'>Market</label>
          <select
            className='mw-input'
            value={market}
            onChange={e => setMarket(e.target.value)}
          >
            {ALL_SYMBOLS.map(sym => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>
        </div>
        
        <div className='mw-field'>
          <label className='mw-label'>Stake ($)</label>
          <input
            className='mw-input'
            type='number'
            min='0.01'
            step='0.01'
            value={stake}
            onChange={e => setStake(e.target.value)}
          />
        </div>
      </div>

      <div className='mw-killer__types'>
        <label className='mw-label'>Select Strategies</label>
        <div className='mw-types-row'>
          {Object.entries(STRATEGY_LABELS).map(([strategy, label]) => (
            <label key={strategy} className='mw-type-cb'>
              <input
                type='checkbox'
                checked={selectedStrategies.includes(strategy as MultiKillerStrategy)}
                onChange={e => {
                  if (e.target.checked) {
                    setSelectedStrategies(prev => [...prev, strategy as MultiKillerStrategy]);
                  } else {
                    setSelectedStrategies(prev => prev.filter(s => s !== strategy as MultiKillerStrategy));
                  }
                }}
                disabled={running}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Barrier fields for over and under */}
      {selectedStrategies.includes('over') && (
        <div className='mw-field'>
          <label className='mw-label'>Over Barrier</label>
          <input
            className='mw-input'
            type='number'
            min='0'
            max='9'
            step='1'
            value={barriers.over ?? 5}
            onChange={e => setBarriers(prev => ({ ...prev, over: parseInt(e.target.value) || 5 }))}
          />
        </div>
      )}

      {selectedStrategies.includes('under') && (
        <div className='mw-field'>
          <label className='mw-label'>Under Barrier</label>
          <input
            className='mw-input'
            type='number'
            min='0'
            max='9'
            step='1'
            value={barriers.under ?? 5}
            onChange={e => setBarriers(prev => ({ ...prev, under: parseInt(e.target.value) || 5 }))}
          />
        </div>
      )}

      <div className='mw-killer__actions'>
        <button
          className={`mw-btn mw-btn--analyze${isBusy ? ' mw-btn--busy' : ''}`}
          disabled={isBusy || running}
          onClick={handleAnalyze}
        >
          {isBusy ? <><span className='mw-spin' /> Analyzing…</> : 'Analyze'}
        </button>
        {running ? (
          <button className='mw-btn mw-btn--stop' onClick={stopMultiKiller}>
            Stop
          </button>
        ) : (
          <button
            className='mw-btn mw-btn--run'
            disabled={!selectedStrategies.length || isBusy}
            onClick={startMultiKicker}
          >
            Run
          </button>
        )}
      </div>

      {progress && <div className='mw-killer__progress'>{progress}</div>}

      {plan && (
        <div className='mw-killer__plan'>
          <div className='mw-killer__plan-head'>
            <span className='mw-killer__plan-market'>{plan.market}</span>
            <span className='mw-killer__plan-contract'>
              {plan.contract_type.replace('DIGIT', '')}
              {plan.barrier_digit != null ? ` ${plan.barrier_digit}` : ''}
            </span>
            <span className='mw-killer__plan-dur'>{plan.duration_ticks}t</span>
            <span className={`mw-killer__conf ${plan.confidence >= 60 ? 'mw-killer__conf--hi' : plan.confidence >= 40 ? 'mw-killer__conf--mid' : 'mw-killer__conf--low'}`}>
              {plan.confidence}%
            </span>
          </div>
          <div className='mw-killer__plan-stakes'>
            <div className='mw-killer__plan-stake'>
              <span className='mw-killer__plan-stake-lbl'>Stake</span>
              <span className='mw-killer__plan-stake-val'>{plan.stake.toFixed(2)}</span>
            </div>
            <div className='mw-killer__plan-stake'>
              <span className='mw-killer__plan-stake-lbl'>Payout</span>
              <span className='mw-killer__plan-stake-val'>{plan.payout.toFixed(2)}</span>
            </div>
            <div className='mw-killer__plan-stake'>
              <span className='mw-killer__plan-stake-lbl'>Profit</span>
              <span className='mw-killer__plan-stake-val'>{plan.profit.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      <div className='mw-killer__logs'>
        <div className='mw-killer__logs-head'>Live Log</div>
        <div className='mw-killer__log-list'>
          {logs.length === 0 ? (
            <div className='mw-killer__log-empty'>Press Analyze to start.</div>
          ) : (
            logs.map((l, i) => (
              <div key={i} className='mw-killer__log-line'>{l}</div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};