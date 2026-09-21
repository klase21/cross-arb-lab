// Self-contained TA engine: RSI / MACD / Bollinger / EMA trend + confluence signal.
// Pure functions over Binance klines closes. No keys, no external calls.

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type TaBias = "LONG" | "SHORT" | "NEUTRAL";
export type TaStrength = "STRONG" | "WEAK" | "NONE";

export interface TaReason {
  code: string;
  value: number | null;
  bull: boolean;
}

export interface TaReading {
  symbol: string;
  price: number;
  change24h: number | null;
  rsi14: number | null;
  macdHist: number | null;
  macdHistPrev: number | null;
  bbUpper: number | null;
  bbMid: number | null;
  bbLower: number | null;
  bbPctB: number | null;
  ema20: number | null;
  ema60: number | null;
  bias: TaBias;
  strength: TaStrength;
  score: number;
  reasons: TaReason[];
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Wilder RSI(14). */
export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): { hist: (number | null)[]; macdLine: (number | null)[]; signalLine: (number | null)[] } {
  const fastE = ema(closes, fast);
  const slowE = ema(closes, slow);
  const line: (number | null)[] = closes.map((_, i) =>
    fastE[i] !== null && slowE[i] !== null ? (fastE[i] as number) - (slowE[i] as number) : null,
  );
  const validIdx = line.map((v, i) => (v === null ? -1 : i)).filter(i => i >= 0);
  const validVals = validIdx.map(i => line[i] as number);
  const sigValid = ema(validVals, signal);
  const signalLine: (number | null)[] = new Array(closes.length).fill(null);
  validIdx.forEach((orig, j) => { signalLine[orig] = sigValid[j]; });
  const hist = line.map((v, i) => (v !== null && signalLine[i] !== null ? v - (signalLine[i] as number) : null));
  return { hist, macdLine: line, signalLine };
}

export function bollinger(
  closes: number[],
  period = 20,
  mult = 2,
): { upper: (number | null)[]; mid: (number | null)[]; lower: (number | null)[] } {
  const mid = sma(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const m = mid[i];
    if (m === null) continue;
    const slice = closes.slice(i - period + 1, i + 1);
    const variance = slice.reduce((a, c) => a + (c - m) * (c - m), 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { upper, mid, lower };
}

function last<T>(arr: (T | null)[]): T | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null) return arr[i];
  return null;
}

function prev<T>(arr: (T | null)[]): T | null {
  let skipped = false;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] === null) continue;
    if (!skipped) { skipped = true; continue; }
    return arr[i];
  }
  return null;
}

export function analyze(symbol: string, candles: Candle[], change24h: number | null): TaReading {
  const closes = candles.map(c => c.c);
  const price = closes.length > 0 ? closes[closes.length - 1] : 0;
  const rsiArr = rsi(closes);
  const { hist } = macd(closes);
  const bb = bollinger(closes);
  const ema20 = ema(closes, 20);
  const ema60 = ema(closes, 60);

  const rsi14 = last(rsiArr);
  const macdHist = last(hist);
  const macdHistPrev = prev(hist);
  const bbUpper = last(bb.upper);
  const bbMid = last(bb.mid);
  const bbLower = last(bb.lower);
  const e20 = last(ema20);
  const e60 = last(ema60);

  let bbPctB: number | null = null;
  if (bbUpper !== null && bbLower !== null && bbUpper !== bbLower) {
    bbPctB = (price - bbLower) / (bbUpper - bbLower);
  }

  let score = 0;
  const reasons: TaReason[] = [];
  const push = (code: string, value: number | null, pts: number, bull: boolean) => {
    if (pts === 0) return;
    score += pts;
    reasons.push({ code, value, bull });
  };

  // RSI regime (max ±30)
  if (rsi14 !== null) {
    if (rsi14 < 30) push("rsi_oversold", rsi14, 30, true);
    else if (rsi14 < 40) push("rsi_weak", rsi14, 12, true);
    else if (rsi14 > 70) push("rsi_overbought", rsi14, -30, false);
    else if (rsi14 > 60) push("rsi_strong", rsi14, -12, false);
  }
  // MACD momentum (max ±30)
  if (macdHist !== null && macdHistPrev !== null) {
    if (macdHist > 0 && macdHist > macdHistPrev) push("macd_bull", macdHist, 20, true);
    else if (macdHist > 0) push("macd_bull_fade", macdHist, 8, true);
    else if (macdHist < macdHistPrev) push("macd_bear", macdHist, -20, false);
    else push("macd_bear_fade", macdHist, -8, false);
    if (macdHistPrev <= 0 && macdHist > 0) push("macd_golden", macdHist, 10, true);
    if (macdHistPrev >= 0 && macdHist < 0) push("macd_dead", macdHist, -10, false);
  }
  // Bollinger position (max ±20)
  if (bbPctB !== null) {
    if (bbPctB < 0) push("bb_break_low", bbPctB, 15, true);
    else if (bbPctB < 0.15) push("bb_low", bbPctB, 10, true);
    else if (bbPctB > 1) push("bb_break_high", bbPctB, -15, false);
    else if (bbPctB > 0.85) push("bb_high", bbPctB, -10, false);
  }
  // Trend filter (max ±20)
  if (e20 !== null && e60 !== null && e20 > 0 && e60 > 0) {
    if (price > e20 && e20 > e60) push("trend_up", e20, 20, true);
    else if (price < e20 && e20 < e60) push("trend_down", e20, -20, false);
    else if (price > e60) push("trend_mild_up", e60, 8, true);
    else push("trend_mild_down", e60, -8, false);
  }

  score = Math.max(-100, Math.min(100, Math.round(score)));
  const bias: TaBias = score >= 20 ? "LONG" : score <= -20 ? "SHORT" : "NEUTRAL";
  const strength: TaStrength = Math.abs(score) >= 50 ? "STRONG" : bias === "NEUTRAL" ? "NONE" : "WEAK";

  return {
    symbol, price, change24h, rsi14, macdHist, macdHistPrev,
    bbUpper, bbMid, bbLower, bbPctB, ema20: e20, ema60: e60,
    bias, strength, score, reasons,
  };
}
