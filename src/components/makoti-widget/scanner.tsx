import React, { useCallback, useRef, useState, useEffect } from 'react';
import { ALL_SYMBOLS, SYMBOL_LABELS, PIP_SIZES, openMakotiWS, MakotiWS } from './makoti-ws';
import { onNewSystemMessage } from '@/auth/NewDerivAuth';
import { MwSelect } from './mw-select';
import DBotStore from '@/external/bot-skeleton/scratch/dbot-store';

type BotId = 'pvty_kill' | 'rf_v4' | 'entry_digit';

interface SymbolDigitResult {
    symbol: string;
    label: string;
    pcts: number[];
    totalTicks: number;
    qualifies: boolean;
    detail: string;
}

interface SymbolDirectionResult {
    symbol: string;
    label: string;
    choppinessScore: number;
    bodyRatio: number;
    directionChanges: number;
    trendStrength: number;
    recentBodyRatio: number;
    qualifies: boolean;
    detail: string;
}

interface TriggerDigitResult {
    symbol: string;
    label: string;
    baselinePcts: number[];
    baselineWinPct: number;
    triggers: TriggerInfo[];
    qualifies: boolean;
    detail: string;
}

interface TriggerInfo {
    digit: number;
    occurrences: number;
    avgWinPctAfter: number;
    boost: number;
    consistency: number;
    windowSizes: { window: number; winPct: number; boost: number }[];
    // How each digit's % shifts after this trigger appears
    digitShifts: { digit: number; before: number; after: number; shift: number }[];
    // Pattern strength over time
    patternTrend: {
        olderBoost: number;    // boost in first 50 ticks
        recentBoost: number;   // boost in last 50 ticks
        olderOccurrences: number;
        recentOccurrences: number;
        trend: 'strengthening' | 'weakening' | 'stable' | 'new' | 'dying';
        trendPercent: number;  // how much stronger/weaker (positive = strengthening)
    };
}

type ScanResult = SymbolDigitResult | SymbolDirectionResult | TriggerDigitResult;

function isDigitResult(r: ScanResult): r is SymbolDigitResult {
    return (r as SymbolDigitResult).pcts !== undefined && 'totalTicks' in r && !('triggers' in r);
}

function isTriggerResult(r: ScanResult): r is TriggerDigitResult {
    return 'triggers' in r;
}

function calcDigitPcts(digits: number[]): number[] {
    const counts = Array(10).fill(0);
    digits.forEach(d => { if (d >= 0 && d <= 9) counts[d]++; });
    const total = digits.length || 1;
    return counts.map(c => (c / total) * 100);
}

