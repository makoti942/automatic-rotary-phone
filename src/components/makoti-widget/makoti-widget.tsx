import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Scanner } from './scanner';
import { MarketKiller } from './market-killer';
import { OverUnderKiller } from './over-under-killer';
import { HighLow } from './high-low';
import { UnderUnderMarket } from './under-under-market';
import { DiffersAuto } from './differs-auto';
import { AiPanel } from '@/pages/manual-trade/ai-panel';
import { ALL_SYMBOLS } from './makoti-ws';
import './makoti-widget.scss';

type Tab = 'scanner' | 'market_killer' | 'over_under' | 'high_low' | 'under_under_market' | 'differs_auto' | 'ai_analyst';
const PAD = 8;
const TRADING_TABS: Tab[] = ['market_killer', 'over_under', 'high_low', 'under_under_market', 'differs_auto', 'ai_analyst'];

const TAB_OPTIONS: { value: Tab; label: string }[] = [
    { value: 'scanner', label: 'Scanner' },
    { value: 'market_killer', label: 'Market Killer' },
    { value: 'over_under', label: 'O/U Killer' },
    { value: 'high_low', label: 'HIGH/LOW' },
    { value: 'under_under_market', label: 'UNDER 7,6,5 KILLER' },
    { value: 'differs_auto', label: 'DIFFERS AUTO' },
    { value: 'ai_analyst', label: 'AI Analyst' },
];

function isLoggedIn(): boolean {
    try {
        const activeLoginId = localStorage.getItem('active_loginid');
        if (activeLoginId) return true;
        const clientAccounts = JSON.parse(localStorage.getItem('client.accounts') ?? '{}');
        return Object.keys(clientAccounts).length > 0;
    } catch { return false; }
}

