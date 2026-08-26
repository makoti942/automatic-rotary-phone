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

const SYS_PROMPT =
    'You are an elite quant analyst specializing in Deriv synthetic market microstructure. ' +
    'You analyse tick-by-tick digit sequences to find exploitable statistical biases using advanced indicators.\n\n' +
    'DERIV DIGIT CONTRACTS (exit digit decides win/loss):\n' +
    '- DIGITMATCH: win if exit digit == barrier. Payout ~9x. Need >11.1% hit rate for profit.\n' +
    '- DIGITDIFF: win if exit digit != barrier. Payout ~1.9x. Need >52.6% hit rate.\n' +
    '- DIGITOVER: win if exit digit > barrier (barrier 0-8). Payout ~2x.\n' +
    '- DIGITUNDER: win if exit digit < barrier (barrier 1-9). Payout ~2x.\n' +
    '- DIGITEVEN/DIGITODD: win if parity matches. Payout ~2x.\n' +
    'Duration: 1-5 ticks.\n\n' +
    'ENTRY TRIGGER TYPES (always prefer immediate or last_digit_equals):\n' +
    '- immediate: place trade NOW. Most reliable — zero timing risk.\n' +
    '- last_digit_equals: wait for trigger digit to appear, then place. Good precision.\n' +
    '- gap_reached: wait for drought to reach min_gap. LAST RESORT ONLY.\n\n' +
    'DATA LEGEND (for each market):\n' +
    '- freq=[10]: digit frequency % (baseline 10%). gaps=[10]: mean gap between appearances.\n' +
    '- drought=[10]: ticks since last appearance. drift=[10]: recent frequency minus overall.\n' +
    '- trans=top X>Y transition pairs with percentages.\n' +
    '- Q=10x4 quarterly frequencies (oldest→newest). Reveals evolving digit behaviour.\n' +
    '- nX=d:pct: P(next=d|cur=X) for significant values only. 1-step Markov transitions.\n' +
    '- n3X=d:P(d in next 3|cur=X) for significant values only. Multi-step lookahead.\n' +
    '- ent=Q1..Q4 Shannon entropy. 3.32=uniform. Lower=falling=more predictable=exploitable.\n' +
    '- auto=lags1,2,3 autocorrelation. >0.1=momentum pattern, <-0.1=oscillation pattern.\n' +
    '- chi2=chi-squared vs uniform. >17 means statistically significant non-randomness.\n' +
    '- mom=momentum -100..+100. Positive=digits trending higher than average.\n' +
    '- ma=short MA minus long MA. Positive=recent digits higher than baseline.\n' +
    '- vc=volatility clustering. High=big digit swings cluster together.\n' +
    '- run=mean consecutive same-digit run length. Baseline ~1.0.\n' +
    '- pairs=top digit pairs X>Y with percentages. Exploit strong pair biases.\n' +
    '- even=parity% hi=digit>=5%\n\n' +
    'STRATEGY ARCHETYPES (name the one you use in rationale):\n' +
    '- [frequency-exploit]: DIGITMATCH on digit with freq>11% (expected value >99%)\n' +
    '- [anti-frequency]: DIGITDIFF on digit with freq<9% (expected value >101%)\n' +
    '- [reversion]: Bet on high-freq digit after long drought (overdue)\n' +
    '- [momentum]: Follow digit trending UP across quarters Q1→Q4\n' +
    '- [transition]: Exploit strong X→Y transition (>15% vs 10% baseline)\n' +
    '- [entropy-collapse]: Trade when entropy falling across quarters\n' +
    '- [pair-pattern]: Exploit frequent consecutive digit pairs\n' +
    '- [parity-skew]: EVEN/ODD when skew > 2pp from 50%\n' +
    '- [autocorr-exploit]: Use autocorrelation patterns (momentum or oscillation)\n' +
    '- [volatility-play]: Trade during high vol_cluster periods\n' +
    '- [chi2-exploit]: Trade when chi2 indicates strong non-randomness\n\n' +
    'RULES:\n' +
    '- Every edge must exceed noise (>1.5pp from baseline 10% or 50%).\n' +
    '- If PREVIOUS PLAN lost, use a DIFFERENT archetype and/or market.\n' +
    '- Pick the market with the strongest VERIFIED edge from the data — not just highest score.\n' +
    '- Cross-check: confirm your pick using at least 2 independent indicators (freq, transitions, entropy, autocorr, pairs).\n' +
    '- ALWAYS prefer entry type "immediate" or "last_digit_equals". Only use "gap_reached" when drought data is exceptionally strong.\n' +
    '- Confidence: 50-85 typical. Never claim certainty.\n' +
    '- BREVITY: summary<=180 chars; rationale<=260 chars; monitoring<=140; risk_notes<=120.\n' +
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
    // Score every market and ship compressed data for ALL 10 so the AI
    // can pick the genuine best opportunity. ~3k tokens total.
    const scored = stats.map(s => ({ s, score: scoreMarket(s) })).sort((a, b) => b.score - a.score);
    return JSON.stringify({
        L: 'freq,gaps,drought,drift=per-digit arrays(0-9). trans=top pairs. Q=quarterly. nX/n3X=Markov. ent=entropy. auto=autocorr. chi2=randomness. mom=momentum. ma=MA cross. vc=vol cluster. run=run length. pairs=top pairs.',
        M: scored.map(({ s, score }) => ({
            sym: s.symbol, score,
            freq: s.digits.map(d => d.pct),
            gaps: s.digits.map(d => Math.round(d.mean_gap)),
            drought: s.digits.map(d => d.cur_gap),
            drift: s.digits.map(d => d.drift),
            trans: s.transitions.slice(0, 5).map(t => `${t.from}>${t.to}:${t.pct}`).join('|'),
            Q: s.quarters,
            nX: s.next_dist.map((row, d) => {
                const hot = row.map((v, t) => v > 12 ? `${t}:${v}` : '').filter(Boolean).join(',');
                return hot ? `${d}=${hot}` : '';
            }).filter(Boolean).join('|'),
            n3X: s.next_3_dist.map((row, d) => {
                const hot = row.map((v, t) => v > 20 ? `${t}:${v}` : '').filter(Boolean).join(',');
                return hot ? `${d}=${hot}` : '';
            }).filter(Boolean).join('|'),
            ent: s.entropy_trend,
            auto: s.autocorr,
            chi2: s.chi2,
            mom: s.momentum,
            ma: s.ma_signal,
            vc: s.vol_cluster,
            run: s.run_mean,
            pairs: s.top_pairs.map(p => `${p.from}>${p.to}:${p.pct}`).join('|'),
            even: s.even_pct,
            hi: s.hi_pct,
        })),
    });
}

