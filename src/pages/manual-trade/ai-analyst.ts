/**
 * Pure analysis engine for the AI Analyst panel.
 * Computes REAL statistics from raw tick series (no guessing) and asks a
 * fast Groq LLM to select a strategy strictly grounded in those numbers.
 * The key lives server-side (api/groq.js + Vercel env var) — never committed.
 */

export const VOLATILITY_LIST = [
    'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
    '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
] as const;

export type VolatilitySymbol = typeof VOLATILITY_LIST[number];

export type AiContractType =
    | 'DIGITMATCH' | 'DIGITDIFF' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD';

export interface AiEntryTrigger {
    /** gap_reached = wait until `digit` absent for min_gap ticks; last_digit_equals = fire when newest tick ends in `digit`; immediate = fire at once */
    type: 'gap_reached' | 'last_digit_equals' | 'immediate';
    digit: number;
    min_gap: number;
}

export interface AiPlan {
    market: VolatilitySymbol;
    contract_type: AiContractType;
    barrier_digit: number | null;
    duration_ticks: number;
    entry_trigger: AiEntryTrigger;
    confidence: number;
    /** One-sentence plain-language takeaway (≤180 chars) */
    summary: string;
    rationale: string;
    monitoring: string;
    risk_notes: string;
}

export interface DigitStat {
    pct: number;        // frequency % over full window (baseline 10)
    mean_gap: number;   // avg tick distance between appearances (-1 if <2 seen)
    med_gap: number;    // median gap
    p90_gap: number;    // 90th percentile gap — long-drought threshold
    cur_gap: number;    // ticks since last appearance at window end
    drift: number;      // recent-50 % minus overall %
}

export interface SymbolStats {
    symbol: string;
    total_ticks: number;
    digits: DigitStat[];
    /** Frequency % of each digit across four consecutive quarters of the
     *  1000-tick window (oldest → newest) — reveals evolving behaviour. */
    quarters: number[][];
    transitions: { from: number; to: number; pct: number }[]; // strongest next-digit influences
    /** After digit d, probability vector of the NEXT digit (0-9). */
    next_dist: number[][];
    /** After digit d, probability of each digit within the next 3 ticks. */
    next_3_dist: number[][];
    /** Shannon entropy per quarter — rising = more random, falling = more predictable. */
    entropy_trend: number[];
    streak_repeat_pct: { digit: number; pct: number }[];
    even_pct: number;
    hi_pct: number; // digits 5-9
    /** Autocorrelation at lags 1,2,3 — positive = momentum, negative = oscillation */
    autocorr: number[];
    /** Chi-squared vs uniform (last 200 ticks). >17 = significant at p<0.05 */
    chi2: number;
    /** RSI-like momentum: recent avg vs older avg digit. Range -100 to +100 */
    momentum: number;
    /** Short MA(20) minus long MA(100) of digit values */
    ma_signal: number;
    /** Autocorrelation of |digit changes| — volatility clustering */
    vol_cluster: number;
    /** Mean consecutive same-digit run length */
    run_mean: number;
    /** Top 5 most frequent digit pairs */
    top_pairs: { from: number; to: number; pct: number }[];
}

/** Default pip sizes for volatility indices (matches Deriv values). */
export function volPipSize(symbol: string): number {
    if (symbol.startsWith('1HZ')) return 2;
    switch (symbol) {
        case 'R_25': return 3;
        case 'R_75': return 4;
        case 'R_50': return 4;
        case 'R_100': return 2;
        default: return 3; // R_10
    }
}

function getDigit(price: number, pip: number): number {
    return Number(Number(price).toFixed(pip).slice(-1));
}

const r1 = (v: number) => Math.round(v * 10) / 10;

function percentile(sorted: number[], p: number): number {
    if (!sorted.length) return -1;
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
}

function autocorr(arr: number[], lag: number): number {
    const n = arr.length;
    if (n <= lag) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
        den += (arr[i] - mean) ** 2;
        if (i >= lag) num += (arr[i] - mean) * (arr[i - lag] - mean);
    }
    return den === 0 ? 0 : Math.round((num / den) * 100) / 100;
}

