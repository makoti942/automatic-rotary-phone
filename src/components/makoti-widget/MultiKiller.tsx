import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ALL_SYMBOLS } from '@/components/makoti-widget/makoti-ws';
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

const STRATEGY_CONTRACT_TYPE: Record<MultiKillerStrategy, string> = {
  over: 'DIGITOVER',
  under: 'DIGITUNDER',
  rise: 'RISE',
  fall: 'FALL',
  eve: 'DIGITEVEN',
  odd: 'DIGITODD',
  differs: 'DIGITDIFF',
  only_ups: 'DIGITOVER',
  only_downs: 'DIGITUNDER',
};

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
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = useCallback((msg: string, type: 'info' | 'trade' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [{ time, msg, type }, ...prev].slice(0, 100));
  }, []);

  const startMultiKiller = useCallback(async () => {
    if (running || selectedStrategies.length === 0) return;
    
    setRunning(true);
    setLogs([]);
    
    try {
      const stakeNum = parseFloat(stake) || 10;
      
      // Execute all selected strategies simultaneously
      const promises = selectedStrategies.map(async (strategy) => {
        const barrier = STRATEGY_BARRIER[strategy].type === 'digit' 
          ? (barriers[strategy] ?? 5)
          : null;
        
        const contractType = STRATEGY_CONTRACT_TYPE[strategy];
        const duration = STRATEGY_DURATION[strategy];
        
        // Log the trade
        addLog(`🔄 Multi-Killer: ${STRATEGY_LABELS[strategy]} ${contractType} @ barrier=${barrier ?? 'N/A'} stake=${stakeNum} ticks=${duration}`, 'trade');
        
        // Send trade via WebSocket (using existing Deriv API pattern)
        if (window._newSystemWS?.readyState === WebSocket.OPEN) {
          const proposalRequest = {
            proposal: 1,
            amount: stakeNum,
            basis: 'stake',
            contract_type: contractType,
            currency: 'USD',
            duration: duration,
            duration_unit: 't',
            symbol: market,
            barrier: barrier?.toString(),
          };
          
          window._newSystemWS.send(JSON.stringify(proposalRequest));
        }
        
        return { strategy, contractType, barrier, stake: stakeNum, duration };
      });
      
      await Promise.all(promises);
      
      addLog(`✅ Multi-Killer started ${selectedStrategies.length} contracts simultaneously`, 'info');
      
    } catch (err) {
      addLog(`❌ Multi-Killer error: ${(err as Error).message}`, 'error');
    }
  }, [stake, selectedStrategies, barriers, running, market, addLog]);

  const stopMultiKiller = useCallback(() => {
    setRunning(false);
    addLog('⏹ Multi-Killer stopped', 'info');
  }, [addLog]);

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

      {selectedStrategies.includes('differs') && (
        <div className='mw-field'>
          <label className='mw-label'>Differs Barrier</label>
          <input
            className='mw-input'
            type='number'
            min='0'
            max='9'
            step='1'
            value={barriers.differs ?? 5}
            onChange={e => setBarriers(prev => ({ ...prev, differs: parseInt(e.target.value) || 5 }))}
          />
        </div>
      )}

      {selectedStrategies.includes('only_ups') && (
        <div className='mw-field'>
          <label className='mw-label'>Only Ups Barrier</label>
          <input
            className='mw-input'
            type='number'
            min='0'
            max='9'
            step='1'
            value={barriers.only_ups ?? 5}
            onChange={e => setBarriers(prev => ({ ...prev, only_ups: parseInt(e.target.value) || 5 }))}
          />
        </div>
      )}

      {selectedStrategies.includes('only_downs') && (
        <div className='mw-field'>
          <label className='mw-label'>Only Downs Barrier</label>
          <input
            className='mw-input'
            type='number'
            min='0'
            max='9'
            step='1'
            value={barriers.only_downs ?? 5}
            onChange={e => setBarriers(prev => ({ ...prev, only_downs: parseInt(e.target.value) || 5 }))}
          />
        </div>
      )}

      <div className='mw-killer__actions'>
        {running ? (
          <button className='mw-btn mw-btn--stop' onClick={stopMultiKiller}>
            Stop
          </button>
        ) : (
          <button
            className='mw-btn mw-btn--run'
            disabled={!selectedStrategies.length}
            onClick={startMultiKiller}
          >
            Run
          </button>
        )}
      </div>

      <div className='mw-killer__logs'>
        <div className='mw-killer__logs-head'>Live Log</div>
        <div className='mw-killer__log-list'>
          {logs.length === 0 ? (
            <div className='mw-killer__log-empty'>Select strategies and press Run.</div>
          ) : (
            logs.map((l, i) => (
              <div key={i} className={`mw-killer__log-line ${l.type === 'error' ? 'mw-log-line--error' : l.type === 'trade' ? 'mw-log-line--trade' : ''}`}>{l.msg}</div>
            ))
          )}
        </div>
      </div>
    </div>
  );
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