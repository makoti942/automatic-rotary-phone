import React, { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { useAiAnalyst } from './use-ai-analyst';
import { AiFocus } from './ai-analyst';
import './ai-panel.scss';

const PHASE_LABEL: Record<string, string> = {
    idle: 'Idle',
    collecting: 'Loading…',
    analyzing: 'Thinking…',
    ready: 'Ready',
    running: 'RUNNING',
    error: 'Error',
};

const FOCUS_LABELS: Record<AiFocus, string> = {
    auto: 'All',
    'matches-differs': 'Match/Diff',
    'over-under': 'Over/Under',
    'even-odd': 'Even/Odd',
};

export const AiPanel = observer(() => {
    const ai = useAiAnalyst();
    const [ddOpen, setDdOpen] = useState(false);
    const [minimized, setMinimized] = useState(false);
    const [showDetails, setShowDetails] = useState(false);

    const panelRef = useRef<HTMLDivElement>(null);
    const fabRef = useRef<HTMLButtonElement>(null);
    const dragState = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
    const fabDragState = useRef<{ px: number; py: number; ox: number; oy: number; startX: number; startY: number } | null>(null);
    const logRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [ai.logs]);

    // Panel drag — direct DOM for zero lag
    const onHeaderDown = useCallback((e: React.PointerEvent) => {
        if ((e.target as HTMLElement).closest('button')) return;
        const panel = panelRef.current;
        if (!panel) return;
        const tx = panel.style.transform;
        const match = tx.match(/translate\(calc\(-50%\s*\+\s*([^)]+)\)/);
        let ox = 0, oy = 0;
        if (match) {
            ox = parseFloat(match[1]) || 0;
            // find dy part
            const match2 = tx.match(/,\s*calc\(-50%\s*\+\s*([^)]+)\)/);
            oy = match2 ? (parseFloat(match2[1]) || 0) : 0;
        }
        dragState.current = { px: e.clientX, py: e.clientY, ox, oy };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }, []);

    const onHeaderMove = useCallback((e: React.PointerEvent) => {
        const d = dragState.current;
        if (!d || !panelRef.current) return;
        const nx = d.ox + (e.clientX - d.px);
        const ny = d.oy + (e.clientY - d.py);
        panelRef.current.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
    }, []);

    const onHeaderUp = useCallback(() => { dragState.current = null; }, []);

    // FAB drag — direct DOM, instant response
    const onFabDown = useCallback((e: React.PointerEvent) => {
        e.stopPropagation();
        const el = fabRef.current;
        if (!el) return;
        const tx = el.style.transform;
        const match = tx.match(/translate\(([^,]+),\s*([^)]+)\)/);
        const ox = match ? (parseFloat(match[1]) || 0) : 0;
        const oy = match ? (parseFloat(match[2]) || 0) : 0;
        fabDragState.current = { px: e.clientX, py: e.clientY, ox, oy, startX: e.clientX, startY: e.clientY };
        el.setPointerCapture(e.pointerId);
    }, []);

    const onFabMove = useCallback((e: React.PointerEvent) => {
        const d = fabDragState.current;
        if (!d || !fabRef.current) return;
        const nx = d.ox + (e.clientX - d.px);
        const ny = d.oy + (e.clientY - d.py);
        fabRef.current.style.transform = `translate(${nx}px, ${ny}px)`;
    }, []);

    const onFabUp = useCallback((e: React.PointerEvent) => {
        const d = fabDragState.current;
        if (d) {
            const moved = Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY);
            if (moved < 5) {
                // It was a tap, not a drag — open the panel
                ai.setOpen(true);
            }
        }
        fabDragState.current = null;
    }, [ai]);

    const plan = ai.plan;
    const isBusy = ai.phase === 'collecting' || ai.phase === 'analyzing';
    const running = ai.phase === 'running';

    return (
        <>
            {!ai.open && (
                <button
                    ref={fabRef}
                    type='button'
                    className='ai-fab'
                    title='AI Analyst'
                    onPointerDown={onFabDown}
                    onPointerMove={onFabMove}
                    onPointerUp={onFabUp}
                    onPointerCancel={onFabUp}
                >
                    AI
                </button>
            )}

            {ai.open && !minimized && (
                <div ref={panelRef} className='ai-panel'>
                    <div
                        className='ai-panel-header'
                        onPointerDown={onHeaderDown}
                        onPointerMove={onHeaderMove}
                        onPointerUp={onHeaderUp}
                        onPointerCancel={onHeaderUp}
                    >
                        <span className='ai-grip'>⠿</span>
                        <span className='ai-panel-title'>AI</span>
                        <span className={`ai-phase ai-phase--${ai.phase}`}>{PHASE_LABEL[ai.phase] ?? ai.phase}</span>
                        <button className='ai-minimize' title='Minimize' onClick={() => setMinimized(true)}>—</button>
                        <button className='ai-close' onClick={() => ai.setOpen(false)}>×</button>
                    </div>

                    <div className='ai-body'>
                        <div className='ai-dd'>
                            <button type='button' className='ai-dd-btn' onClick={() => setDdOpen(o => !o)}>
                                <span className='ai-dd-k'>Focus</span>
                                <span>{FOCUS_LABELS[ai.focusType]}</span>
                                <span className='ai-dd-caret'>▾</span>
                            </button>
                            {ddOpen && (
                                <>
                                    <div className='ai-dd-backdrop' onClick={() => setDdOpen(false)} />
                                    <div className='ai-dd-panel'>
                                        {(Object.keys(FOCUS_LABELS) as AiFocus[]).map(f => (
                                            <button
                                                key={f}
                                                type='button'
                                                className={`ai-dd-opt ${f === ai.focusType ? 'is-active' : ''}`}
                                                onClick={() => { ai.setFocusType(f); setDdOpen(false); }}
                                            >
                                                {FOCUS_LABELS[f]}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>

                        <div className='ai-grid'>
                            <div className='ai-field'>
                                <label>Stake</label>
                                <input type='number' min={0.35} step={0.01} value={ai.stake}
                                    onChange={e => ai.setStake(e.target.value)} />
                            </div>
                            <div className='ai-field'>
                                <label>TP $</label>
                                <input type='number' min={0} step={0.5} value={ai.takeProfit}
                                    onChange={e => ai.setTakeProfit(e.target.value)} />
                            </div>
                            <div className='ai-field'>
                                <label>SL $</label>
                                <input type='number' min={0} step={0.5} value={ai.stopLoss}
                                    onChange={e => ai.setStopLoss(e.target.value)} />
                            </div>
                        </div>

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

                        {plan && (
                            <div className='ai-plan'>
                                <div className='ai-plan-head'>
                                    <span className='ai-plan-market'>{plan.market}</span>
                                    <span className='ai-plan-contract'>
                                        {plan.contract_type.replace('DIGIT', '')}
                                        {plan.barrier_digit != null ? ` ${plan.barrier_digit}` : ''}
                                    </span>
                                    <span className='ai-plan-dur'>{plan.duration_ticks}t</span>
                                    <span className={`ai-conf ${plan.confidence >= 60 ? 'ai-conf--hi' : plan.confidence >= 40 ? 'ai-conf--mid' : 'ai-conf--low'}`}>
                                        {plan.confidence}%
                                    </span>
                                </div>
                                <div className='ai-plan-trigger'>
                                    {plan.entry_trigger.type === 'immediate' && 'enter now'}
                                    {plan.entry_trigger.type === 'last_digit_equals' && `entry: digit ${plan.entry_trigger.digit}`}
                                    {plan.entry_trigger.type === 'gap_reached' && `entry: gap ≥${plan.entry_trigger.min_gap} on ${plan.entry_trigger.digit}`}
                                </div>
                                {plan.summary && <p className='ai-plan-summary'>{plan.summary}</p>}
                                <button className='ai-plan-toggle' onClick={() => setShowDetails(d => !d)}>
                                    {showDetails ? 'Less' : 'Details'}
                                </button>
                                {showDetails && (
                                    <>
                                        {plan.rationale && <p className='ai-plan-text'>{plan.rationale}</p>}
                                        {plan.monitoring && <p className='ai-plan-text ai-plan-text--muted'>Watch: {plan.monitoring}</p>}
                                        {plan.risk_notes && <p className='ai-plan-text ai-plan-text--risk'>Risk: {plan.risk_notes}</p>}
                                    </>
                                )}
                            </div>
                        )}

                        {(running || ai.run.trades > 0) && (
                            <div className={`ai-session ${ai.run.pnl >= 0 ? 'ai-session--up' : 'ai-session--dn'}`}>
                                <span>{ai.run.pnl >= 0 ? '+' : ''}{ai.run.pnl.toFixed(2)}</span>
                                <span>{ai.run.wins}W/{ai.run.losses}L</span>
                                <span>{ai.run.openId !== null ? 'Open…' : 'Watching…'}</span>
                            </div>
                        )}

                        <div className='ai-log' ref={logRef}>
                            {ai.logs.length === 0
                                ? <div className='ai-log-empty'>Press Analyze to start.</div>
                                : ai.logs.map((l, i) => <div key={i} className='ai-log-line'>{l}</div>)}
                        </div>
                    </div>
                </div>
            )}

            {ai.open && minimized && (
                <div className='ai-pill'>
                    <button className='ai-pill-btn' onClick={() => setMinimized(false)}>
                        AI <span className='ai-pill-phase-dot' />
                    </button>
                    <button className='ai-close' onClick={() => ai.setOpen(false)}>×</button>
                </div>
            )}
        </>
    );
});