function chiSquared(digits: number[]): number {
    const recent = digits.slice(-200);
    const n = recent.length;
    if (n < 50) return 0;
    const expected = n / 10;
    let chi2 = 0;
    for (let d = 0; d < 10; d++) {
        const obs = recent.filter(x => x === d).length;
        chi2 += ((obs - expected) ** 2) / expected;
    }
    return Math.round(chi2 * 10) / 10;
}

function momentum(digits: number[]): number {
    const p = 14;
    if (digits.length < p * 2) return 0;
    const recent = digits.slice(-p);
    const prev = digits.slice(-p * 2, -p);
    const rAvg = recent.reduce((a, b) => a + b, 0) / p;
    const pAvg = prev.reduce((a, b) => a + b, 0) / p;
    return Math.round(Math.max(-100, Math.min(100, ((rAvg - pAvg) / 4.5) * 100)));
}

function maCross(digits: number[]): number {
    const s = 20, l = 100;
    if (digits.length < l) return 0;
    const sMA = digits.slice(-s).reduce((a, b) => a + b, 0) / s;
    const lMA = digits.slice(-l).reduce((a, b) => a + b, 0) / l;
    return Math.round((sMA - lMA) * 100) / 100;
}

function volCluster(digits: number[]): number {
    if (digits.length < 50) return 0;
    const ch: number[] = [];
    for (let i = 1; i < digits.length; i++) ch.push(Math.abs(digits[i] - digits[i - 1]));
    return autocorr(ch, 1);
}

function meanRunLen(digits: number[]): number {
    if (!digits.length) return 0;
    let total = 0, count = 0, cur = 1;
    for (let i = 1; i < digits.length; i++) {
        if (digits[i] === digits[i - 1]) cur++;
        else { total += cur; count++; cur = 1; }
    }
    total += cur; count++;
    return Math.round((total / count) * 10) / 10;
}

function topPairs(digits: number[]): { from: number; to: number; pct: number }[] {
    const c: number[][] = Array.from({ length: 10 }, () => new Array(10).fill(0));
    for (let i = 0; i < digits.length - 1; i++) c[digits[i]][digits[i + 1]]++;
    const pairs: { from: number; to: number; pct: number }[] = [];
    for (let f = 0; f < 10; f++)
        for (let t = 0; t < 10; t++)
            if (c[f][t] > 0) pairs.push({ from: f, to: t, pct: r1((c[f][t] / (digits.length - 1)) * 100) });
    return pairs.sort((a, b) => b.pct - a.pct).slice(0, 5);
}