function buildUserPrompt(digest: string): string {
    return (
        'Exact statistics from last 1000 ticks across all 10 markets (sorted by local edge score):\n' + digest +
        '\n\nAnalyse ALL 10 markets. Use multiple indicators to confirm your pick:\n' +
        '- freq vs 10% baseline for expected-value calculation\n' +
        '- nX (1-step Markov) + n3X (3-step lookahead) for sequential patterns\n' +
        '- ent (entropy trend): falling = stronger exploitable edge\n' +
        '- auto (autocorrelation): positive = momentum, negative = oscillation\n' +
        '- chi2: >17 means statistically significant non-randomness\n' +
        '- pairs: exploit frequent consecutive digit pairs\n' +
        '- mom (momentum) + ma (MA cross): directional bias\n' +
        '- vc (vol cluster): high = bigger swings cluster together\n' +
        'Commit to ONE best setup from ANY market. Cross-check with at least 2 indicators.\n' +
        'Prefer "immediate" or "last_digit_equals" entry. Only use "gap_reached" if drought data is exceptionally strong.\n' +
        'Think step-by-step before deciding. Consider multiple strategies then pick the highest expected value.\n' +
        'Respond ONLY minified JSON: {"market":"sym","contract_type":"DIGITMATCH|DIGITDIFF|DIGITOVER|DIGITUNDER|DIGITEVEN|DIGITODD",' +
        '"barrier_digit":respect contract rules,"duration_ticks":1-5,' +
        '"entry_trigger":{"type":"immediate|last_digit_equals|gap_reached","digit":0-9,"min_gap":int 0-10},' +
        '"confidence":0-100,"summary":"<180 chars","rationale":"[archetype] cite exact stats and indicators used",' +
        '"monitoring":"<140 chars","risk_notes":"<120 chars"}'
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
    const type = tTypes.includes(trig.type) ? trig.type : 'immediate';
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
async function callGroq(payload: any): Promise<any> {
    // 1) Serverless proxy (production)
    try {
        const res = await fetch('/api/groq', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const text = await res.text();
        let j: any;
        try { j = JSON.parse(text); } catch (_) {
            // Static-only deploy rewrites /api/groq to index.html → no proxy
            j = null;
        }
        if (j) {
            if (!res.ok || j?.error) throw new Error(j?.error?.message ?? `Proxy HTTP ${res.status}`);
            return j;
        }
    } catch (e: any) {
        if (!(e instanceof TypeError)) throw e; // network failure → try fallback
    }

    // 2) Direct fallback for local dev (key stashed by developer, no UI field)
    const key = localStorage.getItem('makoti_groq_key') ?? '';
    if (!key) {
        throw new Error('AI backend unavailable. On Vercel: add GROQ_API_KEY env var and redeploy.');
    }
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j) throw new Error(j?.error?.message ?? `Groq HTTP ${res.status}`);
    return j;
}

export async function requestAiPlan(stats: SymbolStats[], focus?: AiFocus, prevPlan?: string): Promise<AiPlan> {
    // model + reasoning_effort are chosen server-side (api/groq.js) so
    // deprecations never break the client. Compact digest ≈ 2.5k tokens.
    const focusLine = focus && focus !== 'auto'
        ? `\nHARD CONSTRAINT: contract_type MUST be one of ${FOCUS_TYPES[focus].join(' or ')} — pick the stronger of the two from the data.`
        : '';
    const prevLine = prevPlan
        ? `\nPREVIOUS PLAN: ${prevPlan}. If it lost more than it won, use a DIFFERENT archetype and/or market unless the fresh numbers overwhelmingly justify a repeat. Suggest a genuinely new idea when the data allows.`
        : '';
    const payload = {
        temperature: 0.4,
        max_tokens: 1500,
        reasoning_effort: 'medium',
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: SYS_PROMPT },
            { role: 'user', content: buildUserPrompt(buildDigest(stats)) + focusLine + prevLine },
        ],
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
        const j = await callGroq({ ...payload, signal: undefined });
        let text: string = j?.choices?.[0]?.message?.content ?? '';
        text = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1) throw new Error('AI returned no JSON plan.');
        return normalizePlan(JSON.parse(text.slice(start, end + 1)));
    } finally {
        clearTimeout(timer);
    }
}
