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
    streak_repeat_pct: { digit: number; pct: number }[];      // P(repeat | current run of that digit >= 2)
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

    return {
        symbol,
        total_ticks: n,
        digits: digitStats,
        quarters,
        transitions: transitions.slice(0, 8),
        streak_repeat_pct: streak_repeat_pct.sort((a, b) => b.pct - a.pct).slice(0, 4),
        even_pct: r1((evenCount / n) * 100),
        hi_pct: r1((hiCount / n) * 100),
    };
}

const SYS_PROMPT =
    'Elite quant analyst for Deriv volatility indices (synthetic RNG, 1 tick/sec, final decimal digit 0-9). ' +
    'You get EXACT stats over the last 1000 ticks of 10 markets. Baseline: every digit=10%, parity=50%. ' +
    'Read quarters as trajectory: rising digit = gaining momentum (check tr to see which digits it displaces); ' +
    'falling = fading even if total is high. Hunt every trick: hot/cold extremes AND their direction; droughts ' +
    '(curDrought far beyond p90Gap = overdue); transition clustering (X>Y far above 10% — cite %); streak repeats ' +
    'vs ~9% random expectation; parity/hi-lo skews and whether recent quarters strengthen them. Cross-check metrics; ' +
    'reject noise-level edges. Commit to ONE market + ONE contract + precise trigger + duration 1-5 justified by numbers. ' +
    'confidence must be honest. rationale cites exact percentages. Respond ONLY minified JSON per schema.';

function buildDigest(stats: SymbolStats[]): string {
    // Dense numeric encoding — free-tier Groq allows only ~8k tokens/min,
    // so every market is packed into flat arrays with one legend line.
    const markets = stats.map(s => [
        s.symbol,
        s.digits.map(d => [d.pct, Math.round(d.mean_gap), Math.round(d.med_gap), Math.round(d.p90_gap), d.cur_gap, d.drift]),
        s.quarters.map(q => q),
        s.transitions.map(t => `${t.from}>${t.to}:${t.pct}`).join('|'),
        s.streak_repeat_pct.map(x => `${x.digit}x2:${x.pct}`).join('|'),
        s.even_pct,
        s.hi_pct,
    ]);
    return JSON.stringify({
        L: 'per symbol: [digitRows(0..9): [freq%,meanGap,medGap,p90Gap,curDrought,recentDrift]], quarters[10x4]=freq% per digit across window oldest->newest, tr=strongest X>Y:nextPct%, st=digit x2:repeatAfterRun%, base=10% parity~50%',
        M: markets,
    });
}

function buildUserPrompt(digest: string): string {
    return (
        'Exact stats (last 1000 ticks, 10 markets):\n' + digest +
        '\n\nFind every real pattern/trick, cross-check them, commit to ONE best setup. ' +
        'Respond ONLY minified JSON: {"market":"sym","contract_type":"DIGITMATCH|DIGITDIFF|DIGITOVER|DIGITUNDER|DIGITEVEN|DIGITODD",' +
        '"barrier_digit":0-9|null,"duration_ticks":1-5,' +
        '"entry_trigger":{"type":"gap_reached|last_digit_equals|immediate","digit":0-9,"min_gap":int>=0},' +
        '"confidence":0-100,"rationale":"cite exact stats","monitoring":"exact watch steps","risk_notes":"when it fails"}'
    );
}

export function normalizePlan(raw: any): AiPlan {
    const market = VOLATILITY_LIST.includes(raw?.market)
        ? raw.market
        : VOLATILITY_LIST[0];
    const TYPES: AiContractType[] = ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD'];
    const contract_type: AiContractType = TYPES.includes(raw?.contract_type) ? raw.contract_type : 'DIGITDIFF';
    const needsBarrier = contract_type !== 'DIGITEVEN' && contract_type !== 'DIGITODD';
    let barrier = Number(raw?.barrier_digit);
    const barrier_digit = needsBarrier
        ? (Number.isFinite(barrier) ? Math.min(9, Math.max(0, Math.round(barrier))) : 5)
        : null;
    const duration_ticks = Math.min(5, Math.max(1, Math.round(Number(raw?.duration_ticks)) || 1));
    const tTypes = ['gap_reached', 'last_digit_equals', 'immediate'];
    const trig = raw?.entry_trigger ?? {};
    const digit = Math.min(9, Math.max(0, Math.round(Number(trig.digit)) || 0));
    const min_gap = Math.max(0, Math.round(Number(trig.min_gap)) || 0);
    const type = tTypes.includes(trig.type) ? trig.type : 'immediate';
    return {
        market,
        contract_type,
        barrier_digit,
        duration_ticks,
        entry_trigger: { type, digit, min_gap },
        confidence: Math.min(100, Math.max(0, Math.round(Number(raw?.confidence)) || 0)),
        rationale: String(raw?.rationale ?? '').slice(0, 1200),
        monitoring: String(raw?.monitoring ?? '').slice(0, 800),
        risk_notes: String(raw?.risk_notes ?? '').slice(0, 800),
    };
}

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

export async function requestAiPlan(stats: SymbolStats[]): Promise<AiPlan> {
    // model + reasoning_effort are chosen server-side (api/groq.js) so
    // deprecations never break the client. Token budget sized for the free
    // tier's 8k TPM cap: compressed digest + prompt ≈ 4.5k, completion ≤ 1k.
    const payload = {
        temperature: 0.15,
        max_tokens: 1000,
        reasoning_effort: 'low',
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: SYS_PROMPT },
            { role: 'user', content: buildUserPrompt(buildDigest(stats)) },
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