export function computeSymbolStats(symbol: string, prices: number[]): SymbolStats {
    const pip = volPipSize(symbol);
    const digits = prices.map(p => getDigit(p, pip)).filter(d => d >= 0 && d <= 9);
    const n = digits.length;

    const counts = new Array(10).fill(0);
    digits.forEach(d => counts[d]++);

    // Gap distributions per digit
    const gapsPerDigit: number[][] = Array.from({ length: 10 }, () => []);
    const lastIndex = new Array(10).fill(-1);
    digits.forEach((d, i) => {
        if (lastIndex[d] !== -1) gapsPerDigit[d].push(i - lastIndex[d]);
        lastIndex[d] = i;
    });

    const digitStats: DigitStat[] = [];
    for (let d = 0; d < 10; d++) {
        const g = [...gapsPerDigit[d]].sort((a, b) => a - b);
        const mean = g.length ? r1(g.reduce((a, v) => a + v, 0) / g.length) : -1;
        const med = percentile(g, 50);
        const p90 = percentile(g, 90);
        digitStats.push({
            pct: r1((counts[d] / n) * 100),
            mean_gap: mean,
            med_gap: med,
            p90_gap: p90,
            cur_gap: lastIndex[d] === -1 ? n : n - 1 - lastIndex[d],
            drift: 0, // filled below
        });
    }

    // Recent drift
    const recent = digits.slice(-50);
    const rc = new Array(10).fill(0);
    recent.forEach(d => rc[d]++);
    for (let d = 0; d < 10; d++) {
        digitStats[d].drift = r1(r1((rc[d] / Math.max(1, recent.length)) * 100) - digitStats[d].pct);
    }

    // Transition matrix: P(next | current), keep strongest pairs
    const transCount: number[][] = Array.from({ length: 10 }, () => new Array(10).fill(0));
    for (let i = 0; i < n - 1; i++) transCount[digits[i]][digits[i + 1]]++;
    const rowTotals = transCount.map(row => row.reduce((a, v) => a + v, 0));
    const transitions: { from: number; to: number; pct: number }[] = [];
    for (let f = 0; f < 10; f++) {
        for (let t = 0; t < 10; t++) {
            if (transCount[f][t] > 0 && rowTotals[f] > 0) {
                transitions.push({ from: f, to: t, pct: r1((transCount[f][t] / rowTotals[f]) * 100) });
            }
        }
    }
    transitions.sort((a, b) => b.pct - a.pct);

    // Streak-repeat behaviour: P(next == same | run of that digit >= 2 just ended... measured live):
    // count occurrences where a digit appeared >=2 times consecutively and appeared again right after.
    const runStartCount = new Array(10).fill(0);
    const runRepeatCount = new Array(10).fill(0);
    let runLen = 1;
    for (let i = 1; i < n; i++) {
        if (digits[i] === digits[i - 1]) {
            runLen++;
        } else {
            if (runLen >= 2) {
                runStartCount[digits[i - 1]]++;
                // did the digit reappear within the next 2 ticks?
                if ((i < n && digits[i] === digits[i - 1]) || (i + 1 < n && digits[i + 1] === digits[i - 1])) {
                    runRepeatCount[digits[i - 1]]++;
                }
            }
            runLen = 1;
        }
    }
    const streak_repeat_pct = runStartCount.map((c, d) => ({
        digit: d,
        pct: c > 0 ? r1((runRepeatCount[d] / c) * 100) : 0,
    })).filter(s => s.pct > 0);

    const evenCount = digits.filter(d => d % 2 === 0).length;
    const hiCount = digits.filter(d => d >= 5).length;

    // ── Advanced indicators ─────────────────────────────────────────
    const ac = [autocorr(digits, 1), autocorr(digits, 2), autocorr(digits, 3)];
    const chi2 = chiSquared(digits);
    const mom = momentum(digits);
    const ma = maCross(digits);
    const vc = volCluster(digits);
    const runM = meanRunLen(digits);
    const pairs = topPairs(digits);

    // ── Sequential pattern analysis ──────────────────────────────────
    // next_dist[d][t] = P(next digit = t | current digit = d)
    const nextCount: number[][] = Array.from({ length: 10 }, () => new Array(10).fill(0));
    for (let i = 0; i < n - 1; i++) nextCount[digits[i]][digits[i + 1]]++;
    const nextDist: number[][] = Array.from({ length: 10 }, () => new Array(10).fill(0));
    for (let d = 0; d < 10; d++) {
        const total = nextCount[d].reduce((a, v) => a + v, 0);
        if (total > 0) for (let t = 0; t < 10; t++) nextDist[d][t] = r1((nextCount[d][t] / total) * 100);
    }

    // next_3_dist[d][t] = P(digit t appears within the next 3 ticks after d)
    const next3Count: number[] = new Array(10).fill(0);
    const next3Hit: number[][] = Array.from({ length: 10 }, () => new Array(10).fill(0));
    for (let i = 0; i < n; i++) {
        next3Count[digits[i]]++;
        for (let j = 1; j <= 3 && i + j < n; j++) next3Hit[digits[i]][digits[i + j]]++;
    }
    const next3Dist: number[][] = Array.from({ length: 10 }, () => new Array(10).fill(0));
    for (let d = 0; d < 10; d++) {
        if (next3Count[d] > 0) for (let t = 0; t < 10; t++) next3Dist[d][t] = r1((next3Hit[d][t] / next3Count[d]) * 100);
    }

    // Quarterly evolution: split the window into 4 equal slices, oldest →
    // newest, and measure each digit's frequency inside every slice.
    const qSize = Math.floor(n / 4);
    const quarters: number[][] = Array.from({ length: 10 }, () => new Array(4).fill(0));
    for (let q = 0; q < 4; q++) {
        const start = q * qSize;
        const end = q === 3 ? n : start + qSize;
        const sliceLen = end - start;
        if (sliceLen <= 0) continue;
        for (let i = start; i < end; i++) quarters[digits[i]][q]++;
        for (let d = 0; d < 10; d++) quarters[d][q] = r1((quarters[d][q] / sliceLen) * 100);
    }

    // Shannon entropy per quarter — measures predictability (MUST come after quarters)
    const entropyTrend: number[] = [];
    for (let q = 0; q < 4; q++) {
        let H = 0;
        for (let d = 0; d < 10; d++) {
            const p = quarters[d][q] / 100;
            if (p > 0) H -= p * Math.log2(p);
        }
        entropyTrend.push(Math.round(H * 100) / 100);
    }

    return {
        symbol,
        total_ticks: n,
        digits: digitStats,
        quarters,
        transitions: transitions.slice(0, 8),
        next_dist: nextDist,
        next_3_dist: next3Dist,
        entropy_trend: entropyTrend,
        streak_repeat_pct: streak_repeat_pct.sort((a, b) => b.pct - a.pct).slice(0, 4),
        even_pct: r1((evenCount / n) * 100),
        hi_pct: r1((hiCount / n) * 100),
        autocorr: ac,
        chi2,
        momentum: mom,
        ma_signal: ma,
        vol_cluster: vc,
        run_mean: runM,
        top_pairs: pairs,
    };
}

