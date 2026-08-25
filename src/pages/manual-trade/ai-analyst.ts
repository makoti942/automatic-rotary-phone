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
    };
}

const SYS_PROMPT =
    'You are an elite quant analyst for Deriv binary options on volatility indices. ' +
    'Every tick is an independent synthetic RNG draw (1 tick/sec). The final decimal digit of each price is uniformly distributed 0-9 long-term, but ' +
    'local clustering, streaks, and transition biases create exploitable micro-edges in 1000-tick windows.\n' +
    'DERIV CONTRACT RULES (exit tick decides win/loss):\n' +
    '- DIGITMATCH: win if exit digit == barrier (0-9). Highest payout ~9x.\n' +
    '- DIGITDIFF: win if exit digit != barrier (0-9). Payout ~1.9x.\n' +
    '- DIGITOVER: win if exit digit > barrier. barrier MUST be 0-8 (over 9 impossible). Payout ~2x.\n' +
    '- DIGITUNDER: win if exit digit < barrier. barrier MUST be 1-9 (under 0 impossible). Payout ~2x.\n' +
    '- DIGITEVEN / DIGITODD: win if parity matches. Payout ~2x.\n' +
    '- Duration: 1-5 ticks. Entry_trigger determines WHEN to place the trade (see entry types below).\n\n' +
    'ENTRY TRIGGER TYPES (prefer immediate or last_digit_equals — gap_reached is last resort):\n' +
    '- immediate: place trade right now. MOST RELIABLE — no timing risk.\n' +
    '- last_digit_equals: wait until the last tick digit matches the trigger digit, then place. GOOD — precise entry.\n' +
    '- gap_reached: wait until a digit\'s current drought reaches min_gap ticks. USE SPARINGLY — timing is unreliable.\n' +
    'CRITICAL: ALWAYS prefer "immediate" or "last_digit_equals". gap_reached is LAST RESORT ONLY. Timing-based entries are unreliable on RNG.\n\n' +
    'DATA LEGEND (for each market\'s rows):\n' +
    '- rows=[freq%, meanGap, medGap, p90Gap, curDrought, recentDrift]\n' +
    '- quarters=10x4: each digit\'s frequency in 4 chronological quarters (oldest->newest)\n' +
    '- tr=X>Y:pct: strongest transition pairs\n' +
    '- nX=t0,t1..t9: P(next digit = t | current = X). E.g. n5=12,11,10,9,8,13,11,10,8,8 means after digit 5, next=5 has 13% chance.\n' +
    '- n3X=t0,t1..t9: P(digit t appears within 3 ticks | current = X). Multi-step pattern detector.\n' +
    '- ent=entropyQ1..Q4: Shannon entropy per quarter. 3.32=perfectly uniform. Lower values = more predictable. Falling entropy trend = AI can exploit.\n' +
    '- st=digit x2:repeatAfterRun%: streak continuation rate\n\n' +
    'STRATEGY ARCHETYPES — rotate and NAME the one used (e.g. [drought-reversion]):\n' +
    '- [drought-reversion]: enter when curDrought exceeds p90Gap on a cold-ish digit (mean_gap biased toward that digit)\n' +
    '- [momentum-quarters]: follow digits trending UP across quarters Q1->Q4\n' +
    '- [transition-cluster]: exploit high X>Y transition pairs far above 10% baseline\n' +
    '- [streak-fade]: bet against repeats when streak repeat % is below 15%\n' +
    '- [parity-skew]: EVEN/ODD when skew > 2pp from 50%\n' +
    '- [entropy-collapse]: trade when entropy is falling across quarters (system becoming more predictable)\n' +
    '- [next3-pattern]: use n3X distributions to find digits that cluster in 3-tick windows\n\n' +
    'RULES:\n' +
    '- Baseline: every digit=10%, parity=50%, transitions=10% each. Edges must exceed noise (>1.5pp).\n' +
    '- If a PREVIOUS PLAN lost, pick a DIFFERENT archetype and/or market.\n' +
    '- Confidence must be honest (50-85 typical). Never claim certainty.\n' +
    '- Always pick the market with the strongest verified edge — top-scoring market is NOT always best.\n' +
    '- BREVITY: summary<=180 chars plain words; rationale<=260 chars; monitoring<=140; risk_notes<=120.\n' +
    '- Respond ONLY minified JSON per schema.';

