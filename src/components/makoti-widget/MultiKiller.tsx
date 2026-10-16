import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ALL_SYMBOLS, SYMBOL_LABELS, PIP_SIZES } from '@/components/makoti-widget/makoti-ws';
import { onNewSystemMessage, sendViaNewSystemWithPromise } from '@/auth/NewDerivAuth';
import { useStore } from '@/hooks/useStore';
import { createBot15Plan, detectBot15Direction, isBot15DirectionalLoss, type Bot15Direction, type Bot15StakeConfig } from './bot15-strategy';
import './makoti-widget.scss';

type MultiKillerStrategy =
    | 'over'
    | 'under'
    | 'rise'
    | 'fall'
    | 'higher'
    | 'lower'
    | 'differs'
    | 'only_ups'
    | 'only_downs';

const LABELS: Record<MultiKillerStrategy, string> = {
    over: 'Over', under: 'Under', rise: 'Rise', fall: 'Fall',
    higher: 'Higher', lower: 'Lower',
    differs: 'Differs',
    only_ups: 'Only Ups', only_downs: 'Only Downs',
};

const CONTRACT_TYPE: Record<MultiKillerStrategy, string> = {
    over: 'DIGITOVER', under: 'DIGITUNDER', rise: 'CALL', fall: 'PUT',
    higher: 'CALL', lower: 'PUT',
    differs: 'DIGITDIFF',
    only_ups: 'RUNHIGH', only_downs: 'RUNLOW',
};

const DURATION: Record<MultiKillerStrategy, number> = {
    over: 1, under: 1, rise: 1, fall: 1, higher: 1, lower: 1, differs: 1,
    only_ups: 2, only_downs: 2,
};

const NEEDS_BARRIER: Record<MultiKillerStrategy, boolean> = {
    over: true, under: true, rise: false, fall: false,
    higher: true, lower: true,
    differs: true, only_ups: false, only_downs: false,
};

const HAS_DELAY: Record<MultiKillerStrategy, boolean> = {
    over: false, under: false, rise: true, fall: true,
    higher: false, lower: false,
    differs: false, only_ups: false, only_downs: false,
};

const USES_TICK_DIR: Record<MultiKillerStrategy, boolean> = {
    over: false, under: false, rise: true, fall: true,
    higher: true, lower: true,
    differs: false, only_ups: true, only_downs: true,
};

let _buySeq = 0;

type MultiKillerMode = 'standard' | 'bot15';
type MarketTick = { quote: number; epoch: number };
type Bot15RiskConfig = {
    maxRoundStake: number;
    maxSessionLoss: number;
    cooldownTicks: number;
};

const higherLowerBarrierCache = new Map<string, Promise<number | null>>();

async function getHigherLowerBarrierFloor(symbol: string): Promise<number | null> {
    const cached = higherLowerBarrierCache.get(symbol);
    if (cached) return cached;

    const request = sendViaNewSystemWithPromise({ contracts_for: symbol })
        .then((response: any) => {
            const available = response?.contracts_for?.available;
            if (!Array.isArray(available)) return null;
            const entry = available.find((item: any) =>
                (item.contract_type === 'CALL' || item.contract_type === 'PUT') &&
                item.expiry_type === 'intraday' &&
                typeof item.barrier === 'string',
            );
            if (!entry) return null;
            const value = Math.abs(parseFloat(entry.barrier));
            return Number.isFinite(value) && value > 0 ? value : null;
        })
        .catch(() => null);

    higherLowerBarrierCache.set(symbol, request);
    return request;
}

interface TradeEntry {
    contractId: string;
    strategy: MultiKillerStrategy;
    stake: number;
    roundId: number;
}

interface PendingDelay {
    ticksNeeded: number;
    resolve: () => void;
    gen: number;
}