/** Simulate a plan against collected tick prices. Returns { winRate, pnl, trades }.
 *  Context-aware: only trades after the AI's specified context digit appears. */
export function backtestPlan(
    plan: AiPlan,
    prices: number[],
): { winRate: number; pnl: number; trades: number } {
    const pip = volPipSize(plan.market);
    const digits = prices.map(p => getDigit(p, pip)).filter(d => d >= 0 && d <= 9);
    const t = plan.entry_trigger;
    const dur = plan.duration_ticks;
    const stake = 1;
    const payouts: Record<AiContractType, number> = {
        DIGITMATCH: 9, DIGITDIFF: 1.9, DIGITOVER: 2,
        DIGITUNDER: 2, DIGITEVEN: 2, DIGITODD: 2,
    };
    const payout = payouts[plan.contract_type] ?? 2;
    const barrier = plan.barrier_digit ?? 5;

    // Context-aware: extract context digit from rationale if mentioned
    // e.g. "after digit 3" → contextDigit = 3
    let contextDigit = -1;
    const ctxMatch = (plan.rationale + ' ' + plan.summary).match(/after digit (\d)/i);
    if (ctxMatch) contextDigit = parseInt(ctxMatch[1]);

    let wins = 0, losses = 0, pnl = 0;
    let i = 0;
    while (i < digits.length - dur - 1) {
        // Entry: last_digit_equals
        if (t.type === 'last_digit_equals') {
            // Must see trigger digit at position i
            if (digits[i] !== t.digit) { i++; continue; }
            // If context digit specified, check the tick BEFORE the trigger
            if (contextDigit >= 0 && i > 0 && digits[i - 1] !== contextDigit) {
                i++; continue;
            }
        }
        i++;
        const exitIdx = Math.min(i + dur - 1, digits.length - 1);
        const exitDigit = digits[exitIdx];
        let win = false;
        switch (plan.contract_type) {
            case 'DIGITMATCH': win = exitDigit === barrier; break;
            case 'DIGITDIFF': win = exitDigit !== barrier; break;
            case 'DIGITOVER': win = exitDigit > barrier; break;
            case 'DIGITUNDER': win = exitDigit < barrier; break;
            case 'DIGITEVEN': win = exitDigit % 2 === 0; break;
            case 'DIGITODD': win = exitDigit % 2 === 1; break;
        }
        if (win) { wins++; pnl += stake * (payout - 1); }
        else { losses++; pnl -= stake; }
        i += dur;
    }
    const total = wins + losses;
    return {
        winRate: total > 0 ? Math.round((wins / total) * 1000) / 10 : 0,
        pnl: Math.round(pnl * 100) / 100,
        trades: total,
    };
}