/** Objective local pre-score so the AI only sees the strongest candidates. */
function scoreMarket(s: SymbolStats): number {
    const dev = Math.max(...s.digits.map(d => Math.abs(d.pct - 10)));
    const drought = Math.max(...s.digits.map(d => (d.mean_gap > 0 ? d.cur_gap / d.mean_gap : 0)));
    const trans = Math.max(0, ...s.transitions.map(t => t.pct - 10));
    const swing = Math.max(...s.digits.map(d => Math.abs(d.drift)));
    return Math.round((dev * 1.5 + Math.min(drought, 4) * 12 + trans * 2 + swing * 2) * 10) / 10;
}

function buildDigest(stats: SymbolStats[]): string {
    // Local comparison first: score every market, ship FULL detail for the
    // top 4 and one-liners for the rest. Keeps requests ~2.5k tokens so
    // repeated analyses never hit the free-tier token cap.
    const scored = stats.map(s => ({ s, score: scoreMarket(s) })).sort((a, b) => b.score - a.score);
    const full = scored.slice(0, 4).map(({ s, score }) => [
        s.symbol, score,
        s.digits.map(d => [d.pct, Math.round(d.mean_gap), Math.round(d.med_gap), Math.round(d.p90_gap), d.cur_gap, d.drift]),
        s.quarters.map(q => q),
        s.transitions.map(t => `${t.from}>${t.to}:${t.pct}`).join('|'),
        // Sequential patterns: after digit d, which next digits are above baseline?
        s.next_dist.map((row, d) => {
            const hot = row.map((v, t) => v > 12 ? `${t}:${v}` : '').filter(Boolean).join(',');
            return hot ? `n${d}=${hot}` : '';
        }).filter(Boolean).join('|'),
        // 3-step lookahead: digits that cluster within 3 ticks
        s.next_3_dist.map((row, d) => {
            const hot = row.map((v, t) => v > 20 ? `${t}:${v}` : '').filter(Boolean).join(',');
            return hot ? `n3${d}=${hot}` : '';
        }).filter(Boolean).join('|'),
        // Entropy trend: falling = more predictable = exploitable
        s.entropy_trend.join(','),
        s.streak_repeat_pct.map(x => `${x.digit}x2:${x.pct}`).join('|'),
        s.even_pct, s.hi_pct,
    ]);
    const rest = scored.slice(4).map(({ s, score }) => {
        let hot = 0, cold = 0;
        s.digits.forEach((d, i) => { if (d.pct > s.digits[hot].pct) hot = i; if (d.pct < s.digits[cold].pct) cold = i; });
        return `${s.symbol}(${score}) hot${hot}=${s.digits[hot].pct}% cold${cold}=${s.digits[cold].pct}% even=${s.even_pct}%`;
    });
    return JSON.stringify({
        L: 'rows=[freq%,meanGap,medGap,p90Gap,curDrought,recentDrift] quarters=10x4 freq% oldest->newest tr=X>Y:pct nX=d:pct=P(next=d|cur=X) for d>12% only n3X=d:pct=P(d in next3|cur=X) for d>20% only ent=entropyQ1..Q4 (3.32=uniform,falling=predictable) st=digit x2:repeatAfterRun% base=10%',
        TOP: full,
        REST: rest,
    });
}

function buildUserPrompt(digest: string): string {
    return (
        'Exact stats (last 1000 ticks). TOP = full detail for highest-scoring markets; REST = brief scan of the others:\n' + digest +
        '\n\nUse nX (1-step transition) and n3X (3-step lookahead) to find sequential patterns. ' +
        'Falling entropy = system becoming more predictable = stronger edge. ' +
        'Find every real pattern, cross-check them, commit to ONE best setup from ANY market (TOP or REST). ' +
        'ALWAYS prefer entry_trigger type "immediate" or "last_digit_equals" — timing-based gap entries are unreliable. ' +
        'Respond ONLY minified JSON: {"market":"sym","contract_type":"DIGITMATCH|DIGITDIFF|DIGITOVER|DIGITUNDER|DIGITEVEN|DIGITODD",' +
        '"barrier_digit":respect contract rules,"duration_ticks":1-5,' +
        '"entry_trigger":{"type":"gap_reached|last_digit_equals|immediate","digit":0-9,"min_gap":int 0-10},' +
        '"confidence":0-100,"summary":"plain-language plan","rationale":"[archetype] cite exact stats",' +
        '"monitoring":"exact watch steps","risk_notes":"when it fails"}'
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
        temperature: 0.15,
        max_tokens: 1000,
        reasoning_effort: 'low',
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