export const MultiKiller: React.FC = () => {
    const { transactions } = useStore();
    const STORAGE_KEY = 'makoti_multikiller_config';
    const loadConfig = () => {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
    };
    const cfg = loadConfig();

    const [mode, setMode] = useState<MultiKillerMode>(cfg.mode || 'standard');
    const [market, setMarket] = useState(cfg.market || 'R_100');
    const [selected, setSelected] = useState<MultiKillerStrategy[]>(cfg.selected || []);
    const [stakes, setStakes] = useState<Record<string, string>>(cfg.stakes || {});
    const [barriers, setBarriers] = useState<Record<string, string>>(cfg.barriers || {
        over: '5', under: '5', differs: '5', higher: '5', lower: '5',
    });
    const [delays, setDelays] = useState<Record<string, number>>(cfg.delays || {
        rise: 0, fall: 0,
    });
    const [hlDuration, setHlDuration] = useState(cfg.hlDuration || 5);
    const [hlOffset, setHlOffset] = useState(cfg.hlOffset || '0.02');
    const [tickDirection, setTickDirection] = useState(cfg.tickDirection || '0');
    const [tickDirMode, setTickDirMode] = useState<'any' | 'ups' | 'downs'>(cfg.tickDirMode || 'any');
    const [accuracy, setAccuracy] = useState(cfg.accuracy ?? false);
    const [bot15Stakes, setBot15Stakes] = useState<Bot15StakeConfig>(cfg.bot15Stakes || {
        riseToFall: 1,
        riseToOnlyUps: 1,
        riseFallRetry: 1,
        fallToOnlyDowns: 1,
        fallToRise: 1,
        fallRiseRetry: 1,
    });
    const [bot15Risk, setBot15Risk] = useState<Bot15RiskConfig>(cfg.bot15Risk || {
        maxRoundStake: 3,
        maxSessionLoss: 10,
        cooldownTicks: 3,
    });
    const [running, setRunning] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [runPhase, setRunPhase] = useState<'idle' | 'waiting' | 'buying' | 'settling'>('idle');
    const [buyProgress, setBuyProgress] = useState({ done: 0, total: 0 });
    const [settleProgress, setSettleProgress] = useState({ done: 0, total: 0 });
    const [tickProgress, setTickProgress] = useState({ dir: '...', count: 0, target: 0 });
    const [analyzing, setAnalyzing] = useState(false);
    const [analyzeResult, setAnalyzeResult] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // Persist config to localStorage
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            mode, market, selected, stakes, barriers, delays, hlDuration, hlOffset, tickDirection, tickDirMode, accuracy, bot15Stakes, bot15Risk,
        }));
    }, [mode, market, selected, stakes, barriers, delays, hlDuration, hlOffset, tickDirection, tickDirMode, accuracy, bot15Stakes, bot15Risk]);

    // Auto-sync paired contracts: rise↔fall share delays, ups↔downs share stakes
    useEffect(() => {
        const hasRise = selected.includes('rise');
        const hasFall = selected.includes('fall');
        const hasUps = selected.includes('ups');
        const hasDowns = selected.includes('downs');
        if (hasRise && hasFall) {
            setDelays(p => {
                const r = p.rise ?? 0;
                const f = p.fall ?? 0;
                if (r !== f) return { ...p, fall: r };
                return p;
            });
        }
        if (hasUps && hasDowns) {
            setStakes(p => {
                const u = p.ups ?? '';
                const d = p.downs ?? '';
                if (u && !d) return { ...p, downs: u };
                if (d && !u) return { ...p, ups: d };
                return p;
            });
        }
    }, [selected]);

    const tradesRef = useRef<TradeEntry[]>([]);
    const runningRef = useRef(false);
    const selectedRef = useRef<MultiKillerStrategy[]>([]);
    const stakesRef = useRef<Record<string, string>>({});
    const barriersRef = useRef<Record<string, string>>({ over: '5', under: '5', differs: '5', higher: '5', lower: '5' });
    const delaysRef = useRef<Record<string, number>>({ rise: 0, fall: 0 });
    const hlDurationRef = useRef(5);
    const hlOffsetRef = useRef('0.02');
    const genRef = useRef(0);
    const roundIdRef = useRef(0);
    const pendingDelaysRef = useRef<PendingDelay[]>([]);
    const buyListenersRef = useRef<Array<() => void>>([]);

    // Tick direction tracking
    const lastTickPriceRef = useRef<number | null>(null);
    const consecutiveUpRef = useRef(0);
    const consecutiveDownRef = useRef(0);
    const tickDirResolveRef = useRef<(() => void) | null>(null);
    const tickDirTargetRef = useRef(0);
    const tickDirActiveRef = useRef(false);
    const tickDirModeRef = useRef<'any' | 'ups' | 'downs'>('any');
    const accuracyRef = useRef(false);
    const recentPricesRef = useRef<number[]>([]);
    const recentTicksRef = useRef<MarketTick[]>([]);
    const bot15ActiveRef = useRef(false);
    const bot15SignalResolveRef = useRef<((direction: Bot15Direction | null) => void) | null>(null);
    const bot15TickHandlerRef = useRef<((tick: MarketTick) => void) | null>(null);
    const bot15RiskRef = useRef<Bot15RiskConfig>(bot15Risk);
    const bot15CooldownRef = useRef(0);
    const bot15SessionProfitRef = useRef(0);
    const bot15RiskStopRef = useRef(false);

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
    useEffect(() => { hlDurationRef.current = hlDuration; }, [hlDuration]);
    useEffect(() => { hlOffsetRef.current = hlOffset; }, [hlOffset]);
    useEffect(() => { tickDirModeRef.current = tickDirMode; }, [tickDirMode]);
    useEffect(() => { accuracyRef.current = accuracy; }, [accuracy]);
    useEffect(() => { bot15RiskRef.current = bot15Risk; }, [bot15Risk]);

    const showTickDir = selected.some(s => USES_TICK_DIR[s]);
    const hasDirectional = selected.some(s => ['rise', 'fall', 'higher', 'lower', 'ups', 'downs'].includes(s));

    // RSI(3) calculation from recent tick prices
    const calcRSI = useCallback((prices: number[]): number => {
        if (prices.length < 4) return 50;
        let gains = 0;
        let losses = 0;
        for (let i = prices.length - 3; i < prices.length; i++) {
            if (i <= 0) continue;
            const diff = prices[i] - prices[i - 1];
            if (diff > 0) gains += diff;
            else if (diff < 0) losses += Math.abs(diff);
        }
        if (losses === 0 && gains === 0) return 50;
        if (losses === 0) return 100;
        const rs = gains / losses;
        return 100 - 100 / (1 + rs);
    }, []);

    // EMA stretch — how far price is from its EMA (as multiplier of recent range)
    const calcEMAStretch = useCallback((prices: number[]): number => {
        if (prices.length < 10) return 0;
        const emaPeriod = 9;
        let ema = prices[0];
        const k = 2 / (emaPeriod + 1);
        for (let i = 1; i < prices.length; i++) {
            ema = prices[i] * k + ema * (1 - k);
        }
        const lastPrice = prices[prices.length - 1];
        const distance = Math.abs(lastPrice - ema);
        // Normalize by average recent move
        let avgMove = 0;
        for (let i = 1; i < prices.length; i++) {
            avgMove += Math.abs(prices[i] - prices[i - 1]);
        }
        avgMove /= (prices.length - 1);
        return avgMove > 0 ? distance / avgMove : 0;
    }, []);

    // Check if accuracy conditions are met (2-of-3 indicators)
    const checkAccuracy = useCallback((direction: 'up' | 'down'): boolean => {
        const prices = recentPricesRef.current;
        if (prices.length < 4) return true;
        const rsi = calcRSI(prices);
        const stretch = calcEMAStretch(prices);
        const lastPrice = prices[prices.length - 1];
        const slice10 = prices.slice(-10);
        const range = Math.max(...slice10) - Math.min(...slice10);
        const atHigh = range > 0 && (lastPrice - Math.min(...slice10)) / range > 0.85;
        const atLow = range > 0 && (Math.max(...slice10) - lastPrice) / range > 0.85;

        let passed = 0;
        if (direction === 'up') {
            if (rsi > 70) passed++;
            if (stretch > 1.0) passed++;
            if (atHigh) passed++;
        } else {
            if (rsi < 30) passed++;
            if (stretch > 1.0) passed++;
            if (atLow) passed++;
        }
        return passed >= 2;
    }, [calcRSI, calcEMAStretch]);

    // Tick listener — handles tick delays AND tick direction
    useEffect(() => {
        if (!running) return;

        const unsub = onNewSystemMessage((event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.msg_type !== 'tick') return;
                const tickSymbol = data.tick?.symbol ?? data.tick?.underlying_symbol;
                // The shared WebSocket carries ticks from other symbols too;
                // those must not consume this bot's wait/delay counters.
                if (tickSymbol && tickSymbol !== market) return;
                const price = parseFloat(data.tick?.quote ?? data.tick?.bid ?? data.tick?.ask);
                if (isNaN(price)) return;
                const epoch = Number(data.tick?.epoch);
                if (Number.isFinite(epoch)) {
                    recentTicksRef.current.push({ quote: price, epoch });
                    if (recentTicksRef.current.length > 100) recentTicksRef.current.shift();
                }

                // ── Always update lastTickPrice for next comparison ──
                const prevPrice = lastTickPriceRef.current;
                lastTickPriceRef.current = price;

                // ── Store recent prices for indicator calculations ──
                recentPricesRef.current.push(price);
                if (recentPricesRef.current.length > 100) recentPricesRef.current.shift();

                // Bot 15 uses the same two-consecutive-movement signal as the
                // original bot, but keeps the decision inside this widget.
                if (bot15CooldownRef.current > 0) bot15CooldownRef.current--;
                if (bot15ActiveRef.current && bot15CooldownRef.current === 0 && bot15SignalResolveRef.current) {
                    const direction = detectBot15Direction(recentPricesRef.current);
                    if (direction) {
                        const resolve = bot15SignalResolveRef.current;
                        bot15SignalResolveRef.current = null;
                        bot15ActiveRef.current = false;
                        resolve(direction);
                    }
                }
                bot15TickHandlerRef.current?.({ quote: price, epoch });

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
                if (!tickDirActiveRef.current) return;
                if (prevPrice === null) {
                    log(`📊 Baseline: ${price}`);
                    return;
                }

                const target = tickDirTargetRef.current;
                if (target <= 0 || !tickDirResolveRef.current) return;

                const diff = price - prevPrice;
                const mode = tickDirModeRef.current;

                if (diff > 0) {
                    if (mode !== 'downs') {
                        consecutiveUpRef.current++;
                    }
                    consecutiveDownRef.current = 0;
                } else if (diff < 0) {
                    if (mode !== 'ups') {
                        consecutiveDownRef.current++;
                    }
                    consecutiveUpRef.current = 0;
                }
                // diff === 0: no change to counters

                const upCount = consecutiveUpRef.current;
                const downCount = consecutiveDownRef.current;

                if (upCount >= target) {
                    const accuracyOn = accuracyRef.current;
                    if (accuracyOn) {
                        const prices = recentPricesRef.current;
                        const rsi = calcRSI(prices);
                        const stretch = calcEMAStretch(prices);
                        const lastP = prices[prices.length - 1];
                        const mn = Math.min(...prices.slice(-10));
                        const mx = Math.max(...prices.slice(-10));
                        const rng = mx - mn;
                        const atHigh = rng > 0 && (lastP - mn) / rng > 0.85;
                        const atLow = rng > 0 && (mx - lastP) / rng > 0.85;
                        let cnt = 0;
                        if (rsi > 70) cnt++; else if (rsi < 30) cnt++;
                        if (stretch > 1.0) cnt++;
                        if (atHigh) cnt++;
                        log(`  📐 RSI: ${rsi.toFixed(1)} ${rsi > 70 ? '✅' : '❌'} | stretch: ${stretch.toFixed(2)}x ${stretch > 1.0 ? '✅' : '❌'} | atHigh: ${atHigh ? '✅' : '❌'} → ${cnt}/3`);
                    }
                    const passed = !accuracyOn || checkAccuracy('up');
                    if (accuracyOn && !passed) {
                        log(`📊 ${upCount} UP — accuracy FAILED, waiting...`);
                        consecutiveUpRef.current = 0;
                        consecutiveDownRef.current = 0;
                        return;
                    }
                    const accTag = accuracyOn ? ' ✅ ACCURATE' : '';
                    log(`📊 ${upCount} consecutive UP (${prevPrice}→${price}) — GO!${accTag}`);
                    setTickProgress({ dir: 'GO!', count: target, target });
                    const resolve = tickDirResolveRef.current;
                    tickDirResolveRef.current = null;
                    tickDirActiveRef.current = false;
                    consecutiveUpRef.current = 0;
                    consecutiveDownRef.current = 0;
                    resolve();
                    return;
                }

                if (downCount >= target) {
                    const accuracyOn = accuracyRef.current;
                    if (accuracyOn) {
                        const prices = recentPricesRef.current;
                        const rsi = calcRSI(prices);
                        const stretch = calcEMAStretch(prices);
                        const lastP = prices[prices.length - 1];
                        const mn = Math.min(...prices.slice(-10));
                        const mx = Math.max(...prices.slice(-10));
                        const rng = mx - mn;
                        const atHigh = rng > 0 && (lastP - mn) / rng > 0.85;
                        const atLow = rng > 0 && (mx - lastP) / rng > 0.85;
                        let cnt = 0;
                        if (rsi < 30) cnt++; else if (rsi > 70) cnt++;
                        if (stretch > 1.0) cnt++;
                        if (atLow) cnt++;
                        log(`  📐 RSI: ${rsi.toFixed(1)} ${rsi < 30 ? '✅' : '❌'} | stretch: ${stretch.toFixed(2)}x ${stretch > 1.0 ? '✅' : '❌'} | atLow: ${atLow ? '✅' : '❌'} → ${cnt}/3`);
                    }
                    const passed = !accuracyOn || checkAccuracy('down');
                    if (accuracyOn && !passed) {
                        log(`📊 ${downCount} DOWN — accuracy FAILED, waiting...`);
                        consecutiveUpRef.current = 0;
                        consecutiveDownRef.current = 0;
                        return;
                    }
                    const accTag = accuracyOn ? ' ✅ ACCURATE' : '';
                    log(`📊 ${downCount} consecutive DOWN (${prevPrice}→${price}) — GO!${accTag}`);
                    setTickProgress({ dir: 'GO!', count: target, target });
                    const resolve = tickDirResolveRef.current;
                    tickDirResolveRef.current = null;
                    tickDirActiveRef.current = false;
                    consecutiveUpRef.current = 0;
                    consecutiveDownRef.current = 0;
                    resolve();
                    return;
                }

                if (upCount > 0) {
                    setTickProgress({ dir: 'UP', count: upCount, target });
                    log(`  ↑ UP ${upCount}/${target} (${prevPrice}→${price})`);
                } else if (downCount > 0) {
                    setTickProgress({ dir: 'DOWN', count: downCount, target });
                    log(`  ↓ DOWN ${downCount}/${target} (${prevPrice}→${price})`);
                }
            } catch {}
        });
        return unsub;
    }, [running, log, market]);

    // Wait for N ticks in same direction — returns true if matched, false if cancelled
    const waitForTickDirection = useCallback((target: number, gen: number): Promise<boolean> => {
        return new Promise((resolve) => {
            if (target <= 0) { resolve(true); return; }
            tickDirTargetRef.current = target;
            tickDirActiveRef.current = true;
            consecutiveUpRef.current = 0;
            consecutiveDownRef.current = 0;
            lastTickPriceRef.current = null;
            // Store resolve so stop() can call it to unblock
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
    const buyOne = useCallback(async (strategy: MultiKillerStrategy, stakeNum: number, roundId: number, captureEntry = false): Promise<{ cid: string; strategy: MultiKillerStrategy; entryQuote?: number; entryEpoch?: number } | null> => {
        const ws = window._newSystemWS;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            log('❌ WS not open');
            return null;
        }

        const ct = CONTRACT_TYPE[strategy];
        const isHL = strategy === 'higher' || strategy === 'lower';
        const dur = isHL ? hlDurationRef.current : DURATION[strategy];
        const needBarrier = NEEDS_BARRIER[strategy];
        const fallbackEntryTick = recentTicksRef.current[recentTicksRef.current.length - 1];

        // Higher/Lower: positive relative barrier offset.
        //   Deriv's live contracts_for metadata supplies the valid floor;
        //   hardcoding 0.02 is rejected on several synthetic markets.
        //   Uses proposal → buy flow (Deriv validates barrier in proposal step)
        // Over/Under/Differs: barrier = user-configured digit, direct buy
        let barrier: string | undefined;
        if (isHL) {
            const rawOff = (hlOffsetRef.current || '').trim() || '0.02';
            const numOff = parseFloat(rawOff);
            if (isNaN(numOff) || numOff <= 0) {
                log(`❌ ${LABELS[strategy]}: invalid offset "${rawOff}"`);
                return null;
            }
            const pip = PIP_SIZES[market] ?? 2;
            const metadataFloor = await getHigherLowerBarrierFloor(market);
            const effectiveOff = Math.max(Math.abs(numOff), metadataFloor ?? 0);
            const off = effectiveOff.toFixed(pip);
            // On synthetic Higher/Lower contracts Deriv exposes a positive
            // relative barrier for both CALL and PUT.
            barrier = `+${off}`;
        } else if (needBarrier) {
            const rawBarrier = barriersRef.current[strategy] ?? '5';
            barrier = String(parseInt(rawBarrier) || 5);
        }

        log(`📤 ${LABELS[strategy]} ${ct}${barrier !== undefined ? ' @' + barrier : ''} ${dur}t $${stakeNum}`);

        if (isHL) {
            // ── HL: proposal → buy via sendViaNewSystemWithPromise ──
            const tag = `[MK-HL|${strategy}|${market}]`;
            const pipSize = PIP_SIZES[market] ?? 2;
            console.log(`${tag} Market=${market} pip_size=${pipSize} contract_type=${ct} duration=${dur}t barrier=${barrier} stake=$${stakeNum}`);

            // Raw WS capture — logs EVERY message Deriv sends back during this trade
            const rawCapture = (event: any) => {
                try {
                    const raw = event.detail?.data ?? event.data;
                    const data = JSON.parse(raw);
                    console.log(`${tag} RAW WS ←`, JSON.stringify(data, null, 2));
                } catch {}
            };
            window.addEventListener('newSystemMessage', rawCapture);

            try {
                const proposalMsg: Record<string, any> = {
                    proposal: 1,
                    amount: stakeNum,
                    basis: 'payout',
                    contract_type: ct,
                    currency: 'USD',
                    duration: dur,
                    // CALL/PUT Higher/Lower proposals use the minute control
                    // shown in the UI; tick duration was reintroduced by a
                    // later logging change and causes Deriv validation errors.
                    duration_unit: 'm',
                    symbol: market,
                    barrier: barrier!,
                };
                console.log(`${tag} STEP1 proposal request:`, JSON.stringify(proposalMsg, null, 2));
                const proposalResp: any = await sendViaNewSystemWithPromise(proposalMsg);
                console.log(`${tag} STEP1 proposal response:`, JSON.stringify(proposalResp, null, 2));
                const proposalId = proposalResp?.proposal?.id;
                if (!proposalId) {
                    console.error(`${tag} STEP1 FAILED — no proposal id. Full response:`, proposalResp);
                    log(`❌ ${LABELS[strategy]}: no proposal id`);
                    return null;
                }
                const buyReq = { buy: proposalId, price: stakeNum };
                console.log(`${tag} STEP2 buy request:`, JSON.stringify(buyReq, null, 2));
                const buyResp: any = await sendViaNewSystemWithPromise(buyReq);
                console.log(`${tag} STEP2 buy response:`, JSON.stringify(buyResp, null, 2));
                const cid = String(buyResp?.buy?.contract_id ?? buyResp?.contract_id);
                if (!cid || cid === 'undefined') {
                    console.error(`${tag} STEP2 FAILED — no contract_id. Full response:`, buyResp);
                    log(`⚠️ ${LABELS[strategy]}: no contract_id`);
                    return null;
                }
                ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: cid, subscribe: 1 }));
                let actualEntryQuote = Number(buyResp?.buy?.entry_tick);
                let actualEntryEpoch = Number(buyResp?.buy?.entry_tick_time);
                if (captureEntry) {
                    try {
                        const pocResponse: any = await Promise.race([
                            sendViaNewSystemWithPromise({ proposal_open_contract: 1, contract_id: cid }),
                            new Promise(resolve => setTimeout(() => resolve(null), 500)),
                        ]);
                        const poc = pocResponse?.proposal_open_contract;
                        if (Number.isFinite(Number(poc?.entry_tick))) actualEntryQuote = Number(poc.entry_tick);
                        if (Number.isFinite(Number(poc?.entry_tick_time))) actualEntryEpoch = Number(poc.entry_tick_time);
                    } catch {}
                }
                try {
                    transactions.onBotContractEvent({
                        contract_id: Number(cid),
                        transaction_ids: { buy: buyResp?.buy?.transaction_id ?? Number(cid) },
                        buy_price: stakeNum,
                        currency: 'USD',
                        contract_type: ct,
                        underlying: market,
                        display_name: market,
                        date_start: Math.floor(Date.now() / 1000),
                        status: 'open',
                        entry_tick: buyResp?.buy?.entry_tick,
                        entry_tick_time: buyResp?.buy?.entry_tick_time,
                    } as any);
                } catch {}
                console.log(`${tag} ✅ SUCCESS contract_id=${cid}`);
                log(`✅ ${LABELS[strategy]} bought (#${cid})`);
                window.removeEventListener('newSystemMessage', rawCapture);
                return {
                    cid,
                    strategy,
                    entryQuote: Number.isFinite(actualEntryQuote)
                        ? actualEntryQuote
                        : fallbackEntryTick?.quote,
                    entryEpoch: Number.isFinite(actualEntryEpoch)
                        ? actualEntryEpoch
                        : fallbackEntryTick?.epoch,
                };
            } catch (e: any) {
                console.error(`${tag} CAUGHT ERROR:`, JSON.stringify(e, null, 2));
                console.error(`${tag} error.message:`, e?.message);
                console.error(`${tag} error.error:`, e?.error);
                const errMsg = e?.error?.message || e?.message || String(e);
                const errCode = e?.error?.code || '';
                log(`❌ ${LABELS[strategy]}: ${errMsg}${errCode ? ` [${errCode}]` : ''}`);
                log(`   Request: ${ct} @${barrier} ${dur}t ${market} $${stakeNum}`);
                window.removeEventListener('newSystemMessage', rawCapture);
                return null;
            }
        }

        // ── Non-HL: direct buy via raw WS ──
        return new Promise((resolve) => {
            const reqId = Date.now() * 1000 + (++_buySeq);
            const baseParams: Record<string, any> = {
                amount: stakeNum,
                basis: 'stake',
                contract_type: ct,
                currency: 'USD',
                duration: dur,
                duration_unit: 't',
                underlying_symbol: market,
            };
            if (barrier !== undefined) baseParams.barrier = barrier;

            const cleanup = () => {
                window.removeEventListener('newSystemMessage', handler);
                const idx = buyListenersRef.current.indexOf(cleanup);
                if (idx !== -1) buyListenersRef.current.splice(idx, 1);
            };

            const handler = async (event: any) => {
                try {
                    const data = JSON.parse(event.detail?.data ?? event.data);
                    if (data.req_id !== reqId) return;
                    cleanup();

                    if (data.error) {
                        log(`❌ ${LABELS[strategy]}: ${data.error.message || 'error'}`);
                        resolve(null);
                        return;
                    }

                    const cid = String(data.buy?.contract_id ?? data.contract_id);
                    if (cid && cid !== 'undefined') {
                        ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: cid, subscribe: 1 }));
                        let actualEntryQuote = Number(data.buy?.entry_tick);
                        let actualEntryEpoch = Number(data.buy?.entry_tick_time);
                        if (captureEntry) {
                            try {
                                const pocResponse: any = await Promise.race([
                                    sendViaNewSystemWithPromise({ proposal_open_contract: 1, contract_id: cid }),
                                    new Promise(resolve => setTimeout(() => resolve(null), 500)),
                                ]);
                                const poc = pocResponse?.proposal_open_contract;
                                if (Number.isFinite(Number(poc?.entry_tick))) actualEntryQuote = Number(poc.entry_tick);
                                if (Number.isFinite(Number(poc?.entry_tick_time))) actualEntryEpoch = Number(poc.entry_tick_time);
                            } catch {}
                        }
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
                                entry_tick: data.buy?.entry_tick,
                                entry_tick_time: data.buy?.entry_tick_time,
                            } as any);
                        } catch {}
                        log(`✅ ${LABELS[strategy]} bought (#${cid})`);
                        resolve({
                            cid,
                            strategy,
                            entryQuote: Number.isFinite(actualEntryQuote)
                                ? actualEntryQuote
                                : fallbackEntryTick?.quote,
                            entryEpoch: Number.isFinite(actualEntryEpoch)
                                ? actualEntryEpoch
                                : fallbackEntryTick?.epoch,
                        });
                    } else {
                        log(`⚠️ ${LABELS[strategy]}: no contract_id`);
                        resolve(null);
                    }
                } catch {}
            };

            buyListenersRef.current.push(cleanup);
            window.addEventListener('newSystemMessage', handler);
            ws.send(JSON.stringify({
                buy: '1',
                price: stakeNum,
                parameters: baseParams,
                req_id: reqId,
            }));

            setTimeout(() => {
                cleanup();
                log(`❌ ${LABELS[strategy]}: timeout`);
                resolve(null);
            }, 15000);
        });
    }, [market, log, transactions]);

    const bot15RoundRef = useRef<() => Promise<void>>();
    const runBot15Round = useCallback(async () => {
        if (!runningRef.current) return;
        const gen = genRef.current;
        const myRound = ++roundIdRef.current;
        recentPricesRef.current = [];
        recentTicksRef.current = [];
        setRunPhase('waiting');
        log('🤖 Bot 15: waiting for two consecutive ticks in one direction...');

        const direction = await new Promise<Bot15Direction | null>(resolve => {
            bot15ActiveRef.current = true;
            bot15SignalResolveRef.current = resolve;
        });
        if (genRef.current !== gen || !runningRef.current || !direction) return;
        if (bot15RiskStopRef.current) {
            runningRef.current = false;
            setRunning(false);
            setRunPhase('idle');
            return;
        }

        const plan = createBot15Plan(direction, bot15Stakes);
        const totalCost = plan.legs.reduce((sum, leg) => sum + leg.stake, 0) + plan.retry.stake;
        const maxRoundStake = Number(bot15RiskRef.current.maxRoundStake);
        if (Number.isFinite(maxRoundStake) && maxRoundStake > 0 && totalCost > maxRoundStake) {
            log(`⏭️ Bot 15 ${direction.toUpperCase()} skipped: worst-case stake $${totalCost.toFixed(2)} exceeds round cap $${maxRoundStake.toFixed(2)}`);
            bot15CooldownRef.current = Math.max(0, Math.floor(Number(bot15RiskRef.current.cooldownTicks) || 0));
            await new Promise<void>(resolve => setTimeout(resolve, 1000));
            if (genRef.current === gen && runningRef.current) bot15RoundRef.current?.();
            return;
        }
        log(`🤖 Bot 15 ${direction.toUpperCase()}: sending Fall/Rise pair = $${totalCost.toFixed(2)}`);
        buyPhaseDoneRef.current = false;
        expectedSettlementsRef.current = 0;
        settledCountRef.current = 0;
        setRunPhase('buying');
        setBuyProgress({ done: 0, total: plan.legs.length });
        setSettleProgress({ done: 0, total: 0 });

        const results = await Promise.all(plan.legs.map(async (leg, index) => {
            const result = await buyOne(leg.strategy, leg.stake, myRound, true);
            setBuyProgress(prev => ({ ...prev, done: prev.done + 1 }));
            return { leg, result, index };
        }));
        if (genRef.current !== gen || !runningRef.current) return;

        const bought = results.filter(item => item.result).map(item => ({
            contractId: item.result!.cid,
            strategy: item.leg.strategy,
            stake: item.leg.stake,
            roundId: myRound,
        }));
        if (bought.length === 0) {
            log('❌ Bot 15: both initial contracts failed');
            runningRef.current = false;
            setRunning(false);
            return;
        }
        tradesRef.current.push(...bought);
        expectedSettlementsRef.current = bought.length;
        buyPhaseDoneRef.current = true;
        setRunPhase('settling');
        setSettleProgress({ done: 0, total: bought.length });
        log(`✅ Bot 15: ${bought.length} initial contracts open`);

        const shortItem = results.find(item => item.leg.duration === 1 && item.result);
        const shortEntryTick = recentTicksRef.current[recentTicksRef.current.length - 1];
        const shortEntryQuote = Number(shortItem?.result?.entryQuote);
        const shortEntryEpoch = Number(shortItem?.result?.entryEpoch);
        const entryQuote = Number.isFinite(shortEntryQuote) ? shortEntryQuote : shortEntryTick?.quote;
        const entryEpoch = Number.isFinite(shortEntryEpoch) ? shortEntryEpoch : shortEntryTick?.epoch;
        let retrySlotReserved = Boolean(shortItem);
        if (retrySlotReserved) {
            expectedSettlementsRef.current++;
            setSettleProgress({ done: settledCountRef.current, total: expectedSettlementsRef.current });
        }
        const releaseRetrySlot = () => {
            if (!retrySlotReserved) return;
            retrySlotReserved = false;
            expectedSettlementsRef.current = Math.max(0, expectedSettlementsRef.current - 1);
            setSettleProgress({ done: settledCountRef.current, total: expectedSettlementsRef.current });
            if (buyPhaseDoneRef.current && settledCountRef.current >= expectedSettlementsRef.current) {
                roundCompleteResolveRef.current?.();
                roundCompleteResolveRef.current = null;
            }
        };
        if (retrySlotReserved && (!Number.isFinite(entryQuote) || !Number.isFinite(entryEpoch))) {
            log('⚠️ Bot 15: local entry tick unavailable; retry slot released');
            releaseRetrySlot();
        }
        let shortResolved = false;
        let retrySent = false;

        bot15TickHandlerRef.current = async tick => {
            if (shortResolved || retrySent || !shortItem?.result || !Number.isFinite(entryQuote) || !Number.isFinite(entryEpoch)) return;
            if (tick.epoch <= entryEpoch) return;
            shortResolved = true;
            const loss = isBot15DirectionalLoss(shortItem.leg.contractType as 'CALL' | 'PUT', entryQuote, tick.quote);
            if (loss === null) return;
            log(`${loss ? '❌' : '✅'} Bot 15 ${shortItem.leg.contractType}: entry ${entryQuote} → exit ${tick.quote}${loss ? ' — sending immediate retry' : ''}`);
            if (!loss) {
                releaseRetrySlot();
                return;
            }
            retrySent = true;
            const retryResult = await buyOne(plan.retry.strategy, plan.retry.stake, myRound);
            if (!retryResult || genRef.current !== gen || !runningRef.current) {
                releaseRetrySlot();
                log('⚠️ Bot 15 retry purchase failed');
                return;
            }
            tradesRef.current.push({
                contractId: retryResult.cid,
                strategy: plan.retry.strategy,
                stake: plan.retry.stake,
                roundId: myRound,
            });
            setSettleProgress({ done: settledCountRef.current, total: expectedSettlementsRef.current });
            log(`🔁 Bot 15 retry bought (#${retryResult.cid})`);
        };
        const bufferedExit = recentTicksRef.current.find(tick =>
            Number.isFinite(entryEpoch) && tick.epoch > entryEpoch
        );
        if (bufferedExit) bot15TickHandlerRef.current(bufferedExit);

        await new Promise<void>(resolve => {
            if (settledCountRef.current >= expectedSettlementsRef.current) {
                resolve();
                return;
            }
            roundCompleteResolveRef.current = resolve;
        });
        bot15TickHandlerRef.current = null;
        if (genRef.current !== gen || !runningRef.current) return;
        bot15CooldownRef.current = Math.max(0, Math.floor(Number(bot15RiskRef.current.cooldownTicks) || 0));
        log('🔄 Bot 15 round complete — next signal in 5s');
        await new Promise<void>(resolve => setTimeout(resolve, 5000));
        if (genRef.current === gen && runningRef.current) bot15RoundRef.current?.();
    }, [bot15Stakes, buyOne, log]);

    // Settlement listener — only counts contracts from current round
    useEffect(() => {
        const unsub = onNewSystemMessage((event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.msg_type !== 'proposal_open_contract') return;
                const poc = data.proposal_open_contract;
                if (!poc?.is_sold) return;
                const cid = String(poc.contract_id);
                const profit = parseFloat(poc.profit) || 0;

                const currentRound = roundIdRef.current;
                const idx = tradesRef.current.findIndex(t => t.contractId === cid && t.roundId === currentRound);
                if (idx === -1) return;
                const t = tradesRef.current[idx];

                const icon = profit >= 0 ? '✅' : '❌';
                log(`${icon} ${LABELS[t.strategy]}: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} (${t.stake}$ bet)`);
                if (mode === 'bot15') {
                    bot15SessionProfitRef.current += profit;
                    const maxSessionLoss = Number(bot15RiskRef.current.maxSessionLoss);
                    if (Number.isFinite(maxSessionLoss) && maxSessionLoss > 0 && bot15SessionProfitRef.current <= -maxSessionLoss) {
                        bot15RiskStopRef.current = true;
                        log(`🛑 Bot 15 stopped: session loss limit reached ($${bot15SessionProfitRef.current.toFixed(2)})`);
                    }
                }
                tradesRef.current.splice(idx, 1);
                settledCountRef.current++;
                setSettleProgress({ done: settledCountRef.current, total: expectedSettlementsRef.current });

                try {
                    transactions.onBotContractEvent({
                        ...poc,
                        contract_id: cid,
                        transaction_ids: { buy: poc.transaction_ids?.buy ?? cid },
                        buy_price: t.stake,
                        sell_price: t.stake + profit,
                        display_name: poc.display_name ?? market,
                        status: 'sold',
                        profit,
                        is_sold: true,
                        is_completed: true,
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
    }, [log, mode, transactions, market]);

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

        // Increment round ID — old contracts from previous rounds are ignored
        roundIdRef.current++;
        const myRound = roundIdRef.current;

        const tdTarget = showTickDir ? (parseInt(tickDirection) || 0) : 0;

        // ── TICK DIRECTION PHASE ──
        if (tdTarget > 0) {
            log(`📊 Waiting for ${tdTarget} ticks in same direction...`);
            const ok = await waitForTickDirection(tdTarget, gen);
            if (genRef.current !== gen || !runningRef.current) return;
            if (!ok) return;
        }

        const totalCost = sel.reduce((sum, s) => sum + getStake(s), 0);
        log(`🚀 Round #${myRound}: ${sel.length} contracts = $${totalCost.toFixed(2)} total`);

        // ── BUY PHASE ──
        buyPhaseDoneRef.current = false;
        expectedSettlementsRef.current = 0;
        settledCountRef.current = 0;
        buyListenersRef.current.forEach(c => c());
        buyListenersRef.current = [];

        setRunPhase('buying');
        setBuyProgress({ done: 0, total: sel.length });
        setSettleProgress({ done: 0, total: 0 });

        const promises = sel.map(async (s, idx) => {
            const delayTicks = HAS_DELAY[s] ? (delaysRef.current[s] ?? 0) : 0;
            if (delayTicks > 0) {
                log(`⏱ ${LABELS[s]} waiting ${delayTicks} tick${delayTicks > 1 ? 's' : ''}...`);
                await waitForTicks(delayTicks, gen);
                if (genRef.current !== gen) return null;
                log(`⏱ ${LABELS[s]} tick delay done — buying`);
            }
            const result = await buyOne(s, getStake(s), myRound);
            setBuyProgress(prev => ({ ...prev, done: prev.done + 1 }));
            return result;
        });

        const results = await Promise.all(promises);

        if (genRef.current !== gen) return;

        // Register bought contracts — tagged with roundId
        const bought: TradeEntry[] = [];
        results.forEach(r => {
            if (r) bought.push({ contractId: r.cid, strategy: r.strategy, stake: getStake(r.strategy), roundId: myRound });
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
        setRunPhase('settling');
        setSettleProgress({ done: 0, total: bought.length });
        log(`✅ ${bought.length} open — waiting for all settlements`);

        // ── SETTLEMENT PHASE ──
        if (settledCountRef.current >= expectedSettlementsRef.current) {
            log(`🔄 Round #${myRound} complete — next round in 5s`);
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

        log(`🔄 Round #${myRound} complete — next round in 5s`);
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
    }, [buyOne, log, waitForTicks, waitForTickDirection, getStake, showTickDir, tickDirection]);

    runRoundRef.current = runRound;
    bot15RoundRef.current = runBot15Round;

    const start = useCallback(() => {
        if (running || (mode === 'standard' && selected.length === 0)) return;
        setRunning(true);
        setRunPhase('waiting');
        setBuyProgress({ done: 0, total: 0 });
        setSettleProgress({ done: 0, total: 0 });
        setTickProgress({ dir: '⏳', count: 0, target: 0 });
        setLogs([]);
        runningRef.current = true;
        genRef.current++;
        bot15ActiveRef.current = false;
        bot15TickHandlerRef.current = null;
        bot15CooldownRef.current = 0;
        bot15SessionProfitRef.current = 0;
        bot15RiskStopRef.current = false;
        recentTicksRef.current = [];
        tradesRef.current = [];
        pendingDelaysRef.current = [];
        buyPhaseDoneRef.current = false;
        expectedSettlementsRef.current = 0;
        settledCountRef.current = 0;
        tickDirResolveRef.current = null;
        tickDirActiveRef.current = false;
        consecutiveUpRef.current = 0;
        consecutiveDownRef.current = 0;
        lastTickPriceRef.current = null;
        log('▶️ Started');
        if (mode === 'bot15') bot15RoundRef.current?.();
        else runRoundRef.current?.();
    }, [mode, running, selected, log]);

    const stop = useCallback(() => {
        genRef.current++;
        runningRef.current = false;
        setRunning(false);
        bot15ActiveRef.current = false;
        bot15TickHandlerRef.current = null;
        if (bot15SignalResolveRef.current) {
            bot15SignalResolveRef.current(null);
            bot15SignalResolveRef.current = null;
        }
        tradesRef.current = [];
        buyPhaseDoneRef.current = false;
        tickDirActiveRef.current = false;
        // Unblock all waiting promises
        buyListenersRef.current.forEach(c => c());
        buyListenersRef.current = [];
        pendingDelaysRef.current.forEach(p => p.resolve());
        pendingDelaysRef.current = [];
        if (tickDirResolveRef.current) {
            tickDirResolveRef.current();
            tickDirResolveRef.current = null;
        }
        if (tickDirResolveRef.current) {
            tickDirResolveRef.current();
            tickDirResolveRef.current = null;
        }
        if (roundCompleteResolveRef.current) {
            roundCompleteResolveRef.current();
            roundCompleteResolveRef.current = null;
        }
        setRunPhase('idle');
        setBuyProgress({ done: 0, total: 0 });
        setSettleProgress({ done: 0, total: 0 });
        setTickProgress({ dir: '...', count: 0, target: 0 });
        log('⏹ Stopped');
    }, [log]);

    const analyzeVolatilities = useCallback(async () => {
        const ws = window._newSystemWS;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            setAnalyzeResult('❌ WebSocket not connected');
            return;
        }

        setAnalyzing(true);
        setAnalyzeResult(null);
        setLogs(p => ['📊 Analyzing volatilities...', ...p].slice(0, 80));

        const VOL_SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];
        const hasDowns = selected.includes('downs');
        const hasUps = selected.includes('ups');
        const needBB = hasDowns || hasUps;

        const fetchTicks = async (sym: string): Promise<number[]> => {
            try {
                const data = await sendViaNewSystemWithPromise({ ticks_history: sym, style: 'ticks', count: 200, end: 'latest' });
                return (data.history?.prices || data.prices || []).map(Number);
            } catch { return []; }
        };

        const fetchCandles = async (sym: string): Promise<Array<{ open: number; high: number; low: number; close: number }>> => {
            try {
                const data = await sendViaNewSystemWithPromise({ ticks_history: sym, style: 'candles', granularity: 60, count: 30, end: 'latest' });
                return (data.candles || []).map((c: any) => ({ open: +c.open, high: +c.high, low: +c.low, close: +c.close }));
            } catch { return []; }
        };

        const allData: Array<{ sym: string; prices: number[]; candles: Array<{ open: number; high: number; low: number; close: number }> }> = [];
        for (const sym of VOL_SYMBOLS) {
            const prices = await fetchTicks(sym);
            const candles = await fetchCandles(sym);
            allData.push({ sym, prices, candles });
            await new Promise(r => setTimeout(r, 300));
        }

        const calcBB = (candles: Array<{ close: number }>): { upper: number; middle: number; lower: number } | null => {
            if (candles.length < 20) return null;
            const closes = candles.slice(-20).map(c => c.close);
            const sma = closes.reduce((a, b) => a + b, 0) / 20;
            const variance = closes.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / 20;
            return { upper: sma + 2 * Math.sqrt(variance), middle: sma, lower: sma - 2 * Math.sqrt(variance) };
        };

        const results: Array<{
            sym: string;
            label: string;
            maxStreak: number;
            over4Pct: number;
            upCount: number;
            downCount: number;
            avgMove: number;
            bbPosition: string;
            tickScore: number;
            bbScore: number;
            totalScore: number;
            accuracySignals: number;
            totalStreaks: number;
        }> = [];

        for (const { sym, prices, candles } of allData) {
            let maxStreak = 0;
            let currentStreak = 0;
            let over4Count = 0;
            let streakDir = 0;
            let upCount = 0;
            let downCount = 0;
            let totalMovement = 0;
            let realMoves = 0;

            for (let i = 1; i < prices.length; i++) {
                const diff = prices[i] - prices[i - 1];
                if (diff === 0) continue;
                const dir = diff > 0 ? 1 : -1;
                if (dir > 0) upCount++; else downCount++;
                totalMovement += Math.abs(diff);
                realMoves++;
                if (dir === streakDir) {
                    currentStreak++;
                } else {
                    if (currentStreak > maxStreak) maxStreak = currentStreak;
                    if (currentStreak > 4) over4Count++;
                    currentStreak = 1;
                    streakDir = dir;
                }
            }
            if (currentStreak > maxStreak) maxStreak = currentStreak;
            if (currentStreak > 4) over4Count++;

            const over4Pct = realMoves > 0 ? Math.round((over4Count / realMoves) * 100) : 100;
            const avgMove = realMoves > 0 ? totalMovement / realMoves : 0;
            const tickScore = Math.max(0, 100 - over4Pct * 3);

            let bbPosition = 'N/A';
            let bbScore = 50;
            const bb = calcBB(candles);
            if (bb && candles.length >= 2) {
                const last2 = candles.slice(-2);
                const bbRange = bb.upper - bb.lower;
                if (bbRange > 0) {
                    const touchDist = 0.05;
                    const nearDist = 0.15;

                    const touchedUpper = last2.some(c => c.high >= bb.upper);
                    const almostUpper = last2.some(c => (c.high - bb.lower) / bbRange >= (1 - touchDist));
                    const nearUpper = last2.some(c => (c.high - bb.lower) / bbRange >= (1 - nearDist));
                    const touchedLower = last2.some(c => c.low <= bb.lower);
                    const almostLower = last2.some(c => (c.low - bb.lower) / bbRange <= touchDist);
                    const nearLower = last2.some(c => (c.low - bb.lower) / bbRange <= nearDist);

                    if (touchedUpper) bbPosition = '🔴 UPPER';
                    else if (almostUpper) bbPosition = '🟠 near upper';
                    else if (nearUpper) bbPosition = '🟡 mid-upper';
                    else if (touchedLower) bbPosition = '🟢 LOWER';
                    else if (almostLower) bbPosition = '🟢 near lower';
                    else if (nearLower) bbPosition = '🟡 mid-lower';
                    else bbPosition = '⚪ middle';

                    // Upper band wanted by: downs (mean reversion)
                    // Lower band wanted by: ups (mean reversion)
                    const wantsUpper = hasDowns;
                    const wantsLower = hasUps;
                    if (wantsUpper) {
                        if (touchedUpper) bbScore = 100;
                        else if (almostUpper) bbScore = 90;
                        else if (nearUpper) bbScore = 70;
                        else bbScore = 20;
                    } else if (wantsLower) {
                        if (touchedLower) bbScore = 100;
                        else if (almostLower) bbScore = 90;
                        else if (nearLower) bbScore = 70;
                        else bbScore = 20;
                    } else {
                        bbScore = 50;
                    }
                }
            }

            let accuracySignals = 0;
            let totalStreaks = 0;
            {
                let sDir = 0;
                let sLen = 0;
                for (let i = 1; i < prices.length; i++) {
                    const diff = prices[i] - prices[i - 1];
                    if (diff === 0) continue;
                    const d = diff > 0 ? 1 : -1;
                    if (d === sDir) { sLen++; }
                    else {
                        if (sLen >= 3) {
                            totalStreaks++;
                            const slice = prices.slice(Math.max(0, i - 14), i + 1);
                            if (slice.length >= 5) {
                                let g = 0, l = 0;
                                for (let j = 1; j < slice.length; j++) {
                                    const dd = slice[j] - slice[j - 1];
                                    if (dd > 0) g += dd; else l += Math.abs(dd);
                                }
                                const rsi = l === 0 ? 100 : 100 - 100 / (1 + g / l);
                                let ema = slice[0];
                                const k = 2 / 10;
                                for (let j = 1; j < slice.length; j++) ema = slice[j] * k + ema * (1 - k);
                                const dist = Math.abs(slice[slice.length - 1] - ema);
                                let avgM = 0;
                                for (let j = 1; j < slice.length; j++) avgM += Math.abs(slice[j] - slice[j - 1]);
                                avgM /= (slice.length - 1);
                                const stretch = avgM > 0 ? dist / avgM : 0;
                                const last = slice[slice.length - 1];
                                const mn = Math.min(...slice);
                                const mx = Math.max(...slice);
                                const rng = mx - mn;
                                const atExtreme = rng > 0 && (sDir > 0 ? (last - mn) / rng > 0.85 : (mx - last) / rng > 0.85);
                                const rsiOK = sDir > 0 ? rsi > 70 : rsi < 30;
                                let confirmCount = 0;
                                if (rsiOK) confirmCount++;
                                if (stretch > 1.0) confirmCount++;
                                if (atExtreme) confirmCount++;
                                if (confirmCount >= 2) accuracySignals++;
                            }
                        }
                        sLen = 1;
                        sDir = d;
                    }
                }
            }

            // Score: BB factor + indicator factor (when accuracy ON)
            const bbRatio = needBB ? bbScore / 100 : 1;
            const indRatio = totalStreaks > 0 ? accuracySignals / totalStreaks : 0;
            let baseScore = tickScore * 0.4;
            if (needBB) baseScore += bbScore * 0.3;
            if (accuracy) baseScore += Math.round(indRatio * 100) * 0.3;
            const totalScore = Math.round(baseScore);
            const bbMiddle = bbPosition === '⚪ middle' || bbPosition === 'N/A';

            // Strict BB filter: middle/mid-upper/mid-lower never allowed for directional trading
            let bbPassesFilter = true;
            if (needBB) {
                const isUpper = bbPosition === '🔴 UPPER' || bbPosition === '🟠 near upper';
                const isLower = bbPosition === '🟢 LOWER' || bbPosition === '🟢 near lower';
                const isMiddle = bbPosition === '⚪ middle' || bbPosition === '🟡 mid-upper' || bbPosition === '🟡 mid-lower' || bbPosition === 'N/A';
                if (isMiddle) bbPassesFilter = false;
                if (hasDowns && !isUpper) bbPassesFilter = false;
                if (hasUps && !isLower) bbPassesFilter = false;
            }

            const adjustedScore = !bbPassesFilter ? 0 : totalScore;

            results.push({ sym, label: `Vol ${sym.replace('R_', '')}`, maxStreak, over4Pct, upCount, downCount, avgMove, bbPosition, tickScore, bbScore, totalScore: adjustedScore, accuracySignals, totalStreaks });
        }

        results.sort((a, b) => b.totalScore - a.totalScore);

        let mode = 'Tick direction';
        if (hasDowns) mode = 'Only Downs → looking for upper BB';
        else if (hasUps) mode = 'Only Ups → looking for lower BB';
        if (accuracy) mode += ' + Accuracy (30% weight)';

        let msg = `📊 ANALYSIS — ${mode}\n`;
        const candleCounts = allData.map(d => `${d.sym.replace('R_', '')}:${d.candles.length}`).join(' ');
        msg += `Candles: ${candleCounts}\n`;
        msg += `Indicators: RSI(3) >70/<30 + EMA stretch >1x + 85% range extreme (2-of-3 needed)\n\n`;
        results.forEach((r, i) => {
            const rank = i === 0 ? '🏆' : i === 1 ? '✅' : '  ';
            const bbOk = !needBB || r.totalScore > 0;
            const bbTag = bbOk ? '' : ' ❌';
            msg += `${rank} ${r.label}: streaks>4: ${r.over4Pct}% | avg ${r.avgMove.toFixed(2)} | BB: ${r.bbPosition}${bbTag} | ind: ${r.accuracySignals}/${r.totalStreaks}`;
            if (needBB) msg += ` [${r.totalScore}]`;
            msg += '\n';
        });

        const best = results[0];
        if (needBB && best.totalScore === 0) {
            const required = hasDowns ? 'UPPER' : hasUps ? 'LOWER' : 'any';
            msg += `\n⚠️ NO VOLATILITY at ${required} BB — all filtered out\n`;
            msg += `Available: ${results.map(r => `${r.label}(${r.bbPosition})`).join(', ')}\n`;
            msg += `Try again later when candles reach the ${required} band`;
        } else {
            msg += `\n💡 BEST: ${best.label} (score ${best.totalScore})\n`;
            if (needBB) msg += `BB position: ${best.bbPosition}\n`;
            msg += `Indicator signals: ${best.accuracySignals}/${best.totalStreaks} streaks confirmed\n`;
            msg += `Tick streaks >4: ${best.over4Pct}%`;
        }

        setAnalyzeResult(msg);
        if (best.totalScore > 0) {
            setMarket(best.sym);
            setLogs(p => [`📊 Best: ${best.label} — auto-selected`, ...p].slice(0, 80));
        } else {
            // No BB match — switch ALL contracts that need that band to opposite
            const upperVol = results.find(r => r.bbPosition.includes('UPPER') || r.bbPosition.includes('upper'));
            const lowerVol = results.find(r => r.bbPosition.includes('LOWER') || r.bbPosition.includes('lower'));
            const hasRise = selected.includes('rise');
            const hasFall = selected.includes('fall');
            const hasUps = selected.includes('ups');
            const hasDowns = selected.includes('downs');

            // Contracts needing upper BB: rise, downs
            const needsUpper = hasRise || hasDowns;
            // Contracts needing lower BB: fall, ups
            const needsLower = hasFall || hasUps;

            // Flip mapping for auto-switch
            const flip = (s: MultiKillerStrategy): MultiKillerStrategy => {
                if (s === 'rise') return 'fall';
                if (s === 'fall') return 'rise';
                if (s === 'ups') return 'downs';
                if (s === 'downs') return 'ups';
                return s;
            };
            const flipLabel = (s: MultiKillerStrategy): string => {
                if (s === 'rise') return 'Fall';
                if (s === 'fall') return 'Rise';
                if (s === 'ups') return 'Only Downs';
                if (s === 'downs') return 'Only Ups';
                return LABELS[s];
            };

            if (needsUpper && upperVol) {
                setMarket(upperVol.sym);
                setLogs(p => [`📊 ${upperVol.label} (${upperVol.bbPosition}) — auto-selected`, ...p].slice(0, 80));
            } else if (needsUpper && lowerVol) {
                const upperStrats = selected.filter(s => s === 'rise' || s === 'downs');
                const newSelected = selected.map(s => upperStrats.includes(s) ? flip(s) : s);
                setSelected(newSelected);
                if (hasDowns) setTickDirMode('ups');
                if (hasUps) setTickDirMode('downs');
                setMarket(lowerVol.sym);
                const switched = upperStrats.map(flipLabel).join(', ');
                setLogs(p => [`🔄 No upper BB → switched ${switched} → ${lowerVol.label} (${lowerVol.bbPosition})`, ...p].slice(0, 80));
                msg += `\n\n🔄 AUTO-SWITCH: No upper BB → ${switched} → ${lowerVol.label}`;
                setAnalyzeResult(msg);
            } else if (needsLower && lowerVol) {
                setMarket(lowerVol.sym);
                setLogs(p => [`📊 ${lowerVol.label} (${lowerVol.bbPosition}) — auto-selected`, ...p].slice(0, 80));
            } else if (needsLower && upperVol) {
                const lowerStrats = selected.filter(s => s === 'fall' || s === 'ups');
                const newSelected = selected.map(s => lowerStrats.includes(s) ? flip(s) : s);
                setSelected(newSelected);
                if (hasUps) setTickDirMode('downs');
                if (hasDowns) setTickDirMode('ups');
                setMarket(upperVol.sym);
                const switched = lowerStrats.map(flipLabel).join(', ');
                setLogs(p => [`🔄 No lower BB → switched ${switched} → ${upperVol.label} (${upperVol.bbPosition})`, ...p].slice(0, 80));
                msg += `\n\n🔄 AUTO-SWITCH: No lower BB → ${switched} → ${upperVol.label}`;
                setAnalyzeResult(msg);
            } else {
                setLogs(p => [`⚠️ No volatility meets BB requirement for any direction`, ...p].slice(0, 80));
            }
        }
        setAnalyzing(false);
    }, [selected]);

    const playClick = useCallback(() => {
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1200, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.06);
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.08);
        } catch {}
    }, []);

    const toggle = (s: MultiKillerStrategy) => {
        if (running) return;
        playClick();
        setSelected(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);
        if (!stakes[s]) setStakes(p => ({ ...p, [s]: '10' }));
    };

    return (
        <div className='mw-killer multi-killer-theme'>
            <div className='mw-field'>
                <label className='mw-label'>Mode</label>
                <div className='mw-select-wrap'>
                    <select className='mw-input' value={mode} disabled={running}
                        onChange={e => setMode(e.target.value as MultiKillerMode)}>
                        <option value='standard'>Standard MultiKiller</option>
                        <option value='bot15'>Bot 15 Strategy</option>
                    </select>
                    <span className='mw-select-arrow'></span>
                </div>
            </div>
            <div className='mw-field'>
                <label className='mw-label'>Market</label>
                <div className='mw-select-wrap'>
                    <select className='mw-input' value={market} onChange={e => setMarket(e.target.value)}>
                        {ALL_SYMBOLS.map(s => <option key={s} value={s}>{SYMBOL_LABELS[s] || s}</option>)}
                    </select>
                    <span className='mw-select-arrow'></span>
                </div>
            </div>

            {mode === 'standard' && showTickDir && (
                <button className={`mw-btn mw-btn--analyze ${analyzing ? 'mw-btn--analyzing' : ''}`}
                    disabled={analyzing || running}
                    onClick={analyzeVolatilities}>
                    {analyzing ? '⏳ Analyzing...' : '📊 Analyze Volatility'}
                </button>
            )}

            {mode === 'standard' && <div className='mw-killer__types'>
                <label className='mw-label'>Strategies</label>
                <div className='mw-types-row'>
                    {(Object.keys(LABELS) as MultiKillerStrategy[]).map(s => (
                        <label key={s} className={`mw-type-chip ${selected.includes(s) ? 'mw-type-chip--active' : ''}`}>
                            <input type='checkbox' checked={selected.includes(s)}
                                onChange={() => toggle(s)} disabled={running} />
                            <span className='mw-type-chip__label'>{LABELS[s]}</span>
                            {HAS_DELAY[s] && selected.includes(s) && (
                                <div className='mw-select-wrap mw-select-wrap--sm'>
                                    <select
                                        className='mw-input mw-type-delay'
                                        value={delays[s] ?? 0}
                                        onChange={e => setDelays(p => ({ ...p, [s]: Number(e.target.value) }))}
                                        disabled={running}
                                        onClick={e => e.stopPropagation()}
                                    >
                                        <option value={0}>0t</option>
                                        <option value={1}>1t</option>
                                        <option value={2}>2t</option>
                                    </select>
                                    <span className='mw-select-arrow mw-select-arrow--sm'></span>
                                </div>
                            )}
                        </label>
                    ))}
                </div>
            </div>}

            {mode === 'standard' && showTickDir && (
                <div className='mw-killer__fields'>
                    <div className='mw-field mw-field--grow'>
                        <label className='mw-label'>Wait Ticks</label>
                        <input className='mw-input' type='number' min='1' max='20' step='1'
                            value={tickDirection}
                            onChange={e => setTickDirection(e.target.value)} />
                        <span className='mw-hint'>0 = off</span>
                    </div>
                    <div className='mw-field mw-field--grow'>
                        <label className='mw-label'>Direction</label>
                        <div className='mw-select-wrap'>
                            <select className='mw-input' value={tickDirMode}
                                onChange={e => setTickDirMode(e.target.value as any)}>
                                <option value='any'>Any</option>
                                <option value='ups'>Ups Only</option>
                                <option value='downs'>Downs Only</option>
                            </select>
                            <span className='mw-select-arrow'></span>
                        </div>
                    </div>
                </div>
            )}

            {mode === 'standard' && hasDirectional && showTickDir && (
                <div className='mw-accuracy-row'>
                    <button
                        className={`mw-accuracy-btn ${accuracy ? 'mw-accuracy-btn--on' : ''}`}
                        onClick={() => setAccuracy(a => !a)}
                        disabled={running}
                    >
                        <span className='mw-accuracy-icon'>{accuracy ? '🎯' : '🎯'}</span>
                        <span>Accuracy</span>
                        <span className={`mw-accuracy-toggle ${accuracy ? 'mw-accuracy-toggle--on' : ''}`}>
                            <span className='mw-accuracy-knob' />
                        </span>
                    </button>
                    <span className='mw-accuracy-hint'>
                        {accuracy ? '2-of-3 indicators (RSI+EMA+Extreme)' : 'Off — streak only'}
                    </span>
                </div>
            )}

            {mode === 'standard' && selected.length > 0 && (
                <div className='mw-killer__fields'>
                    {selected.map(s => (
                        <div key={s} className='mw-field mw-field--grow'>
                            <label className='mw-label'>{LABELS[s]} Stake</label>
                            <input className='mw-input' type='number' min='0.35' step='0.01'
                                value={stakes[s] ?? '10'}
                                onChange={e => setStakes(p => ({ ...p, [s]: e.target.value }))} />
                        </div>
                    ))}
                </div>
            )}

            {mode === 'standard' && selected.some(s => NEEDS_BARRIER[s] && s !== 'higher' && s !== 'lower') && (
                <div className='mw-killer__fields'>
                    {selected.filter(s => NEEDS_BARRIER[s] && s !== 'higher' && s !== 'lower').map(s => (
                        <div key={s} className='mw-field mw-field--grow'>
                            <label className='mw-label'>{LABELS[s]} Barrier</label>
                            <input className='mw-input' type='number' min='0' max='9' step='1'
                                value={barriers[s] ?? '5'}
                                onChange={e => setBarriers(p => ({ ...p, [s]: e.target.value }))} />
                        </div>
                    ))}
                </div>
            )}

            {mode === 'standard' && (selected.includes('higher') || selected.includes('lower')) && (
                <div className='mw-killer__fields mw-killer__fields--hl'>
                    <div className='mw-field mw-field--grow'>
                        <label className='mw-label'>H/L Duration (ticks)</label>
                        <input className='mw-input' type='number' min='1' max='50' step='1'
                            value={hlDuration}
                            onChange={e => setHlDuration(Math.max(1, parseInt(e.target.value) || 5))} />
                    </div>
                    <div className='mw-field mw-field--grow'>
                        <label className='mw-label'>H/L Barrier Offset</label>
                        <input className='mw-input' type='number' min='0.000001' step='0.000001'
                            placeholder='e.g. 0.02'
                            value={hlOffset}
                            onChange={e => setHlOffset(e.target.value)} />
                        <span className='mw-hint'>Higher: +offset · Lower: −offset (relative to entry)</span>
                    </div>
                </div>
            )}

            {mode === 'bot15' && (
                <>
                    <div className='mw-analyze-result' style={{ marginTop: 12 }}>
                        <div className='mw-analyze-head'><span>Bot 15 Strategy</span></div>
                        <pre>Two rising ticks → Fall 1t + Only Ups 2t; a local Fall loss sends an immediate Fall retry.
Two falling ticks → Only Downs 2t + Rise 1t; a local Rise loss sends an immediate Rise retry.</pre>
                    </div>
                    <div className='mw-killer__fields'>
                        {([
                            ['riseToFall', 'Rise → Fall'],
                            ['riseToOnlyUps', 'Rise → Only Ups'],
                            ['riseFallRetry', 'Fall Retry'],
                            ['fallToOnlyDowns', 'Fall → Only Downs'],
                            ['fallToRise', 'Fall → Rise'],
                            ['fallRiseRetry', 'Rise Retry'],
                        ] as const).map(([key, label]) => (
                            <div key={key} className='mw-field mw-field--grow'>
                                <label className='mw-label'>{label} Stake</label>
                                <input className='mw-input' type='number' min='0.35' step='0.01'
                                    value={bot15Stakes[key]}
                                    onChange={e => setBot15Stakes(p => ({ ...p, [key]: Number(e.target.value) }))} />
                            </div>
                        ))}
                    </div>
                    <div className='mw-killer__fields'>
                        {([
                            ['maxRoundStake', 'Max Round Exposure'],
                            ['maxSessionLoss', 'Session Loss Stop'],
                            ['cooldownTicks', 'Cooldown Ticks'],
                        ] as const).map(([key, label]) => (
                            <div key={key} className='mw-field mw-field--grow'>
                                <label className='mw-label'>{label}</label>
                                <input className='mw-input' type='number' min='0' step={key === 'cooldownTicks' ? '1' : '0.01'}
                                    value={bot15Risk[key]}
                                    onChange={e => setBot15Risk(p => ({ ...p, [key]: Number(e.target.value) }))} />
                                <span className='mw-hint'>{key === 'cooldownTicks' ? 'ticks between rounds' : '$0 = off'}</span>
                            </div>
                        ))}
                    </div>
                </>
            )}

            <div className='mw-killer__actions'>
                {running ? (
                    <button className='mw-btn mw-btn--stop' onClick={stop}>
                        <span className='mw-btn__text'>
                            {runPhase === 'waiting' && tickProgress.target > 0 && tickProgress.dir !== 'GO!'
                                ? `${tickProgress.dir} ${tickProgress.count}/${tickProgress.target}`
                                : runPhase === 'waiting' && '⏳ Waiting...'}
                            {runPhase === 'buying' && `📤 ${buyProgress.done}/${buyProgress.total}`}
                            {runPhase === 'settling' && `⏳ ${settleProgress.done}/${settleProgress.total}`}
                        </span>
                        {(buyProgress.total > 0 || settleProgress.total > 0) && (
                            <span className='mw-btn__bar'>
                                <span className='mw-btn__fill'
                                    style={{
                                        width: runPhase === 'buying'
                                            ? `${buyProgress.total > 0 ? (buyProgress.done / buyProgress.total) * 100 : 0}%`
                                            : `${settleProgress.total > 0 ? (settleProgress.done / settleProgress.total) * 100 : 0}%`,
                                        background: runPhase === 'buying'
                                            ? 'linear-gradient(90deg, #f97316, #fb923c)'
                                            : 'linear-gradient(90deg, #22c55e, #4ade80)',
                                    }} />
                            </span>
                        )}
                    </button>
                ) : (
                    <button className='mw-btn mw-btn--run' disabled={mode === 'standard' && !selected.length} onClick={start}>Run</button>
                )}
            </div>

            {analyzeResult && (
                <div className='mw-analyze-result'>
                    <div className='mw-analyze-head'>
                        <span>Analysis Result</span>
                        <div style={{ display: 'flex', gap: 6 }}>
                            <button className='mw-copy-btn' onClick={() => {
                                navigator.clipboard.writeText(analyzeResult);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                            }}>{copied ? '✓ Copied' : '📋 Copy'}</button>
                            <button className='mw-copy-btn' onClick={() => setAnalyzeResult(null)}>✕</button>
                        </div>
                    </div>
                    <pre>{analyzeResult}</pre>
                </div>
            )}

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