const SYS_PROMPT =
    'You are an elite quant analyst for Deriv synthetic markets. You crack the matrix of digit sequences.\n\n' +
    '## CONTRACT RULES (exit digit decides win/loss)\n' +
    '| Type | Win condition | Payout | Break-even |\n' +
    '|------|---------------|--------|------------|\n' +
    '| DIGITMATCH | exit==barrier | ~9x | >11.1% |\n' +
    '| DIGITDIFF | exit!=barrier | ~1.9x | >52.6% |\n' +
    '| DIGITOVER | exit>barrier (0-8) | ~2x | >50% |\n' +
    '| DIGITUNDER | exit<barrier (1-9) | ~2x | >50% |\n' +
    '| DIGITEVEN | exit%2==0 | ~2x | >50% |\n' +
    '| DIGITODD | exit%2==1 | ~2x | >50% |\n' +
    'Duration: 1-5 ticks.\n\n' +
    '## THE MATRIX: HOW DIGITS BEHAVE\n\n' +
    'Digits are NOT random. They follow patterns:\n\n' +
    '### 1. Markov Transitions (nX data)\n' +
    'P(next digit = Y | current digit = X). This is the KEY insight.\n' +
    'If digit 6 appears, what comes next? nX shows conditional probabilities.\n' +
    'Example: nX "6>7:18" means after 6, digit 7 appears 18% (vs 10% baseline = 8pp edge!).\n\n' +
    '### 2. Multi-Step Lookahead (n3X data)\n' +
    'P(digit Y appears within next 3 ticks | current digit = X).\n' +
    'Example: n3X "6>7:35" means within 3 ticks after 6, digit 7 appears 35%.\n\n' +
    '### 3. Drought Analysis\n' +
    'drought[X] = ticks since digit X last appeared. If drought > mean_gap, digit is overdue.\n\n' +
    '### 4. Frequency Analysis\n' +
    'freq[X] = overall frequency (baseline 10%). >11% = overrepresented. <9% = underrepresented.\n\n' +
    '### 5. Entropy Trend\n' +
    'ent=[Q1,Q2,Q3,Q4]. Falling = more predictable = exploitable. Rising = more random.\n\n' +
    '### 6. Autocorrelation\n' +
    'auto=[lag1,lag2,lag3]. Positive = momentum. Negative = oscillation.\n\n' +
    '### 7. Statistical Significance\n' +
    'chi2 > 17 = non-random distribution (p<0.05). Higher = stronger patterns.\n\n' +
    '### 8. Digit Pairs\n' +
    'pairs = top consecutive pairs X>Y. If (3,7) appears 15% vs 10% baseline, strong pattern.\n\n' +
    '## YOUR STRATEGY PROCESS\n' +
    '1. Find best market: highest chi2 + falling entropy + strong autocorrelation\n' +
    '2. Find best digit: highest freq + overdue drought + strong transitions\n' +
    '3. Find best entry: use nX/n3X to predict what comes after the current digit\n' +
    '4. Cross-check: confirm with 2+ independent indicators\n' +
    '5. Calculate EV: if positive, trade; if negative, skip\n\n' +
    '## ENTRY RULE\n' +
    'ALWAYS use entry_trigger.type="last_digit_equals". Wait for trigger digit, then trade.\n' +
    'The trigger digit must be chosen based on Markov transitions (nX data).\n' +
    'You MUST specify the context digit in rationale: "after digit X, digit Y appears Z%".\n\n' +
    '## EXAMPLE THINKING\n' +
    '"R_100: chi2=22.3 (significant!), ent falling 3.28→3.05, auto[0]=0.05 (momentum).\n' +
    'Digit 7 freq=12.5% (2.5pp above baseline). After digit 3, digit 7 appears 18% (nX: 3>7:18) = 8pp edge!\n' +
    'Digit 7 drought=12, mean_gap=8 → overdue. n3X: 3>7:35 → within 3 ticks, 35% chance.\n' +
    'CONCLUSION: DIGITMATCH on digit 7, barrier 7, duration 1 tick.\n' +
    'Wait for digit 3 to appear, then watch for digit 7."\n\n' +
    '## RULES\n' +
    '- Cross-check with 2+ indicators. Edges >1.5pp from baseline.\n' +
    '- If previous plan lost, use DIFFERENT archetype/market.\n' +
    '- Confidence 50-85.\n' +
    '- Summary MUST start with: "Watch for digit X on [market]".\n' +
    '- BREVITY: summary<=180, rationale<=260, monitoring<=140, risk_notes<=120.\n' +
    '- Respond ONLY minified JSON.';

