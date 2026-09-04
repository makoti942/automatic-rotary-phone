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
  only_ups: 'RUNHIGH',
  only_downs: 'RUNLOW',
};

const STRATEGY_NEEDS_BARRIER: Record<MultiKillerStrategy, boolean> = {
  over: true,
  under: true,
  rise: false,
  fall: false,
  eve: false,
  odd: false,
  differs: true,
  only_ups: false,
  only_downs: false,
};

interface ActiveContract {
  contractId: number;
  strategy: MultiKillerStrategy;
  stake: number;
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
    only_ups: null,
    only_downs: null,
  });
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const activeContractsRef = useRef<ActiveContract[]>([]);
  const requestIdRef = useRef(0);
  const settlementCountRef = useRef(0);
  const totalExpectedRef = useRef(0);

  const addLog = useCallback((msg: string, type: 'info' | 'trade' | 'error' | 'win' | 'loss' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [{ time, msg, type }, ...prev].slice(0, 100));
  }, []);

  const sendWS = useCallback((msg: any) => {
    const ws = window._newSystemWS;
    addLog(`🔍 WS state: ${ws?.readyState === WebSocket.OPEN ? 'OPEN' : ws?.readyState === WebSocket.CONNECTING ? 'CONNECTING' : ws?.readyState === WebSocket.CLOSED ? 'CLOSED' : 'NULL'}`, 'info');
    addLog(`🔍 Sending: ${JSON.stringify(msg).slice(0, 200)}`, 'info');
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    } else {
      addLog('❌ WebSocket not connected', 'error');
      return false;
    }
  }, [addLog]);

  const handleWSMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      
      // Handle buy response
      if (data.msg_type === 'buy' && data.buy) {
        const contractId = data.buy.contract_id;
        addLog(`✅ Contract bought (ID: ${contractId})`, 'trade');
      }
      
      // Handle contract settlement (proposal_open_contract with is_sold)
      if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract) {
        const poc = data.proposal_open_contract;
        if (poc.is_sold) {
          const contractId = poc.contract_id;
          const profit = parseFloat(poc.profit) || 0;
          const payout = parseFloat(poc.payout) || 0;
          
          const activeIndex = activeContractsRef.current.findIndex(c => c.contractId === contractId);
          if (activeIndex !== -1) {
            const active = activeContractsRef.current[activeIndex];
            const type = profit >= 0 ? 'win' : 'loss';
            addLog(`${type === 'win' ? '✅' : '❌'} ${STRATEGY_LABELS[active.strategy]} settled: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`, type);
            
            activeContractsRef.current.splice(activeIndex, 1);
            settlementCountRef.current++;
            
            // Check if all contracts in this round have settled
            if (settlementCountRef.current >= totalExpectedRef.current) {
              addLog(`🔄 Round complete (${totalExpectedRef.current} contracts settled)`, 'info');
              // Start next round if still running
              if (running) {
                executeRound();
              }
            }
          }
        }
      }
      
      // Handle error
      if (data.error) {
        addLog(`❌ Error: ${data.error.message}`, 'error');
      }
    } catch (e) {
      // Ignore parse errors
    }
  }, [running, addLog]);

  // Subscribe to WebSocket messages
  useEffect(() => {
    window.addEventListener('message', handleWSMessage as any);
    return () => window.removeEventListener('message', handleWSMessage as any);
  }, [handleWSMessage]);

  const executeRound = useCallback(async () => {
    if (!running || selectedStrategies.length === 0) return;
    
    const ws = window._newSystemWS;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      addLog('❌ WebSocket not ready, cannot execute', 'error');
      return;
    }
    
    const stakeNum = parseFloat(stake) || 10;
    totalExpectedRef.current = selectedStrategies.length;
    settlementCountRef.current = 0;
    
    addLog(`🚀 Starting round: ${selectedStrategies.length} contracts @ $${stakeNum} each = $${(stakeNum * selectedStrategies.length).toFixed(2)} total`, 'info');
    
    // Send all buy requests simultaneously with direct buy
    const promises = selectedStrategies.map(async (strategy) => {
      const barrier = STRATEGY_NEEDS_BARRIER[strategy] 
        ? (barriers[strategy] ?? 5)
        : undefined;
      
      const contractType = STRATEGY_CONTRACT_TYPE[strategy];
      const duration = STRATEGY_DURATION[strategy];
      
      const params: any = {
        amount: stakeNum,
        basis: 'stake',
        contract_type: contractType,
        currency: 'USD',
        duration: duration,
        duration_unit: 't',
        symbol: market,
      };
      
      if (barrier !== undefined) {
        params.barrier = barrier.toString();
      }
      
      const reqId = ++requestIdRef.current;
      const buyRequest = {
        buy: 1,
        price: stakeNum,
        parameters: params,
        req_id: reqId,
      };
      
      // Track this contract
      activeContractsRef.current.push({ contractId: 0, strategy, stake: stakeNum });
      
      const sent = sendWS(buyRequest);
      if (sent) {
        addLog(`📤 BUY sent: ${STRATEGY_LABELS[strategy]} ${contractType}${barrier !== undefined ? ` barrier=${barrier}` : ''} ${duration}t $${stakeNum} (req_id=${reqId})`, 'trade');
      } else {
        addLog(`❌ Failed to send BUY for ${STRATEGY_LABELS[strategy]}`, 'error');
      }
      
      return Promise.resolve();
    });
    
    await Promise.all(promises);
  }, [running, selectedStrategies, barriers, stake, market, sendWS, addLog]);

  const startMultiKiller = useCallback(() => {
    if (running || selectedStrategies.length === 0) return;
    
    const ws = window._newSystemWS;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      addLog('❌ WebSocket not connected', 'error');
      return;
    }
    
    setRunning(true);
    setLogs([]);
    activeContractsRef.current = [];
    requestIdRef.current = 0;
    
    // Subscribe to proposal_open_contract for all active contracts
    addLog('▶️ Multi-Killer started', 'info');
    executeRound();
  }, [running, selectedStrategies, executeRound, addLog]);

  const stopMultiKiller = useCallback(() => {
    setRunning(false);
    activeContractsRef.current = [];
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

      {/* Barrier fields ONLY for strategies that need them */}
      {selectedStrategies.filter(s => STRATEGY_NEEDS_BARRIER[s as MultiKillerStrategy]).map(strategy => (
        <div key={strategy} className='mw-field'>
          <label className='mw-label'>
            {STRATEGY_LABELS[strategy as MultiKillerStrategy]} Barrier
          </label>
          <input
            className='mw-input'
            type='number'
            min='0'
            max='9'
            step='1'
            value={barriers[strategy as MultiKillerStrategy] ?? 5}
            onChange={e => setBarriers(prev => ({ 
              ...prev, 
              [strategy]: parseInt(e.target.value) || 5 
            }))}
          />
        </div>
      ))}

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
              <div key={i} className={`mw-killer__log-line ${l.type === 'error' ? 'mw-log-line--error' : l.type === 'trade' ? 'mw-log-line--trade' : l.type === 'win' ? 'mw-log-line--win' : l.type === 'loss' ? 'mw-log-line--loss' : ''}`}>{l.msg}</div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};