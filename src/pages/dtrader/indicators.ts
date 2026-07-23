export type IndicatorId = 'sma' | 'ema' | 'rsi' | 'macd' | 'bb' | 'stoch' | 'atr' | 'cci';

export interface IndicatorConfig {
  id: IndicatorId;
  label: string;
  params: Record<string, number>;
  color: string;
  pane: 'overlay' | 'below';
}

export const AVAILABLE_INDICATORS: IndicatorConfig[] = [
  { id: 'sma', label: 'SMA', params: { period: 14 }, color: '#ff9800', pane: 'overlay' },
  { id: 'ema', label: 'EMA', params: { period: 14 }, color: '#e91e63', pane: 'overlay' },
  { id: 'bb', label: 'Bollinger Bands', params: { period: 20, stddev: 2 }, color: '#9c27b0', pane: 'overlay' },
  { id: 'rsi', label: 'RSI', params: { period: 14 }, color: '#ffeb3b', pane: 'below' },
  { id: 'macd', label: 'MACD', params: { fast: 12, slow: 26, signal: 9 }, color: '#00bcd4', pane: 'below' },
  { id: 'stoch', label: 'Stochastic', params: { k: 14, d: 3 }, color: '#4caf50', pane: 'below' },
  { id: 'atr', label: 'ATR', params: { period: 14 }, color: '#ff5722', pane: 'below' },
  { id: 'cci', label: 'CCI', params: { period: 20 }, color: '#03a9f4', pane: 'below' },
];

export function calcSMA(data: number[], period: number): (number | null)[] {
  const r: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { r.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    r.push(sum / period);
  }
  return r;
}

export function calcEMA(data: number[], period: number): (number | null)[] {
  const r: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { r.push(null); continue; }
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += data[j];
      prev = sum / period;
      r.push(prev);
    } else {
      prev = data[i] * k + prev! * (1 - k);
      r.push(prev);
    }
  }
  return r;
}

export function calcRSI(data: number[], period: number): (number | null)[] {
  const r: (number | null)[] = [];
  if (data.length < 2) return data.map(() => null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = data[i] - data[i - 1];
    if (diff >= 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period; avgLoss /= period;
  r.push(null); // index 0
  for (let i = 1; i < period; i++) r.push(null);
  const firstRS = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  r.push(firstRS);
  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    r.push(rs);
  }
  return r;
}

export function calcMACD(data: number[], fast: number, slow: number, signal: number) {
  const emaFast = calcEMA(data, fast);
  const emaSlow = calcEMA(data, slow);
  const macdLine: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (emaFast[i] === null || emaSlow[i] === null) { macdLine.push(null); continue; }
    macdLine.push(emaFast[i]! - emaSlow[i]!);
  }
  const signalLine = calcEMA(macdLine.filter((v): v is number => v !== null), signal);
  let si = 0;
  const histogram: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (macdLine[i] === null) { histogram.push(null); continue; }
    const sig = signalLine[si++];
    histogram.push(sig === null ? null : macdLine[i]! - sig);
  }
  return { macdLine, signalLine: macdLine.map((_, i) => i >= data.length - signalLine.length ? signalLine[i - (data.length - signalLine.length)] ?? null : null), histogram };
}

export function calcBB(data: number[], period: number, stddev: number) {
  const sma = calcSMA(data, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (sma[i] === null) { upper.push(null); lower.push(null); continue; }
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += (data[j] - sma[i]!) ** 2;
    const sd = Math.sqrt(sumSq / period);
    upper.push(sma[i]! + stddev * sd);
    lower.push(sma[i]! - stddev * sd);
  }
  return { middle: sma, upper, lower };
}

export function calcStoch(dataHigh: number[], dataLow: number[], dataClose: number[], kPeriod: number, dPeriod: number) {
  const k: (number | null)[] = [];
  for (let i = 0; i < dataClose.length; i++) {
    if (i < kPeriod - 1) { k.push(null); continue; }
    let hh = -Infinity, ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      hh = Math.max(hh, dataHigh[j]); ll = Math.min(ll, dataLow[j]);
    }
    k.push(hh === ll ? 50 : ((dataClose[i] - ll) / (hh - ll)) * 100);
  }
  const d = calcSMA(k.filter((v): v is number => v !== null), dPeriod);
  let di = 0;
  const dFull: (number | null)[] = k.map(v => v === null ? null : d[di++] ?? null);
  return { k, d: dFull };
}

export function calcATR(candles: { high: number; low: number; close: number }[], period: number): (number | null)[] {
  const r: (number | null)[] = [];
  if (candles.length < 2) return candles.map(() => null);
  r.push(null);
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  for (let i = 1; i < candles.length; i++) {
    if (i < period) { r.push(null); continue; }
    if (i === period) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += tr[j];
      r.push(sum / period);
    } else {
      r.push((r[i - 1]! * (period - 1) + tr[i - 1]) / period);
    }
  }
  return r;
}

export function calcCCI(dataHigh: number[], dataLow: number[], dataClose: number[], period: number): (number | null)[] {
  const tp = dataClose.map((_, i) => (dataHigh[i] + dataLow[i] + dataClose[i]) / 3);
  const smaTP = calcSMA(tp, period);
  const r: (number | null)[] = [];
  for (let i = 0; i < tp.length; i++) {
    if (smaTP[i] === null) { r.push(null); continue; }
    let md = 0;
    for (let j = i - period + 1; j <= i; j++) md += Math.abs(tp[j] - smaTP[i]!);
    md /= period;
    r.push(md === 0 ? 0 : (tp[i] - smaTP[i]!) / (0.015 * md));
  }
  return r;
}