/** Objective local pre-score — higher = stronger exploitable edge. */
function scoreMarket(s: SymbolStats): number {
    const dev = Math.max(...s.digits.map(d => Math.abs(d.pct - 10)));
    const drought = Math.max(...s.digits.map(d => (d.mean_gap > 0 ? d.cur_gap / d.mean_gap : 0)));
    const trans = Math.max(0, ...s.transitions.map(t => t.pct - 10));
    const swing = Math.max(...s.digits.map(d => Math.abs(d.drift)));
    const chiBonus = Math.min(s.chi2 / 8, 3);
    const acBonus = Math.abs(s.autocorr[0]) * 4;
    const entBonus = (s.entropy_trend[0] - s.entropy_trend[3]) > 0.08 ? 3 : 0;
    const pairBonus = s.top_pairs.length > 0 && s.top_pairs[0].pct > 14 ? 2 : 0;
    return Math.round((dev * 1.5 + Math.min(drought, 4) * 12 + trans * 2 + swing * 2 + chiBonus + acBonus + entBonus + pairBonus) * 10) / 10;
}

function buildDigest(stats: SymbolStats[]): string {
    // ALL 10 markets — aggressively compressed. Max ~1.5K tokens total.
    const scored = stats.map(s => ({ s, score: scoreMarket(s) })).sort((a, b) => b.score - a.score);
    const allNx: { from: number; to: number; pct: number; sym: string }[] = [];
    const allN3x: { from: number; to: number; pct: number; sym: string }[] = [];
    scored.forEach(({ s }) => {
        for (let d = 0; d < 10; d++) {
            for (let t = 0; t < 10; t++) {
                if (s.next_dist[d][t] > 12) allNx.push({ from: d, to: t, pct: s.next_dist[d][t], sym: s.symbol });
                if (s.next_3_dist[d][t] > 22) allN3x.push({ from: d, to: t, pct: s.next_3_dist[d][t], sym: s.symbol });
            }
        }
    });
    allNx.sort((a, b) => b.pct - a.pct);
    allN3x.sort((a, b) => b.pct - a.pct);
    const topNx = allNx.slice(0, 20).map(n => `${n.sym}:${n.from}>${n.to}:${n.pct}`).join('|');
    const topN3x = allN3x.slice(0, 15).map(n => `${n.sym}:${n.from}>${n.to}:${n.pct}`).join('|');
    const markets = scored.map(({ s, score }) => {
        const freq = s.digits.map((d, i) => d.pct > 11.5 || d.pct < 8.5 ? `${i}:${d.pct}` : '').filter(Boolean).join(',');
        const drt = s.digits.map((d, i) => d.mean_gap > 0 && d.cur_gap > d.mean_gap * 1.3 ? `${i}:${d.cur_gap}t` : '').filter(Boolean).join(',');
        const topP = s.top_pairs.slice(0, 2).map(p => `${p.from}>${p.to}:${p.pct}`).join('|');
        const entDrop = Math.round((s.entropy_trend[0] - s.entropy_trend[3]) * 100) / 100;
        return `${s.symbol}(${score}) f=[${freq || '~'}] d=[${drt || '~'}] p=${topP || '~'} eΔ=${entDrop > 0 ? '+' : ''}${entDrop} c=${s.chi2} a=${s.autocorr[0]}`;
    });
    return JSON.stringify({ nx: topNx, n3x: topN3x, M: markets });
}