// ── Entry Digit Trigger Analysis ──
// Deep analysis: how each digit's appearance affects ALL other digits
// Shows percentage shifts, pattern strength, and winning digit surge
function analyzeTriggerDigits(
    digits: number[],
    contractType: 'DIGITOVER' | 'DIGITUNDER',
    barrier: number,
): { baselinePcts: number[]; baselineWinPct: number; triggers: TriggerInfo[] } {
    const len = digits.length;
    if (len < 30) return { baselinePcts: Array(10).fill(0), baselineWinPct: 0, triggers: [] };

    // Baseline: full digit distribution from all 100 ticks
    const baselinePcts = calcDigitPcts(digits);

    // Calculate baseline winning digit percentage
    const isWin = (d: number) => contractType === 'DIGITOVER' ? d > barrier : d < barrier;
    const winCount = digits.filter(d => isWin(d)).length;
    const baselineWinPct = (winCount / len) * 100;

    // Analysis window: 20 ticks (~1 minute of trading)
    const windowSize = 20;

    const triggers: TriggerInfo[] = [];

    // For each possible trigger digit (0-9)
    for (let triggerDigit = 0; triggerDigit <= 9; triggerDigit++) {
        // Find all positions where this trigger digit appears
        const positions: number[] = [];
        for (let i = 0; i < len - 1; i++) {
            if (digits[i] === triggerDigit) positions.push(i);
        }

        if (positions.length < 3) continue; // Need minimum occurrences

        // Collect ALL digits that appear after each trigger occurrence
        const afterDigits: number[] = [];
        for (const pos of positions) {
            const end = Math.min(pos + windowSize, len);
            for (let j = pos + 1; j < end; j++) {
                afterDigits.push(digits[j]);
            }
        }

        if (afterDigits.length === 0) continue;

        // Calculate digit distribution AFTER trigger
        const afterPcts = calcDigitPcts(afterDigits);

        // Calculate shift for each digit (after - before)
        const digitShifts = baselinePcts.map((before, d) => ({
            digit: d,
            before,
            after: afterPcts[d],
            shift: afterPcts[d] - before,
        }));

        // Calculate winning digit % after trigger
        const afterWinCount = afterDigits.filter(d => isWin(d)).length;
        const avgWinPctAfter = (afterWinCount / afterDigits.length) * 100;
        const boost = avgWinPctAfter - baselineWinPct;

        // Consistency: check across multiple sub-windows
        const subWindows = [5, 10, 15, 20];
        let windowsWithBoost = 0;
        const windowResults: { window: number; winPct: number; boost: number }[] = [];

        for (const sw of subWindows) {
            let swWin = 0, swTotal = 0;
            for (const pos of positions) {
                const end = Math.min(pos + sw, len);
                for (let j = pos + 1; j < end; j++) {
                    swTotal++;
                    if (isWin(digits[j])) swWin++;
                }
            }
            if (swTotal === 0) continue;
            const swWinPct = (swWin / swTotal) * 100;
            const swBoost = swWinPct - baselineWinPct;
            windowResults.push({ window: sw, winPct: swWinPct, boost: swBoost });
            if (swBoost > 0) windowsWithBoost++;
        }

        const consistency = windowResults.length > 0
            ? (windowsWithBoost / windowResults.length) * 100
            : 0;

        // ── Pattern Strength Over Time ──
        // Split into older (first 50 ticks) and recent (last 50 ticks)
        const halfLen = Math.floor(len / 2);
        const olderDigits = digits.slice(0, halfLen);
        const recentDigits = digits.slice(halfLen);

        // Find trigger occurrences in each half
        const olderPositions = positions.filter(p => p < halfLen);
        const recentPositions = positions.filter(p => p >= halfLen);

        // Calculate boost in older half
        let olderBoost = 0;
        let olderOccurrences = olderPositions.length;
        if (olderOccurrences >= 2) {
            const olderAfter: number[] = [];
            for (const pos of olderPositions) {
                const end = Math.min(pos + windowSize, halfLen);
                for (let j = pos + 1; j < end; j++) {
                    olderAfter.push(digits[j]);
                }
            }
            if (olderAfter.length > 0) {
                const olderWinCount = olderAfter.filter(d => isWin(d)).length;
                const olderWinPct = (olderWinCount / olderAfter.length) * 100;
                olderBoost = olderWinPct - baselineWinPct;
            }
        }

        // Calculate boost in recent half
        let recentBoost = 0;
        let recentOccurrences = recentPositions.length;
        if (recentOccurrences >= 2) {
            const recentAfter: number[] = [];
            for (const pos of recentPositions) {
                const end = Math.min(pos + windowSize, len);
                for (let j = pos + 1; j < end; j++) {
                    recentAfter.push(digits[j]);
                }
            }
            if (recentAfter.length > 0) {
                const recentWinCount = recentAfter.filter(d => isWin(d)).length;
                const recentWinPct = (recentWinCount / recentAfter.length) * 100;
                recentBoost = recentWinPct - baselineWinPct;
            }
        }

        // Determine trend
        let trend: 'strengthening' | 'weakening' | 'stable' | 'new' | 'dying';
        let trendPercent = 0;

        if (olderOccurrences < 2 && recentOccurrences >= 2) {
            trend = 'new';
            trendPercent = recentBoost;
        } else if (olderOccurrences >= 2 && recentOccurrences < 2) {
            trend = 'dying';
            trendPercent = -olderBoost;
        } else if (olderOccurrences >= 2 && recentOccurrences >= 2) {
            trendPercent = recentBoost - olderBoost;
            if (trendPercent > 5) trend = 'strengthening';
            else if (trendPercent < -5) trend = 'weakening';
            else trend = 'stable';
        } else {
            trend = 'stable';
            trendPercent = 0;
        }

        triggers.push({
            digit: triggerDigit,
            occurrences: positions.length,
            avgWinPctAfter,
            boost,
            consistency,
            windowSizes: windowResults,
            digitShifts,
            patternTrend: {
                olderBoost,
                recentBoost,
                olderOccurrences,
                recentOccurrences,
                trend,
                trendPercent,
            },
        });
    }

    // Sort by boost (highest first), then consistency
    triggers.sort((a, b) => {
        if (Math.abs(a.boost - b.boost) < 1) return b.consistency - a.consistency;
        return b.boost - a.boost;
    });

    return { baselinePcts, baselineWinPct, triggers };
}

/* ── Micro-choppiness analysis on the current growing candle ────────────── */
// Analyzes tick-level price action within the current (still-open) candle.
// Measures direction flip frequency, tick-run length, and body indecision.
// Higher score = more random / choppy (bad for 1-tick predictions).
function calcMicroChoppiness(prices: number[]): SymbolDirectionResult {
    const len = prices.length;
    if (len < 5) {
        return { symbol: '', label: '', choppinessScore: 0, bodyRatio: 0, directionChanges: 0, trendStrength: 0, recentBodyRatio: 0, qualifies: false, detail: 'Insufficient ticks' };
    }

    const open = prices[0];
    const close = prices[len - 1];
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const range = high - low || 1;

    // ── 1. Tick-level direction flips ───────────────────────────────
    let flips = 0, totalDir = 0, prevDir = 0;
    let runSum = 0, runCount = 0, curRun = 1;

    for (let i = 1; i < len; i++) {
        const dir = prices[i] > prices[i - 1] ? 1 : prices[i] < prices[i - 1] ? -1 : 0;
        if (dir === 0) continue;
        totalDir++;
        if (prevDir !== 0 && dir !== prevDir) {
            flips++;
            runSum += curRun;
            runCount++;
            curRun = 1;
        } else {
            curRun++;
        }
        prevDir = dir;
    }
    if (curRun > 0) { runSum += curRun; runCount++; }
    const avgRun = runCount > 0 ? runSum / runCount : 1;
    const flipRate = totalDir > 1 ? flips / (totalDir - 1) : 0;

    // ── 2. Body-to-range ratio (small = indecision = choppy) ─────────
    const body = Math.abs(close - open);
    const bodyRatio = body / range;

    // ── 3. Wick balance (balanced = indecision) ──────────────────────
    const upperWick = high - Math.max(open, close);
    const lowerWick = Math.min(open, close) - low;
    const totalWick = upperWick + lowerWick;
    const wickBalance = totalWick > 0 ? 1 - Math.abs(upperWick - lowerWick) / totalWick : 0.5;

    // ── 4. Reversal oscillation amplitude ───────────────────────────
    const rangePct = range / (open || 1);
    const rangeScore = rangePct > 0 ? Math.min(1, rangePct * 200) : 0;

    // ── Composite score ─────────────────────────────────────────────
    const score = Math.min(100, Math.round(
        flipRate             * 30 +   // frequent direction flips
        Math.max(0, 1 - avgRun / 3) * 25 +  // short tick runs
        (1 - bodyRatio)      * 25 +   // small body = indecision
        wickBalance          * 10 +   // balanced wicks = stalemate
        rangeScore           * 10     // wide range relative to price = noise
    ));

    return {
        symbol: '', label: '',
        choppinessScore: score,
        bodyRatio: Math.round(bodyRatio * 100),
        directionChanges: flips,
        trendStrength: Math.round(avgRun * 10),
        recentBodyRatio: Math.round(rangeScore * 100),
        qualifies: score >= 55,
        detail: `Score: ${score}% | Flips: ${flips}/${totalDir} | Run: ${avgRun.toFixed(1)}t | Body: ${(bodyRatio * 100).toFixed(0)}%`,
    };
}