export const MakotiWidget: React.FC = () => {
    const [open, setOpen]         = useState(() => localStorage.getItem('mw_open') === 'true');
    const [tab, setTab]           = useState<Tab>(() => (localStorage.getItem('mw_tab') as Tab) || 'scanner');
    const [minimized, setMinimized] = useState(false);
    const [loggedIn, setLoggedIn] = useState(isLoggedIn());
    const [wsReady, setWsReady]   = useState(false);
    const [tabOpen, setTabOpen] = useState(false);
    const tabDropRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const check = () => setLoggedIn(isLoggedIn());
        const interval = setInterval(check, 1000);
        window.addEventListener('storage', check);
        return () => { clearInterval(interval); window.removeEventListener('storage', check); };
    }, []);

    if (!loggedIn) return null;

    /* ── FAB position (refs for zero-rerender drag) ─────────── */
    const btnPosRef = useRef({ x: Math.max(PAD, window.innerWidth - 88), y: Math.max(PAD, window.innerHeight - 108) });
    const winPosRef = useRef({ x: Math.max(PAD, window.innerWidth - 420), y: Math.max(PAD, window.innerHeight - 640) });

    /* ── Expose programmatic tab switching for Recovery Mode ── */
    const switchToTab = useCallback((t: Tab) => {
        setTab(t);
        localStorage.setItem('mw_tab', t);
    }, []);

    useEffect(() => {
        window.DBot = window.DBot || {};
        window.DBot.__switchToTab = switchToTab;
        return () => { if (window.DBot) delete window.DBot.__switchToTab; };
    }, [switchToTab]);

    /* ── Monitor WS + auto-subscribe on trading tab select ── */
    useEffect(() => {
        const check = () => {
            const ready = window._newSystemWS?.readyState === WebSocket.OPEN;
            setWsReady(ready);
        };
        check();
        const i = setInterval(check, 1000);
        window.addEventListener('storage', check);
        return () => { clearInterval(i); window.removeEventListener('storage', check); };
    }, []);

    useEffect(() => {
        if (TRADING_TABS.includes(tab) && window._newSystemWS?.readyState === WebSocket.OPEN) {
            // Re-subscribe on every tab switch — other strategies may have
            // sent `forget` for these streams (idempotent on the server).
            ALL_SYMBOLS.forEach(sym => {
                window._newSystemWS.send(JSON.stringify({ ticks_history: sym, style: 'ticks', count: 1, end: 'latest', subscribe: 1 }));
            });
        }
    }, [tab]);

    /* ── Close tab dropdown on outside click ── */
    useEffect(() => {
        if (!tabOpen) return;
        const handler = (e: MouseEvent) => {
            if (tabDropRef.current && !tabDropRef.current.contains(e.target as Node)) {
                setTabOpen(false);
            }
        };
        document.addEventListener('pointerdown', handler);
        return () => document.removeEventListener('pointerdown', handler);
    }, [tabOpen]);

    /* ── Persist open / tab state to localStorage ─────────── */
    useEffect(() => { localStorage.setItem('mw_open', String(open)); }, [open]);
    useEffect(() => { localStorage.setItem('mw_tab',  tab);          }, [tab]);

    /* ── Drag state (refs, never cause re-renders) ─────────── */
    const btnDragging  = useRef(false);
    const winDragging  = useRef(false);
    const miniDragging = useRef(false);
    const btnMoved     = useRef(false);
    const winMoved     = useRef(false);
    const startClient  = useRef({ x: 0, y: 0 });
    const startElem    = useRef({ x: 0, y: 0 });
    const rafId        = useRef<number | null>(null);

    const btnRef  = useRef<HTMLButtonElement>(null);
    const winRef  = useRef<HTMLDivElement>(null);
    const miniRef = useRef<HTMLButtonElement>(null);

    /* ── Shared global pointer handlers (transform-based for GPU-composited drag) ── */
    useEffect(() => {
        let pendingDx = 0, pendingDy = 0;
        let hasPending = false;

        const w = window.innerWidth;
        const h = window.innerHeight;
        const isMobile = w <= 600;
        const winW = Math.min(isMobile ? 250 : 300, w - PAD * 2);

        const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

        const applyDrag = () => {
            rafId.current = null;

            if (btnDragging.current && btnRef.current) {
                const baseX = startElem.current.x;
                const baseY = startElem.current.y;
                const nx = clamp(baseX + pendingDx, PAD, w - 72 - PAD);
                const ny = clamp(baseY + pendingDy, PAD, h - 72 - PAD);
                btnRef.current.style.transform = `translate(${nx - baseX}px, ${ny - baseY}px)`;
                btnPosRef.current = { x: nx, y: ny };
            }
            if (winDragging.current && winRef.current) {
                const baseX = startElem.current.x;
                const baseY = startElem.current.y;
                const nx = clamp(baseX + pendingDx, PAD, w - winW - PAD);
                const ny = clamp(baseY + pendingDy, PAD, h - 60);
                winRef.current.style.transform = `translate(${nx - baseX}px, ${ny - baseY}px)`;
                winPosRef.current = { x: nx, y: ny };
            }
            if (miniDragging.current && miniRef.current) {
                const baseX = startElem.current.x;
                const baseY = startElem.current.y;
                const nx = clamp(baseX + pendingDx, PAD, w - 44 - PAD);
                const ny = clamp(baseY + pendingDy, PAD, h - 44 - PAD);
                miniRef.current.style.transform = `translate(${nx - baseX}px, ${ny - baseY}px)`;
                winPosRef.current = { x: nx, y: ny };
            }
            hasPending = false;
        };

        const onMove = (e: PointerEvent) => {
            if (!btnDragging.current && !winDragging.current && !miniDragging.current) return;
            const dx = e.clientX - startClient.current.x;
            const dy = e.clientY - startClient.current.y;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
                btnMoved.current = true;
                winMoved.current = true;
            }
            pendingDx = dx;
            pendingDy = dy;
            if (!hasPending) {
                hasPending = true;
                rafId.current = requestAnimationFrame(applyDrag);
            }
        };

        const onUp = () => {
            const wasBtn  = btnDragging.current;
            const wasWin  = winDragging.current;
            const wasMini = miniDragging.current;

            btnDragging.current  = false;
            winDragging.current  = false;
            miniDragging.current = false;
            hasPending = false;

            if (rafId.current !== null) {
                cancelAnimationFrame(rafId.current);
                rafId.current = null;
            }

            if (wasBtn && btnRef.current) {
                btnRef.current.style.left = btnPosRef.current.x + 'px';
                btnRef.current.style.top  = btnPosRef.current.y + 'px';
                btnRef.current.style.transform = 'none';
                btnRef.current.style.transition = '';
            }
            if (wasWin && winRef.current) {
                winRef.current.style.transform = 'none';
                winRef.current.style.left = winPosRef.current.x + 'px';
                winRef.current.style.top  = winPosRef.current.y + 'px';
            }
            if (wasMini && miniRef.current) {
                miniRef.current.style.left = winPosRef.current.x + 'px';
                miniRef.current.style.top  = winPosRef.current.y + 'px';
                miniRef.current.style.transform = 'none';
                miniRef.current.style.transition = '';
            }
        };

        const onCancel = () => { if (btnDragging.current || winDragging.current || miniDragging.current) onUp(); };

        document.addEventListener('pointermove', onMove, { passive: true });
        document.addEventListener('pointerup',   onUp);
        document.addEventListener('pointercancel', onCancel);
        document.addEventListener('pointerleave', onCancel);
        return () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup',   onUp);
            document.removeEventListener('pointercancel', onCancel);
            document.removeEventListener('pointerleave', onCancel);
            if (rafId.current !== null) cancelAnimationFrame(rafId.current);
        };
    }, []);

    /* ── Set initial positions via refs on first render ─────── */
    useEffect(() => {
        if (btnRef.current) {
            btnRef.current.style.left = btnPosRef.current.x + 'px';
            btnRef.current.style.top  = btnPosRef.current.y + 'px';
        }
    }, []);

    useEffect(() => {
        if (winRef.current && open) {
            const w = window.innerWidth;
            const h = window.innerHeight;
            const isMob = w <= 600;
            const defX = Math.max(PAD, w - Math.min(isMob ? 250 : 300, w - PAD * 2) - PAD);
            const defY = Math.max(PAD, h - (isMob ? 380 : 460));
            const nx = isMob ? PAD : defX;
            const ny = w <= 600 ? PAD : defY;
            winRef.current.style.left = nx + 'px';
            winRef.current.style.top  = ny + 'px';
            winPosRef.current = { x: nx, y: ny };
        }
    }, [open]);

    /* ── FAB pointer down ─────────────────────────────────── */
    const onBtnPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
        e.preventDefault();
        btnDragging.current = true;
        btnMoved.current    = false;
        startClient.current = { x: e.clientX, y: e.clientY };
        startElem.current   = { ...btnPosRef.current };
        if (btnRef.current) btnRef.current.style.transition = 'none';
    };

    /* ── FAB click — only toggle if not a drag ────────────── */
    const onBtnClick = () => {
        if (btnMoved.current) { btnMoved.current = false; return; }
        setOpen(o => !o);
    };

    /* ── Window header pointer down ───────────────────────── */
    const onWinPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        if (
            target.closest('.mw-win-body')    ||
            target.closest('.mw-win-actions') ||
            target.closest('.mw-tabs')        ||
            target.tagName === 'BUTTON' ||
            target.tagName === 'INPUT'  ||
            target.tagName === 'SELECT'
        ) return;
        e.preventDefault();
        winDragging.current = true;
        winMoved.current    = false;
        startClient.current = { x: e.clientX, y: e.clientY };
        startElem.current   = { ...winPosRef.current };
    };

    return (
        <>
            {/* ── Floating button ── */}
            <button
                ref={btnRef}
                className={`mw-fab${open ? ' mw-fab--open' : ''}`}
                style={{ position: 'fixed', left: btnPosRef.current.x, top: btnPosRef.current.y, zIndex: 100001 }}
                onPointerDown={onBtnPointerDown}
                onClick={onBtnClick}
                title='MAKOTI — Scanner / Market Killer / O/U / HIGH/LOW'
            >
                <span className='mw-fab__pulse' />
                <span className='mw-fab__icon'>⚔</span>
                <span className='mw-fab__label'>MAKOTI</span>
            </button>

            {/* ── Floating window & tab content (always mounted so active killer survives close) ── */}
            <div
                ref={winRef}
                className={`mw-window${open ? '' : ' mw-window--closed'}${minimized ? ' mw-window--hidden' : ''}`}
                style={{ position: 'fixed', left: winPosRef.current.x + 'px', top: winPosRef.current.y + 'px' }}
                onPointerDown={onWinPointerDown}
            >
                <div className='mw-win-header'>
                    <div className='mw-win-title'>
                        <span className='mw-win-logo'>⚔</span>
                        <span>MAKOTI</span>
                        {tab !== 'scanner' && (
                            <span className={`mw-ws-dot ${wsReady ? 'mw-ws-dot--ok' : 'mw-ws-dot--off'}`}
                                title={wsReady ? 'WebSocket connected' : 'WebSocket disconnected'} />
                        )}
                    </div>
                    <div className='mw-win-actions'>
                        <button
                            className='mw-win-action'
                            onClick={() => setMinimized(m => !m)}
                            title='Minimize'
                        >
                            ▼
                        </button>
                        <button
                            className='mw-win-action mw-win-action--close'
                            onClick={() => setOpen(false)}
                            title='Close'
                        >
                            ×
                        </button>
                    </div>
                </div>

                <div className='mw-tabs'>
                    <div className='mw-tab-dropdown' ref={tabDropRef}>
                        <button
                            className='mw-tab-dropdown__btn'
                            onClick={() => setTabOpen(o => !o)}
                        >
                            <span>{TAB_OPTIONS.find(o => o.value === tab)?.label}</span>
                            <svg className={`mw-tab-dropdown__arrow ${tabOpen ? 'mw-tab-dropdown__arrow--open' : ''}`} viewBox='0 0 12 8' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                                <path d='M1 1l5 5 5-5' />
                            </svg>
                        </button>
                        {tabOpen && (
                            <div className='mw-tab-dropdown__list'>
                                {TAB_OPTIONS.map(opt => (
                                    <button
                                        key={opt.value}
                                        className={`mw-tab-dropdown__item ${tab === opt.value ? 'mw-tab-dropdown__item--active' : ''}`}
                                        onClick={() => { setTab(opt.value as Tab); setTabOpen(false); }}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className='mw-win-body'>
                    {tab !== 'scanner' && (
                        <div className={`mw-preconnect ${wsReady ? 'mw-preconnect--ok' : ''}`}>
                            {wsReady
                                ? '● Connected — tick data streaming'
                                : '○ Connecting to Deriv API…'}
                        </div>
                    )}
                    {tab === 'scanner' && <Scanner />}
                    {tab === 'market_killer' && <MarketKiller />}
                    {tab === 'over_under' && <OverUnderKiller />}
                    {tab === 'high_low' && <HighLow />}
                    {tab === 'under_under_market' && <UnderUnderMarket />}
                    {tab === 'differs_auto' && <DiffersAuto />}
                    {tab === 'ai_analyst' && (
                        <AiPanel
                            embedded
                            preset={{
                                focusType: 'auto',
                                allowedTypes: { DIGITOVER: true, DIGITUNDER: true, DIGITDIFF: true, DIGITMATCH: false },
                            }}
                        />
                    )}
                </div>
            </div>

            {open && minimized && (
                <button
                    ref={miniRef}
                    className='mw-mini'
                    style={{
                        position: 'fixed',
                        left: winPosRef.current.x,
                        top: winPosRef.current.y,
                        zIndex: 99998,
                    }}
                    onPointerDown={(e) => {
                        miniDragging.current = true;
                        winMoved.current = false;
                        startClient.current = { x: e.clientX, y: e.clientY };
                        startElem.current = { ...winPosRef.current };
                        if (miniRef.current) miniRef.current.style.transition = 'none';
                        e.preventDefault();
                    }}
                    onClick={() => {
                        if (winMoved.current) { winMoved.current = false; return; }
                        setMinimized(false);
                    }}
                >
                    ⚔
                </button>
            )}
        </>
    );
};

export default MakotiWidget;