function buildUserPrompt(digest: string): string {
    return (
        digest +
        '\n nx=Markov transitions(top20 across all markets). n3x=3-step lookahead(top15). M=markets: f=freq,d=drought,p=pairs,eΔ=entropy change,c=chi2,a=autocorr.\n' +
        'Pick the market+digit with the strongest nX edge. Cross-check with chi2>17 and falling entropy.\n' +
        'Rationale MUST cite the exact nX transition: "after X, Y appears Z% (edge Zpp)".\n' +
        '{"market":"sym","contract_type":"DIGITMATCH|DIGITDIFF|DIGITOVER|DIGITUNDER|DIGITEVEN|DIGITODD",' +
        '"barrier_digit":N,"duration_ticks":1-5,' +
        '"entry_trigger":{"type":"last_digit_equals","digit":N,"min_gap":0},' +
        '"confidence":50-85,"summary":"Watch for digit N on [market]","rationale":"[archetype] after X→Y at Z% (nX:X>Y:Z)",' +
        '"monitoring":"<140","risk_notes":"<120"}'
    );
}

export function normalizePlan(raw: any, focus?: AiFocus): AiPlan {
    const market = VOLATILITY_LIST.includes(raw?.market)
        ? raw.market
        : VOLATILITY_LIST[0];
    const TYPES: AiContractType[] = ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD'];
    let contract_type: AiContractType = TYPES.includes(raw?.contract_type) ? raw.contract_type : 'DIGITDIFF';
    // Hard family constraint from the focus dropdown
    if (focus && focus !== 'auto' && !FOCUS_TYPES[focus].includes(contract_type)) {
        contract_type = FOCUS_TYPES[focus][0];
    }
    const needsBarrier = contract_type !== 'DIGITEVEN' && contract_type !== 'DIGITODD';
    let barrier = Number(raw?.barrier_digit);
    const duration_ticks = Math.min(5, Math.max(1, Math.round(Number(raw?.duration_ticks)) || 1));
    const tTypes = ['gap_reached', 'last_digit_equals', 'immediate'];
    const trig = raw?.entry_trigger ?? {};
    let digit = Math.min(9, Math.max(0, Math.round(Number(trig.digit)) || 0));

    // ── Deriv contract validity enforcement ────────────────────────────
    if (contract_type === 'DIGITOVER') {
        barrier = Math.min(8, Math.max(0, Math.round(Number(raw?.barrier_digit))));
        digit = Math.min(digit, 8);
    } else if (contract_type === 'DIGITUNDER') {
        barrier = Math.max(1, Math.min(9, Math.round(Number(raw?.barrier_digit))));
        digit = Math.max(1, digit);
    } else {
        barrier = Math.round(Number(raw?.barrier_digit));
    }
    const barrier_digit = needsBarrier
        ? (Number.isFinite(barrier) ? Math.min(9, Math.max(0, barrier)) : 5)
        : null;
    const min_gap = Math.min(10, Math.max(0, Math.round(Number(trig.min_gap)) || 0));
    // ALWAYS force last_digit_equals — user needs a specific digit to watch for
    const type = 'last_digit_equals';
    return {
        market,
        contract_type,
        barrier_digit,
        duration_ticks,
        entry_trigger: { type, digit, min_gap },
        confidence: Math.min(100, Math.max(0, Math.round(Number(raw?.confidence)) || 0)),
        summary: String(raw?.summary ?? '').slice(0, 200),
        rationale: String(raw?.rationale ?? '').slice(0, 400),
        monitoring: String(raw?.monitoring ?? '').slice(0, 220),
        risk_notes: String(raw?.risk_notes ?? '').slice(0, 180),
    };
}

export type AiFocus = 'auto' | 'matches-differs' | 'over-under' | 'even-odd';

const FOCUS_TYPES: Record<Exclude<AiFocus, 'auto'>, AiContractType[]> = {
    'matches-differs': ['DIGITMATCH', 'DIGITDIFF'],
    'over-under': ['DIGITOVER', 'DIGITUNDER'],
    'even-odd': ['DIGITEVEN', 'DIGITODD'],
};

/**
 * Calls the AI backend and returns a validated plan.
 * Primary path: /api/groq serverless proxy (key lives in Vercel env var —
 * never in the repo or bundle). If no function exists (local static preview),
 * falls back to a direct Groq call with an optional localStorage key.
 */
