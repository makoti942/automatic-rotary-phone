import { ALL_SYMBOLS, PIP_SIZES } from './makoti-ws';

/* ── Types ─────────────────────────────────────────────────────────────────── */
export interface SignalResult {
    action: 'BUY' | 'WAIT';
    contractType: string;
    barrier: number;
    symbol: string;
    confidence: number;
    predictedDigit: number;
    reason: string;
    details: string[];
}

export interface DigitAnalysis {
    predictedDigit: number;
    digitScores: number[];
    transitionProbs: number[];
    gapPressure: number[];
    hotCold: number[];
    pairBias: number[];
    streakInfo: { digit: number; len: number };
    patternMatch: string;
    patternWinRate: number;
    confidence: number;
}

/* ── Helpers ───────────────────────────────────────────────────────────────── */
export function getDigit(price: number, pip: number): number {
    return Number(Number(price).toFixed(pip).slice(-1));
}

export function calcFreq(ticks: number[]): number[] {
    const counts = new Array(10).fill(0);
    ticks.forEach(d => { if (d >= 0 && d <= 9) counts[d]++; });
    const total = counts.reduce((a, v) => a + v, 0);
    return total > 0 ? counts.map(c => (c / total) * 100) : counts;
}

/* ── Transition Matrix ─────────────────────────────────────────────────────── */
function buildTransitionMatrix(ticks: number[]): number[][] {
    const m: number[][] = Array.from({ length: 10 }, () => new Array(10).fill(0));
    for (let i = 1; i < ticks.length; i++) {
        const p = ticks[i - 1], c = ticks[i];
        if (p >= 0 && p <= 9 && c >= 0 && c <= 9) m[p][c]++;
    }
    return m.map(row => {
        const s = row.reduce((a, v) => a + v, 0);
        return s > 0 ? row.map(v => v / s) : new Array(10).fill(0.1);
    });
}

/* ── Gap Pressure ──────────────────────────────────────────────────────────── */
function calcGapPressure(ticks: number[]): number[] {
    const gaps = new Array(10).fill(ticks.length);
    for (let i = ticks.length - 1; i >= 0; i--) {
        const d = ticks[i];
        if (d >= 0 && d <= 9 && gaps[d] === ticks.length) gaps[d] = ticks.length - 1 - i;
    }
    const mx = Math.max(...gaps, 1);
    return gaps.map(g => (g / mx) * 100);
}

/* ── Hot/Cold ──────────────────────────────────────────────────────────────── */
function calcHotCold(ticks: number[]): number[] {
    const r = ticks.slice(-30), o = ticks.slice(-100, -30);
    if (r.length < 5 || o.length < 5) return new Array(10).fill(0);
    return calcFreq(r).map((f, i) => f - calcFreq(o)[i]);
}

/* ── Pair Bias ─────────────────────────────────────────────────────────────── */
function calcPairBias(ticks: number[]): number[] {
    const last = ticks[ticks.length - 1];
    if (last < 0 || last > 9) return new Array(10).fill(10);
    const pairs = new Array(10).fill(0);
    let cnt = 0;
    for (let i = 1; i < ticks.length; i++) {
        if (ticks[i - 1] === last) { pairs[ticks[i]]++; cnt++; }
    }
    if (cnt === 0) return new Array(10).fill(10);
    return pairs.map(p => (p / cnt) * 100);
}

/* ── Streak ────────────────────────────────────────────────────────────────── */
function detectStreak(ticks: number[]): { digit: number; len: number } {
    if (!ticks.length) return { digit: -1, len: 0 };
    const last = ticks[ticks.length - 1];
    let len = 1;
    for (let i = ticks.length - 2; i >= 0; i--) {
        if (ticks[i] === last) len++; else break;
    }
    return { digit: last, len };
}

/* ── Pattern Match ─────────────────────────────────────────────────────────── */
function findPatternMatch(ticks: number[]): { pattern: string; winRate: number; digit: number } {
    if (ticks.length < 10) return { pattern: 'insufficient data', winRate: 0, digit: -1 };
    for (const patLen of [4, 3, 2]) {
        if (ticks.length < patLen + 2) continue;
        const pat = ticks.slice(-patLen);
        const matches: number[] = [];
        for (let i = 0; i <= ticks.length - patLen - 1; i++) {
            let ok = true;
            for (let j = 0; j < patLen; j++) { if (ticks[i + j] !== pat[j]) { ok = false; break; } }
            if (ok && i + patLen < ticks.length) matches.push(ticks[i + patLen]);
        }
        if (matches.length >= 3) {
            const freq = new Array(10).fill(0);
            matches.forEach(d => freq[d]++);
            const best = freq.indexOf(Math.max(...freq));
            return { pattern: `${patLen}-seq (${matches.length} hits)`, winRate: (freq[best] / matches.length) * 100, digit: best };
        }
    }
    return { pattern: 'no match', winRate: 0, digit: -1 };
}