// ─── Global POC listener (survives WS reconnect via onNewSystemMessage) ──
// Flags ONLY when a real (non-virtual) contract settles as a WIN, so the
// auto-switcher only changes volatility after a real-trade win — never on
// losses and never on virtual-hook wins/losses.
(window as any).__makoti_lastContractSettled = false;

let _pocUnsub: (() => void) | null = null;

function startPocListener() {
    if (_pocUnsub) return;
    _pocUnsub = onNewSystemMessage((event: MessageEvent) => {
        try {
            const d = JSON.parse(event.data);
            const c = d?.proposal_open_contract;
            if (d?.msg_type === 'proposal_open_contract' && c?.is_sold && !c.is_virtual && Number(c.profit) > 0) {
                (window as any).__makoti_lastContractSettled = true;
            }
        } catch (_) {}
    });
}

function stopPocListener() {
    if (_pocUnsub) {
        _pocUnsub();
        _pocUnsub = null;
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Scanner Component
═══════════════════════════════════════════════════════════════════════════ */
export const Scanner: React.FC = () => {
    const [bot, setBot] = useState<BotId>('pvty_kill');
    const [scanning, setScanning] = useState(false);
    const [progress, setProgress] = useState('');
    const [results, setResults] = useState<ScanResult[]>([]);
    const [bestSymbols, setBestSymbols] = useState<string[]>([]);
    const [autoSwitch, setAutoSwitch] = useState(false);
    const [autoSwitcherActive, setAutoSwitcherActive] = useState(false);
    const [pendingSymbol, setPendingSymbol] = useState('');
    const [notification, setNotification] = useState<{ msg: string; type: 'info' | 'success' | 'warn' } | null>(null);

    // Entry Digit config
    const [entryContractType, setEntryContractType] = useState<'DIGITOVER' | 'DIGITUNDER'>('DIGITOVER');
    const [entryBarrier, setEntryBarrier] = useState(3);

    // Refs for logic (avoid stale closures)
    const wsRef = useRef<MakotiWS | null>(null);
    const pendingRef = useRef<Set<string>>(new Set());
    const collectedRef = useRef<Map<string, any>>(new Map());
    const botRef = useRef<BotId>('pvty_kill');
    const autoSwitchRef = useRef(false);
    const scanningRef = useRef(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const currentBestRef = useRef<string>('');
    const pendingSymbolRef = useRef<string>('');
    const msgHandlerRef = useRef<(data: any) => void>(() => {});
    const cancelScanRef = useRef<(() => void) | null>(null);
    const entryContractTypeRef = useRef<'DIGITOVER' | 'DIGITUNDER'>('DIGITOVER');
    const entryBarrierRef = useRef(3);

    // Sync Entry Digit refs
    useEffect(() => { entryContractTypeRef.current = entryContractType; }, [entryContractType]);
    useEffect(() => { entryBarrierRef.current = entryBarrier; }, [entryBarrier]);

    const showNotify = useCallback((msg: string, type: 'info' | 'success' | 'warn' = 'info') => {
        setNotification({ msg, type });
        setTimeout(() => setNotification(null), 3500);
    }, []);

    const setPending = useCallback((sym: string) => {
        setPendingSymbol(sym);
        pendingSymbolRef.current = sym;
    }, []);

    const clearPending = useCallback(() => {
        setPendingSymbol('');
        pendingSymbolRef.current = '';
    }, []);

    const applySwitch = useCallback((sym: string) => {
        currentBestRef.current = sym;
        clearPending();
        // 1. Runtime override — used by Purchase.js applyAlternateMarketsToCurrentTradeOptions
        try { window.DBot = window.DBot || {}; (window.DBot as any).__force_symbol = sym; } catch (_) {}
        // 2. QuickStrategy store — may or may not exist depending on the active tab
        try { const rs = (window as any).__store_instance; if (rs?.quick_strategy) rs.quick_strategy.setValue('symbol', sym); } catch (_) {}
        // 3. Blockly workspace — updates the trade_definition_market SYMBOL_LIST field.
        //    The block's onchange handler will call DBotStore.instance.dashboard.setBotBuilderSymbol automatically.
        try {
            const ws = (window as any).Blockly?.derivWorkspace;
            if (ws) {
                const b = ws.getAllBlocks().find((bl: any) => bl.type === 'trade_definition_market');
                if (b) b.setFieldValue('SYMBOL_LIST', sym);
            }
        } catch (_) {}
        // 4. Dashboard store — update directly via DBotStore.instance (the canonical access pattern).
        try {
            const store = DBotStore.instance;
            if (store?.dashboard?.setBotBuilderSymbol) store.dashboard.setBotBuilderSymbol(sym);
        } catch (_) {}
        (window as any).__makoti_lastContractSettled = false;
        showNotify(`Volatility Updated: ${SYMBOL_LABELS[sym]}`, 'success');
    }, [showNotify, clearPending]);

    const cleanup = useCallback(() => {
        try { wsRef.current?.close(); } catch (_) {}
        wsRef.current = null;
    }, []);

    /* ── Create persistent WS (reused across auto-scan cycles) ──────────── */
    const ensureWs = useCallback(() => {
        if (wsRef.current && wsRef.current.isOpen()) return wsRef.current;
        cleanup();
        const sendTicksRequest = () => {
            if (!window._newSystemWS || window._newSystemWS.readyState !== WebSocket.OPEN) return;
            const bot = botRef.current;
            const count = bot === 'pvty_kill' ? 1000 : bot === 'entry_digit' ? 100 : 60;
            setProgress(`Fetching ${count} ticks from all 10 volatilities…`);
            ALL_SYMBOLS.forEach(sym => {
                window._newSystemWS.send(JSON.stringify({ ticks_history: sym, count, end: 'latest', style: 'ticks' }));
            });
        };
        const mws = openMakotiWS(
            (data) => msgHandlerRef.current(data),
            () => { if (scanningRef.current) sendTicksRequest(); },
            () => { cancelScanRef.current?.(); },
            { skipAuth: true }
        );
        wsRef.current = mws;
        return mws;
    }, [cleanup]);

    /* ── Perform a single scan ──────────────────────────────────────────── */
    const performScan = useCallback((initial = false) => {
        if (scanningRef.current) return;
        const currentBot = botRef.current;
        cancelScanRef.current = null;
        scanningRef.current = true;
        setScanning(true);
        setProgress('Connecting to Deriv API…');
        if (initial) { setResults([]); setBestSymbols([]); }

        let finalized = false;
        pendingRef.current = new Set(ALL_SYMBOLS);
        collectedRef.current = new Map();
        const timeoutMs = currentBot === 'pvty_kill' ? 20000 : currentBot === 'entry_digit' ? 15000 : 10000;
        const scanTimeout = setTimeout(() => {
            if (!finalized) finalize();
        }, timeoutMs);

        msgHandlerRef.current = (data: any) => {
            if (data.error) {
                if (data.msg_type === 'history') {
                    const sym: string = data.echo_req?.ticks_history;
                    if (sym && pendingRef.current.has(sym)) {
                        pendingRef.current.delete(sym);
                        setProgress(`Fetched ${ALL_SYMBOLS.length - pendingRef.current.size} / ${ALL_SYMBOLS.length}…`);
                        if (pendingRef.current.size === 0 && !finalized) { clearTimeout(scanTimeout); finalize(); }
                    }
                }
                return;
            }
            if (data.msg_type === 'history' && data.history?.prices) {
                const sym: string = data.echo_req?.ticks_history;
                if (!sym || !pendingRef.current.has(sym)) return;
                pendingRef.current.delete(sym);
                collectedRef.current.set(sym, data.history.prices.map(Number));
                setProgress(`Fetched ${ALL_SYMBOLS.length - pendingRef.current.size} / ${ALL_SYMBOLS.length}…`);
                if (pendingRef.current.size === 0 && !finalized) { clearTimeout(scanTimeout); finalize(); }
            }
        };

        const finalize = () => {
            if (finalized) return;
            finalized = true;
            cancelScanRef.current = null;
            clearTimeout(scanTimeout);

            let best: string[] = [];
            let bestScore = 0;
            if (currentBot === 'pvty_kill') {
                const scanResults: SymbolDigitResult[] = [];
                collectedRef.current.forEach((prices: number[], sym) => {
                    if (!prices || prices.length < 100) return;
                    const pipSize = PIP_SIZES[sym] || 2;
                    const digits = prices.map(p => Number(Number(p).toFixed(pipSize).slice(-1)));
                    const pcts = calcDigitPcts(digits);
                    const qualifies = pcts[7] < 10 && pcts[8] < 10 && pcts[9] < 10;
                    scanResults.push({
                        symbol: sym, label: SYMBOL_LABELS[sym],
                        pcts, totalTicks: prices.length,
                        qualifies,
                        detail: qualifies ? '✅ 7,8,9 below 10%' : `7:${pcts[7].toFixed(1)}% 8:${pcts[8].toFixed(1)}% 9:${pcts[9].toFixed(1)}%`,
                    });
                });
                scanResults.sort((a, b) => {
                    /* First: qualifying volatilities (all three below 10%) come first */
                    if (a.qualifies && !b.qualifies) return -1;
                    if (!a.qualifies && b.qualifies) return 1;
                    /* Then: lowest sum of 7+8+9 wins */
                    return (a.pcts[7] + a.pcts[8] + a.pcts[9]) - (b.pcts[7] + b.pcts[8] + b.pcts[9]);
                });
                best = scanResults.map(r => r.symbol);
                bestScore = Math.round(Math.max(scanResults[0]?.pcts[7] ?? 0, scanResults[0]?.pcts[8] ?? 0, scanResults[0]?.pcts[9] ?? 0));
                setResults(scanResults);
                setBestSymbols(best.slice(0, 3));
            } else if (currentBot === 'entry_digit') {
                // Entry Digit Trigger Analysis — progressive, one volatility at a time
                const entryType = botRef.current === 'entry_digit' ? entryContractTypeRef.current : 'DIGITOVER';
                const entryBar = botRef.current === 'entry_digit' ? entryBarrierRef.current : 3;

                const symbols = Array.from(collectedRef.current.entries()).filter(([, p]) => p && p.length >= 30);
                const scanResults: TriggerDigitResult[] = [];
                let idx = 0;

                const analyzeNext = () => {
                    if (idx >= symbols.length) {
                        // Done — sort and finalize
                        scanResults.sort((a, b) => {
                            if (a.qualifies && !b.qualifies) return -1;
                            if (!a.qualifies && b.qualifies) return 1;
                            return (b.triggers[0]?.boost ?? 0) - (a.triggers[0]?.boost ?? 0);
                        });
                        best = scanResults.map(r => r.symbol);
                        bestScore = Math.round(scanResults[0]?.triggers[0]?.boost ?? 0);
                        setResults(scanResults);
                        setBestSymbols(best.slice(0, 3));
                        setScanning(false);
                        scanningRef.current = false;

                        // Show prediction
                        const topResult = scanResults[0];
                        const topTrigger = topResult?.triggers[0];
                        if (topTrigger) {
                            const winDigits = entryType === 'DIGITOVER' ? `${entryBar + 1}-9` : `0-${entryBar - 1}`;
                            setProgress(`PREDICTION → Volatility: ${topResult.label} | Entry Digit: D${topTrigger.digit} | Win: ${topResult.baselineWinPct.toFixed(0)}% → ${topTrigger.avgWinPctAfter.toFixed(0)}% (+${topTrigger.boost.toFixed(1)}%) on ${winDigits}`);
                        } else {
                            setProgress('No strong trigger pattern found');
                        }
                        cleanup();
                        return;
                    }

                    const [sym, prices] = symbols[idx];
                    const pipSize = PIP_SIZES[sym] || 2;
                    const digits = prices.map(p => Number(Number(p).toFixed(pipSize).slice(-1)));
                    const analysis = analyzeTriggerDigits(digits, entryType, entryBar);

                    const bestTrigger = analysis.triggers[0];
                    const qualifies = bestTrigger !== undefined && bestTrigger.boost > 5 && bestTrigger.consistency >= 50;
                    const detail = bestTrigger
                        ? `Best: D${bestTrigger.digit} (${bestTrigger.occurrences}x) → +${bestTrigger.boost.toFixed(1)}% boost | ${bestTrigger.consistency.toFixed(0)}% consistent`
                        : 'No strong trigger found';

                    scanResults.push({
                        symbol: sym, label: SYMBOL_LABELS[sym],
                        baselinePcts: analysis.baselinePcts,
                        baselineWinPct: analysis.baselineWinPct,
                        triggers: analysis.triggers,
                        qualifies,
                        detail,
                    });

                    idx++;
                    setProgress(`Analyzing ${SYMBOL_LABELS[sym]}… (${idx}/${symbols.length})`);
                    setResults([...scanResults]);

                    setTimeout(analyzeNext, 400);
                };

                // Start progressive analysis after a small delay
                setTimeout(analyzeNext, 100);
                return; // Exit finalize early — analysis continues async
            } else {
                const scanResults: SymbolDirectionResult[] = [];
                collectedRef.current.forEach((prices: number[], sym) => {
                    if (!prices || prices.length < 5) return;
                    const a = calcMicroChoppiness(prices);
                    a.symbol = sym; a.label = SYMBOL_LABELS[sym];
                    scanResults.push(a);
                });
                scanResults.sort((a, b) => b.choppinessScore - a.choppinessScore);
                best = scanResults.map(r => r.symbol);
                bestScore = scanResults[0]?.choppinessScore ?? 0;
                setResults(scanResults);
                setBestSymbols(best.slice(0, 3));
            }

            setScanning(false);
            scanningRef.current = false;

            const bestSym = best[0] || '';
            const bestLabel = bestSym ? SYMBOL_LABELS[bestSym] : '—';

            if (currentBot === 'rf_v4') {
                if (bestSym && bestSym !== currentBestRef.current && autoSwitchRef.current) {
                    if ((window as any).__makoti_lastContractSettled) {
                        applySwitch(bestSym);
                    } else {
                        setPending(bestSym);
                        showNotify(`Waiting for contract settlement to switch to ${bestLabel}…`, 'warn');
                    }
                }

                const ps = pendingSymbolRef.current;
                if (ps && (window as any).__makoti_lastContractSettled && autoSwitchRef.current) {
                    if (best.indexOf(ps) >= 0) applySwitch(ps);
                    else clearPending();
                }

                if (autoSwitchRef.current) {
                    const p = pendingSymbolRef.current;
                    setProgress(p ? `Auto: Pending ${SYMBOL_LABELS[p]} (wait settle)` : `Auto: Best ${bestLabel} (${bestScore}%)`);
                } else {
                    setProgress(`Top: ${bestLabel} (${bestScore}%)`);
                    cleanup();
                }
            } else if (currentBot === 'entry_digit') {
                const entryResults = results as TriggerDigitResult[];
                const bestTrigger = entryResults[0]?.triggers[0];
                if (bestTrigger) {
                    const curType = entryContractTypeRef.current;
                    const curBar = entryBarrierRef.current;
                    const winDigits = curType === 'DIGITOVER'
                        ? `${curBar + 1}-9`
                        : `0-${curBar - 1}`;
                    setProgress(`Best: ${bestLabel} | Trigger: D${bestTrigger.digit} → +${bestTrigger.boost.toFixed(1)}% boost on ${winDigits} | ${bestTrigger.consistency.toFixed(0)}% consistent`);
                } else {
                    setProgress('No strong trigger pattern found across volatilities');
                }
                cleanup();
            } else {
                setProgress(`Top: ${bestLabel} (max 7/8/9: ${bestScore}%)`);
                cleanup();
            }
        };
        cancelScanRef.current = finalize;

        const mws = ensureWs();
        if (mws.isOpen()) {
            if (currentBot === 'pvty_kill') {
                setProgress('Fetching 1000 ticks from all 10 volatilities…');
                ALL_SYMBOLS.forEach(sym => mws.send({ ticks_history: sym, count: 1000, end: 'latest', style: 'ticks' }));
            } else if (currentBot === 'entry_digit') {
                setProgress('Fetching 100 ticks from all 10 volatilities…');
                ALL_SYMBOLS.forEach(sym => mws.send({ ticks_history: sym, count: 100, end: 'latest', style: 'ticks' }));
            } else {
                setProgress('Fetching 60 ticks from all 10 volatilities…');
                ALL_SYMBOLS.forEach(sym => mws.send({ ticks_history: sym, count: 60, end: 'latest', style: 'ticks' }));
            }
        }
        // If not open yet, ensureWs will trigger onReady → which fires the requests
    }, [cleanup, ensureWs, showNotify, applySwitch, setPending, clearPending]);

    /* ── Manual analyze button ──────────────────────────────────────────── */
    const analyze = useCallback(() => {
        if (scanningRef.current) return;
        botRef.current = bot;

        if (autoSwitch && bot === 'rf_v4') {
            currentBestRef.current = '';
            clearPending();
            autoSwitchRef.current = true;
            setAutoSwitcherActive(true);
            startPocListener();
            if (intervalRef.current) clearInterval(intervalRef.current);
            intervalRef.current = setInterval(() => performScan(false), 3000);
            performScan(true); // initial scan with results cleared
        } else {
            autoSwitchRef.current = false;
            setAutoSwitcherActive(false);
            stopPocListener();
            if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
            performScan(true);
        }
    }, [bot, autoSwitch, performScan, clearPending]);

    /* ── Toggle auto-switcher ───────────────────────────────────────────── */
    const toggleAutoSwitch = useCallback(() => {
        setAutoSwitch(prev => {
            if (prev) {
                autoSwitchRef.current = false;
                setAutoSwitcherActive(false);
                clearPending();
                currentBestRef.current = '';
                stopPocListener();
                if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
            }
            return !prev;
        });
    }, [clearPending]);

    useEffect(() => {
        return () => {
            autoSwitchRef.current = false;
            stopPocListener();
            if (intervalRef.current) clearInterval(intervalRef.current);
            try { wsRef.current?.close(); } catch (_) {}
        };
    }, []);

    return (
        <div className='mw-scanner'>
            {notification && (
                <div className={`mw-scanner__notif mw-scanner__notif--${notification.type}`}>{notification.msg}</div>
            )}
            <div className='mw-scanner__controls'>
                <div className='mw-field'>
                    <label className='mw-label'>Bot Selection</label>
                    <MwSelect value={bot} options={[
                        { value: 'pvty_kill', label: 'Poverty Killer' },
                        { value: 'rf_v4', label: 'Rise/Fall V4' },
                        { value: 'entry_digit', label: 'Entry Digit' },
                    ]}
                        onChange={v => setBot(v as BotId)} disabled={scanning} />
                </div>
                <div className='mw-scanner__desc'>
                    {bot === 'pvty_kill'
                        ? 'Scans 1 000 ticks per volatility. Finds markets where digits 7, 8 and 9 each stay below 10%.'
                        : bot === 'entry_digit'
                        ? 'Deep trigger analysis — finds which digit appearance causes winning digits to surge. Provides the perfect entry trigger digit for your contract.'
                        : 'Analyses 60 recent ticks per volatility (current candle). Finds choppy micro-markets — auto-switches every 3s.'}
                </div>
                {bot === 'entry_digit' && (
                    <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                        <div className='mw-field' style={{ flex: 1 }}>
                            <label className='mw-label'>Contract Type</label>
                            <MwSelect value={entryContractType} options={[
                                { value: 'DIGITOVER', label: 'OVER' },
                                { value: 'DIGITUNDER', label: 'UNDER' },
                            ]}
                                onChange={v => setEntryContractType(v as 'DIGITOVER' | 'DIGITUNDER')} disabled={scanning} />
                        </div>
                        <div className='mw-field' style={{ flex: 1 }}>
                            <label className='mw-label'>Barrier Digit</label>
                            <MwSelect value={String(entryBarrier)} options={[
                                { value: '0', label: '0' }, { value: '1', label: '1' }, { value: '2', label: '2' },
                                { value: '3', label: '3' }, { value: '4', label: '4' }, { value: '5', label: '5' },
                                { value: '6', label: '6' }, { value: '7', label: '7' }, { value: '8', label: '8' },
                                { value: '9', label: '9' },
                            ]}
                                onChange={v => setEntryBarrier(parseInt(v))} disabled={scanning} />
                        </div>
                    </div>
                )}
                {bot === 'rf_v4' && (
                    <label className='mw-switch-row'>
                        <span className='mw-switch-label'>Auto Switcher</span>
                        <div className='mw-toggle' onClick={toggleAutoSwitch}>
                            <div className={`mw-toggle__track${autoSwitch ? ' mw-toggle__track--on' : ''}`}>
                                <div className={`mw-toggle__thumb${autoSwitch ? ' mw-toggle__thumb--on' : ''}`} />
                            </div>
                        </div>
                        {autoSwitcherActive && <span className='mw-switch-active'>ACTIVE</span>}
                        {pendingSymbol && <span className='mw-switch-pending'>⏳ WIN REQUIRED</span>}
                    </label>
                )}
                <button className={`mw-btn mw-btn--scan${scanning ? ' mw-btn--busy' : ''}`} onClick={analyze} disabled={scanning}>
                    {scanning ? <><span className='mw-spin' /> Analyzing…</> : 'Analyze'}
                </button>
                {progress && <div className='mw-scanner__progress'>{progress}</div>}
            </div>
            {results.length > 0 && (
                <div className='mw-scanner__results'>
                    <div className='mw-scanner__results-head'>
                        {bot === 'pvty_kill'
                            ? 'Digit 7 / 8 / 9 Distribution (1 000 ticks)'
                            : bot === 'entry_digit'
                            ? `Entry Digit Trigger Analysis (100 ticks) — ${entryContractType === 'DIGITOVER' ? 'OVER' : 'UNDER'} ${entryBarrier}`
                            : `Micro-Choppiness (current candle, 60 ticks) ${autoSwitcherActive ? '— Auto-switching ON' : ''}`}
                    </div>
                    {bestSymbols.length > 0 && (
                        <div className='mw-scanner__best'>
                            <span className='mw-scanner__best-lbl'>Best:</span>
                            {bestSymbols.map(s => <span key={s} className='mw-scanner__badge'>{SYMBOL_LABELS[s]}</span>)}
                        </div>
                    )}
                    <div className='mw-scanner__list'>
                        {results.map((r, idx) => (
                            <div key={r.symbol} className={`mw-scanner__row${idx === 0 ? ' mw-scanner__row--match' : ''}`}>
                                <div className='mw-scanner__row-head'>
                                    <span className='mw-scanner__sym'>{r.label}</span>
                                    <span className='mw-scanner__row-detail'>{r.detail}</span>
                                    {idx === 0 && <span className='mw-scanner__tag'>BEST</span>}
                                </div>
                                {isDigitResult(r) && (
                                    <div className='mw-scanner__bars'>
                                        {r.pcts.map((p, i) => (
                                            <div key={i} className={`mw-scanner__bar-wrap${[7, 8, 9].includes(i) ? ' mw-scanner__bar-wrap--hi' : ''}`} title={`Digit ${i}: ${p.toFixed(2)}%`}>
                                                <div className='mw-scanner__bar-fill' style={{ height: `${Math.min(100, p * 4)}%` }} />
                                                <span className='mw-scanner__bar-pct'>{p.toFixed(1)}%</span>
                                                <span className='mw-scanner__bar-lbl'>{i}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {isTriggerResult(r) && (
                                    <div style={{ padding: '4px 0' }}>
                                        {/* Baseline digit distribution */}
                                        <div style={{ fontSize: 9, color: '#888', marginBottom: 4 }}>
                                            Baseline (100 ticks) — Win rate: <span style={{ color: '#ffd700' }}>{r.baselineWinPct.toFixed(1)}%</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: 3, marginBottom: 8, flexWrap: 'wrap' }}>
                                            {r.baselinePcts.map((p, i) => {
                                                const isWin = entryContractType === 'DIGITOVER' ? i > entryBarrier : i < entryBarrier;
                                                return (
                                                    <div key={i} style={{
                                                        background: isWin ? '#1a3d1a' : '#2d1a1a',
                                                        border: `1px solid ${isWin ? '#4caf50' : '#666'}`,
                                                        borderRadius: 3, padding: '1px 4px', fontSize: 8, textAlign: 'center',
                                                        minWidth: 32,
                                                    }}>
                                                        <div style={{ color: isWin ? '#4caf50' : '#f44336', fontWeight: 'bold' }}>D{i}</div>
                                                        <div style={{ color: '#ccc' }}>{p.toFixed(1)}%</div>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {/* Top triggers with full percentage comparison */}
                                        {r.triggers.slice(0, 3).map((t, ti) => {
                                            const trendColor = t.patternTrend.trend === 'strengthening' ? '#4caf50'
                                                : t.patternTrend.trend === 'weakening' ? '#f44336'
                                                : t.patternTrend.trend === 'new' ? '#2196f3'
                                                : t.patternTrend.trend === 'dying' ? '#ff9800' : '#888';
                                            const trendLabel = t.patternTrend.trend === 'strengthening' ? '↑ STRENGTHENING'
                                                : t.patternTrend.trend === 'weakening' ? '↓ WEAKENING'
                                                : t.patternTrend.trend === 'new' ? '★ NEW'
                                                : t.patternTrend.trend === 'dying' ? '✕ DYING' : '→ STABLE';
                                            return (
                                            <div key={t.digit} style={{
                                                background: ti === 0 ? '#0f1f0f' : '#111',
                                                border: `2px solid ${ti === 0 ? '#4caf50' : '#333'}`,
                                                borderRadius: 6, padding: 10, marginBottom: 8,
                                            }}>
                                                {/* Big trigger digit + boost */}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                                                    <div style={{
                                                        width: 52, height: 52, borderRadius: 8,
                                                        background: '#ffd700', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        flexDirection: 'column', flexShrink: 0,
                                                    }}>
                                                        <div style={{ fontSize: 8, color: '#000', fontWeight: 'bold' }}>TRIGGER</div>
                                                        <div style={{ fontSize: 22, color: '#000', fontWeight: 'bold', lineHeight: 1 }}>D{t.digit}</div>
                                                    </div>
                                                    <div style={{ flex: 1 }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                                                            <span style={{ color: '#fff', fontSize: 13, fontWeight: 'bold' }}>
                                                                {r.baselineWinPct.toFixed(0)}% → {t.avgWinPctAfter.toFixed(0)}% win rate
                                                            </span>
                                                            <span style={{ color: t.boost > 10 ? '#4caf50' : '#ff9800', fontSize: 14, fontWeight: 'bold' }}>
                                                                +{t.boost.toFixed(1)}%
                                                            </span>
                                                        </div>
                                                        <div style={{ display: 'flex', gap: 12, fontSize: 9, color: '#888' }}>
                                                            <span>{t.occurrences}x appeared</span>
                                                            <span>{t.consistency.toFixed(0)}% consistent</span>
                                                            <span style={{ color: trendColor, fontWeight: 'bold' }}>{trendLabel}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Digit shift bars - visual comparison */}
                                                <div style={{ fontSize: 9, color: '#aaa', marginBottom: 6 }}>
                                                    After D{t.digit}, digit distribution shifts:
                                                </div>
                                                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                                    {t.digitShifts.filter(s => Math.abs(s.shift) > 1).sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift)).map(s => {
                                                        const isWin = entryContractType === 'DIGITOVER' ? s.digit > entryBarrier : s.digit < entryBarrier;
                                                        const isPositive = isWin ? s.shift > 0 : s.shift < 0;
                                                        return (
                                                            <div key={s.digit} style={{
                                                                background: '#0d0d1a', border: '1px solid #333',
                                                                borderRadius: 4, padding: '4px 8px', textAlign: 'center', minWidth: 55,
                                                            }}>
                                                                <div style={{ fontSize: 10, fontWeight: 'bold', color: isWin ? '#4caf50' : '#f44336' }}>D{s.digit}</div>
                                                                <div style={{ fontSize: 8, color: '#666' }}>{s.before.toFixed(0)}% → {s.after.toFixed(0)}%</div>
                                                                <div style={{ fontSize: 11, fontWeight: 'bold', color: isPositive ? '#4caf50' : '#f44336' }}>
                                                                    {s.shift > 0 ? '+' : ''}{s.shift.toFixed(1)}%
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                {/* Trend detail */}
                                                <div style={{ marginTop: 6, fontSize: 8, color: '#555' }}>
                                                    First 50 ticks: {t.patternTrend.olderBoost > 0 ? '+' : ''}{t.patternTrend.olderBoost.toFixed(1)}% boost ({t.patternTrend.olderOccurrences}x)
                                                    {' | '}
                                                    Last 50 ticks: {t.patternTrend.recentBoost > 0 ? '+' : ''}{t.patternTrend.recentBoost.toFixed(1)}% boost ({t.patternTrend.recentOccurrences}x)
                                                </div>
                                            </div>
                                            );
                                        })}
                                    </div>
                                )}
                                {!isDigitResult(r) && !isTriggerResult(r) && (() => {
                                    const dr = r as SymbolDirectionResult;
                                    return (
                                        <div className='mw-scanner__dir-bar'>
                                            <div className='mw-scanner__dir-fill' style={{
                                                width: `${dr.choppinessScore}%`,
                                                background: dr.choppinessScore >= 70 ? 'linear-gradient(90deg, #22c55e, #16a34a)' : dr.choppinessScore >= 55 ? 'linear-gradient(90deg, #eab308, #ca8a04)' : 'linear-gradient(90deg, #ef4444, #dc2626)',
                                            }} />
                                        </div>
                                    );
                                })()}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