async function callGroq(payload: any, endpoint = '/api/groq'): Promise<any> {
    // 1) Serverless proxy (production)
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const text = await res.text();
        let j: any;
        try { j = JSON.parse(text); } catch (_) {
            j = null;
        }
        if (j) {
            if (!res.ok || j?.error) throw new Error(j?.error?.message ?? `Proxy HTTP ${res.status}`);
            return j;
        }
    } catch (e: any) {
        if (!(e instanceof TypeError)) throw e;
    }

    // 2) Direct fallback for local dev
    const keyIdx = endpoint === '/api/groq2' ? 'makoti_groq_key_2' : 'makoti_groq_key';
    const key = localStorage.getItem(keyIdx) ?? '';
    if (!key) throw new Error('AI backend unavailable.');
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j) throw new Error(j?.error?.message ?? `Groq HTTP ${res.status}`);
    return j;
}

function parseAiPlan(j: any): AiPlan | null {
    let text: string = j?.choices?.[0]?.message?.content ?? '';
    text = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    try { return normalizePlan(JSON.parse(text.slice(start, end + 1))); }
    catch { return null; }
}

export async function requestAiPlan(
    stats: SymbolStats[],
    focus?: AiFocus,
    prevPlan?: string,
    logFn?: (msg: string) => void,
): Promise<AiPlan> {
    const focusLine = focus && focus !== 'auto'
        ? `\nHARD CONSTRAINT: contract_type MUST be one of ${FOCUS_TYPES[focus].join(' or ')} — pick the stronger of the two from the data.`
        : '';
    const prevLine = prevPlan
        ? `\nPREVIOUS PLAN: ${prevPlan}. If it lost more than it won, use a DIFFERENT archetype and/or market unless the fresh numbers overwhelmingly justify a repeat. Suggest a genuinely new idea when the data allows.`
        : '';
    const payload = {
        temperature: 0.4,
        max_tokens: 800,
        reasoning_effort: 'medium',
        messages: [
            { role: 'system', content: SYS_PROMPT },
            { role: 'user', content: buildUserPrompt(buildDigest(stats)) + focusLine + prevLine },
        ],
    };

    // ── Try dual call: both keys in parallel, compare results ──────────
    const [r1, r2] = await Promise.allSettled([
        callGroq({ ...payload, signal: undefined }, '/api/groq'),
        callGroq({ ...payload, signal: undefined }, '/api/groq2'),
    ]);

    const plan1 = r1.status === 'fulfilled' ? parseAiPlan(r1.value) : null;
    const plan2 = r2.status === 'fulfilled' ? parseAiPlan(r2.value) : null;

    if (plan1 && plan2) {
        // Both models responded — compare
        const agree = plan1.market === plan2.market
            && plan1.contract_type === plan2.contract_type
            && plan1.entry_trigger.digit === plan2.entry_trigger.digit;
        if (agree) {
            logFn?.(`Both models AGREE → ${plan1.market} ${plan1.contract_type} digit ${plan1.entry_trigger.digit} (dual-validated)`);
            // Merge: take higher confidence, combine rationale
            return {
                ...plan1,
                confidence: Math.min(95, Math.round((plan1.confidence + plan2.confidence) / 2) + 5),
                rationale: `[DUAL-VALIDATED] ${plan1.rationale} | Model2: ${plan2.rationale}`.slice(0, 400),
            };
        }
        logFn?.(`Models DISAGREE — primary: ${plan1.market}/${plan1.contract_type}/d${plan1.entry_trigger.digit}, secondary: ${plan2.market}/${plan2.contract_type}/d${plan2.entry_trigger.digit}. Using primary.`);
        return plan1;
    }

    // One or both failed — use whichever succeeded
    if (plan1) return plan1;
    if (plan2) {
        logFn?.('Primary key failed — using secondary model result.');
        return plan2;
    }

    // Both failed
    const err1 = r1.status === 'rejected' ? r1.reason?.message : 'parse error';
    const err2 = r2.status === 'rejected' ? r2.reason?.message : 'parse error';
    throw new Error(`Both AI models failed: key1=${err1}, key2=${err2}`);
}