/* ══════════════════════════════════════════════════════════════════════════════ */
/* ── Analyze and predict the NEXT digit ─────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════════════════════════ */
export function analyzeDigits(ticks: number[]): DigitAnalysis {
    const empty: DigitAnalysis = {
        predictedDigit: 5, digitScores: new Array(10).fill(10),
        transitionProbs: [], gapPressure: [], hotCold: [], pairBias: [],
        streakInfo: { digit: -1, len: 0 }, patternMatch: 'collecting', patternWinRate: 0, confidence: 0,
    };
    if (ticks.length < 30) return empty;

    const transitionMatrix = buildTransitionMatrix(ticks);
    const gapPressure = calcGapPressure(ticks);
    const hotCold = calcHotCold(ticks);
    const pairBias = calcPairBias(ticks);
    const streakInfo = detectStreak(ticks);
    const pattern = findPatternMatch(ticks);
    const freq = calcFreq(ticks);
    const lastDigit = ticks[ticks.length - 1];
    const transitionProbs = transitionMatrix[lastDigit] || new Array(10).fill(0.1);

    const digitScores = new Array(10).fill(0);
    for (let d = 0; d < 10; d++) {
        digitScores[d] += transitionProbs[d] * 35;
        digitScores[d] += (gapPressure[d] / 100) * 25;
        digitScores[d] += (Math.max(0, hotCold[d]) / 15) * 15;
        digitScores[d] += (pairBias[d] / 100) * 15;
        if (pattern.digit === d && pattern.winRate > 50) digitScores[d] += (pattern.winRate / 100) * 10;
    }
    if (streakInfo.len >= 2 && streakInfo.digit >= 0) {
        digitScores[streakInfo.digit] *= Math.max(0.2, 1 - streakInfo.len * 0.15);
    }
    freq.forEach((pct, d) => { if (pct < 7) digitScores[d] += 3; });

    const maxScore = Math.max(...digitScores);
    const predictedDigit = digitScores.indexOf(maxScore);
    const avg = digitScores.reduce((a, v) => a + v, 0) / 10;
    const confidence = Math.min(95, Math.max(0,
        ((maxScore - avg) / Math.max(avg, 1)) * 60 +
        (pattern.winRate > 60 ? 15 : 0) +
        (streakInfo.len >= 3 ? 10 : 0) + 20
    ));

    return {
        predictedDigit, digitScores, transitionProbs, gapPressure,
        hotCold, pairBias, streakInfo, patternMatch: pattern.pattern,
        patternWinRate: pattern.winRate, confidence,
    };
}

/* ══════════════════════════════════════════════════════════════════════════════ */
/* ── Convert digit prediction to optimal contract ───────────────────────────── */
/* ══════════════════════════════════════════════════════════════════════════════ */
export function predictContract(analysis: DigitAnalysis, ticks: number[], symbol: string): SignalResult {
    const details: string[] = [];
    const { predictedDigit, digitScores, confidence, streakInfo, patternMatch, patternWinRate } = analysis;

    if (ticks.length < 30 || confidence < 30) {
        return { action: 'WAIT', contractType: 'NONE', barrier: 5, symbol, confidence: 0, predictedDigit: 5, reason: 'Collecting...', details: [] };
    }

    details.push(`Predicted: ${predictedDigit} | Score: ${digitScores[predictedDigit].toFixed(1)} avg: ${(digitScores.reduce((a, v) => a + v, 0) / 10).toFixed(1)}`);
    if (patternMatch !== 'no match' && patternMatch !== 'insufficient data') {
        details.push(`Pattern: ${patternMatch} -> ${patternWinRate.toFixed(0)}%`);
    }
    if (streakInfo.len >= 2) details.push(`Streak: ${streakInfo.len}x ${streakInfo.digit}`);
    const sorted = digitScores.map((s, i) => ({ d: i, s })).sort((a, b) => b.s - a.s);
    details.push(`Top: ${sorted.slice(0, 3).map(x => `${x.d}(${x.s.toFixed(1)})`).join(' ')}`);

    let contractType: string;
    let barrier: number;
    let direction: string;

    if (predictedDigit >= 7) {
        contractType = 'DIGITOVER'; direction = 'OVER';
        barrier = predictedDigit === 9 ? 6 : predictedDigit - 1;
    } else if (predictedDigit >= 6) {
        contractType = 'DIGITOVER'; direction = 'OVER';
        barrier = 4;
    } else if (predictedDigit <= 2) {
        contractType = 'DIGITUNDER'; direction = 'UNDER';
        barrier = predictedDigit === 0 ? 3 : predictedDigit + 1;
    } else if (predictedDigit <= 3) {
        contractType = 'DIGITUNDER'; direction = 'UNDER';
        barrier = 5;
    } else {
        return { action: 'WAIT', contractType: 'NONE', barrier: 5, symbol, confidence, predictedDigit, reason: 'Middle digit', details };
    }

    if (confidence < 50) {
        return { action: 'WAIT', contractType: 'NONE', barrier: 5, symbol, confidence, predictedDigit, reason: 'Low confidence', details };
    }

    return { action: 'BUY', contractType, barrier, symbol, confidence, predictedDigit, reason: `Predict ${predictedDigit} -> ${direction} ${barrier} (${confidence.toFixed(0)}%)`, details };
}

/* ══════════════════════════════════════════════════════════════════════════════ */
/* ── Scan ALL symbols, return best signal ───────────────────────────────────── */
/* ══════════════════════════════════════════════════════════════════════════════ */
export interface SymbolState {
    ticks: number[];
    analysis: DigitAnalysis | null;
    signal: SignalResult | null;
}

export function scanAllSymbols(allTicks: Map<string, number[]>): { best: SignalResult | null; states: Map<string, SymbolState> } {
    const states = new Map<string, SymbolState>();
    let best: SignalResult | null = null;

    for (const sym of ALL_SYMBOLS) {
        const ticks = allTicks.get(sym) || [];
        const analysis = analyzeDigits(ticks);
        const signal = predictContract(analysis, ticks, sym);
        states.set(sym, { ticks, analysis, signal });

        if (signal.action === 'BUY' && signal.confidence >= 50) {
            if (!best || signal.confidence > best.confidence) {
                best = signal;
            }
        }
    }

    return { best, states };
}
