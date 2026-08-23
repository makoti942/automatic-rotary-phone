import React, { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useAiAnalyst } from './use-ai-analyst';
import './ai-panel.scss';

const PHASE_LABEL: Record<string, string> = {
    idle: 'Idle',
    collecting: 'Collecting data…',
    analyzing: 'AI thinking…',
    ready: 'Plan ready',
    running: 'RUNNING',
    error: 'Error',
};

export const AiPanel = observer(() => {
    const ai = useAiAnalyst();
    const logRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [ai.logs]);

    const plan = ai.plan;
    const isBusy = ai.phase === 'collecting' || ai.phase === 'analyzing';
    const running = ai.phase === 'running';

    return (
        <>
            {!ai.open && (
                <button
                    type='button'
                    className='ai-fab'
                    title='AI Analyst'
                    onClick={() => ai.setOpen(true)}
                >
                    AI
                </button>
            )}

            {ai.open && (
                <div className='ai-panel'>
                    <div className='ai-panel-header'>
                        <span className='ai-panel-title'>AI Analyst</span>
                        <span className={`ai-phase ai-phase--${ai.phase}`}>{PHASE_LABEL[ai.phase] ?? ai.phase}</span>
                        <button className='ai-close' onClick={() => ai.setOpen(false)}>×</button>
                    </div>

                    {/* Risk inputs — key is built in, nothing to configure */}
                    <div className='ai-grid'>
                        <div className='ai-field'>
                            <label>Stake ($)</label>
                            <input type='number' min={0.35} step={0.01} value={ai.stake}
                                onChange={e => ai.setStake(e.target.value)} />
                        </div>
                        <div className='ai-field'>
                            <label>Take profit ($)</label>
                            <input type='number' min={0} step={0.5} value={ai.takeProfit}
                                onChange={e => ai.setTakeProfit(e.target.value)} />
                        </div>
                        <div className='ai-field'>
                            <label>Stop loss ($)</label>
                            <input type='number' min={0} step={0.5} value={ai.stopLoss}
                                onChange={e => ai.setStopLoss(e.target.value)} />
                        </div>
                    </div>

                    {/* Actions */}
                    <div className='ai-actions'>
                        <button
                            className='ai-btn ai-btn--analyze'
                            disabled={isBusy || running}
                            onClick={() => void ai.analyze()}
                        >
                            {isBusy ? 'Analyzing…' : 'Analyze'}
                        </button>
                        {running ? (
                            <button className='ai-btn ai-btn--stop' onClick={() => ai.stopRun()}>
                                Stop
                            </button>
                        ) : (
                            <button
                                className='ai-btn ai-btn--run'
                                disabled={!plan || isBusy}
                                onClick={() => void ai.startRun()}
                            >
                                Run
                            </button>
                        )}
                    </div>

                    {ai.progress && <div className='ai-progress'>{ai.progress}</div>}

                    {/* Plan card */}
                    {plan && (
                        <div className='ai-plan'>
                            <div className='ai-plan-head'>
                                <span className='ai-plan-market'>{plan.market}</span>
                                <span className='ai-plan-contract'>
                                    {plan.contract_type.replace('DIGIT', '')}
                                    {plan.barrier_digit != null ? ` ${plan.barrier_digit}` : ''}
                                </span>
                                <span className='ai-plan-duration'>{plan.duration_ticks} tick{plan.duration_ticks > 1 ? 's' : ''}</span>
                                <span className={`ai-conf ${plan.confidence >= 60 ? 'ai-conf--hi' : plan.confidence >= 40 ? 'ai-conf--mid' : 'ai-conf--low'}`}>
                                    {plan.confidence}%
                                </span>
                            </div>
                            <div className='ai-plan-trigger'>
                                Trigger:{' '}
                                {plan.entry_trigger.type === 'immediate' && 'enter immediately on run start'}
                                {plan.entry_trigger.type === 'last_digit_equals' && `fire when last digit == ${plan.entry_trigger.digit}`}
                                {plan.entry_trigger.type === 'gap_reached' && `wait until digit ${plan.entry_trigger.digit} absent ≥ ${plan.entry_trigger.min_gap} ticks`}
                            </div>
                            {plan.rationale && <p className='ai-plan-text'>{plan.rationale}</p>}
                            {plan.monitoring && <p className='ai-plan-text ai-plan-text--muted'><strong>Monitor:</strong> {plan.monitoring}</p>}
                            {plan.risk_notes && <p className='ai-plan-text ai-plan-text--risk'><strong>Risk:</strong> {plan.risk_notes}</p>}
                        </div>
                    )}

                    {/* Live session */}
                    {(running || ai.run.trades > 0) && (
                        <div className={`ai-session ${ai.run.pnl >= 0 ? 'ai-session--up' : 'ai-session--dn'}`}>
                            <span>P/L {ai.run.pnl >= 0 ? '+' : ''}{ai.run.pnl.toFixed(2)}</span>
                            <span>{ai.run.wins}W / {ai.run.losses}L</span>
                            <span>{ai.run.openId !== null ? 'Trade open…' : 'Watching…'}</span>
                        </div>
                    )}

                    {/* Log console */}
                    <div className='ai-log' ref={logRef}>
                        {ai.logs.length === 0
                            ? <div className='ai-log-empty'>Press Analyze — I will load 1000 ticks from all 10 volatilities in parallel, compute digit frequencies, transitions, drought gaps, streak behaviour and parity skews, then hand every number to the AI to commit to one precise, executable plan.</div>
                            : ai.logs.map((l, i) => <div key={i} className='ai-log-line'>{l}</div>)}
                    </div>
                </div>
            )}
        </>
    );
});
