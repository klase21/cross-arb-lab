// Binance Square signal extraction (rule-based MVP) + ROI / Trust Score.
// Mirrors the SquareRadar pipeline in simplified form:
// scrape (route) -> filter/extract (here) -> classify market -> replay/track (route) -> score (here).
// No AI: strict entry/TP/SL posts => high confidence, zone+targets => medium, bare bias => low.
// Trader metrics aggregate high+medium only; low-confidence bias calls are shown but unscored.

export type SquareSide = "LONG" | "SHORT";
export type SquareMarket = "SPOT" | "FUTURES";
export type SquareConfidence = "high" | "medium" | "low";
export type SquareStatus = "OPEN" | "LIVE" | "CLOSED_WIN" | "CLOSED_LOSS";

export interface SquareSignal {
  id: string;
  source: "square" | "tv";
  postId: string;
  author: string;
  authorVerified: boolean;
  asset: string;
  symbol: string;
  side: SquareSide;
  market: SquareMarket;
  confidence: SquareConfidence;
  entry: number | null;
  target: number | null;
  stop: number | null;
  leverage: number | null;
  postMs: number;
  postPrice: number | null;
  curPrice: number | null;
  roiPct: number | null;
  status: SquareStatus;
  closeReason: string | null;
  views: number;
  likes: number;
  snippet: string;
  url: string;
  ai?: boolean;
}

export interface SquareTrader {
  author: string;
  verified: boolean;
  calls: number;
  wins: number;
  losses: number;
  winRate: number;
  avgRoi: number;
  trustScore: number;
  withStopPct: number;
}

export interface RawSquarePost {
  id: string;
  author: string;
  verified: boolean;
  title: string;
  content: string;
  coinPairs: string[];
  hashtags: string[];
  quoteSymbols: string[];
  views: number;
  likes: number;
  dateMs: number;
  url: string;
}

const STABLES = new Set(["USDT", "USDC", "FDUSD", "TUSD", "USDP", "DAI", "BTC", "ETH"]);

function cleanNum(raw: string): number | null {
  const n = Number.parseFloat(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------- asset ---

export function detectAsset(
  text: string,
  coinPairs: string[],
  hashtags: string[],
  quoteSymbols: string[],
  spotBases: Set<string>,
): string | null {
  const candidates: string[] = [];
  for (const p of coinPairs) {
    const m = p.replace(/^\$/, "").trim().toUpperCase();
    if (/^[A-Z0-9]{2,12}$/.test(m)) candidates.push(m);
  }
  for (const h of hashtags) {
    const m = h.toUpperCase();
    if (/^[A-Z0-9]{2,12}$/.test(m)) candidates.push(m);
  }
  const inline = text.match(/\$([A-Za-z0-9]{2,12})\b/g) ?? [];
  for (const hit of inline) candidates.push(hit.slice(1).toUpperCase());
  for (const q of quoteSymbols) {
    const m = q.toUpperCase();
    if (/^[A-Z0-9]{2,12}$/.test(m)) candidates.push(m);
  }
  for (const c of candidates) {
    if (c === "USDT" || c === "USD") continue;
    if (spotBases.has(c)) return c;
  }
  return null;
}

// ----------------------------------------------------------------- side ---

const LONG_WORDS = ["long", "buy", "bullish", "bull", "pump", "moon", "breakout", "rebound", "reclaim", "support bounce"];
const SHORT_WORDS = ["short", "sell", "bearish", "bear", "dump", "crash", "breakdown", "rejection", "resistance reject", "squeeze trap"];
const LONG_KO = ["롱", "매수", "매수세", "상승", "상방", "반등", "돌파", "강세", "불장"];
const SHORT_KO = ["숏", "매도", "매도세", "하락", "하방", "폭락", "급락", "약세", "베어", "조정"];

function countHits(text: string, words: string[]): number {
  let n = 0;
  for (const w of words) {
    const re = /[a-z]/.test(w[0]) ? new RegExp(`\\b${w}\\b`, "gi") : new RegExp(w, "g");
    const m = text.match(re);
    if (m) n += m.length;
  }
  return n;
}

export function detectSide(text: string): SquareSide | null {
  const lower = text.toLowerCase();
  // Inversions: "long squeeze" is bearish, "short squeeze" is bullish.
  const longSqueeze = (lower.match(/longs?\s+squeeze/g) ?? []).length;
  const shortSqueeze = (lower.match(/shorts?\s+squeeze/g) ?? []).length;
  let longScore = countHits(text, LONG_WORDS) + countHits(text, LONG_KO) + shortSqueeze * 2;
  let shortScore = countHits(text, SHORT_WORDS) + countHits(text, SHORT_KO) + longSqueeze * 2;
  // "trapped longs / late longs" language is bearish.
  if (/late longs|trapped longs|longs (get|getting) trapped/i.test(text)) shortScore += 2;
  if (/trapped shorts|late shorts/i.test(text)) longScore += 2;
  if (longScore === 0 && shortScore === 0) return null;
  if (longScore === shortScore) return null;
  return longScore > shortScore ? "LONG" : "SHORT";
}

// ---------------------------------------------------------------- levels ---

export function extractLevels(text: string): { entry: number | null; target: number | null; stop: number | null; leverage: number | null } {
  let entry: number | null = null;
  let target: number | null = null;
  let stop: number | null = null;
  let leverage: number | null = null;

  const entryRes = [
    /(?:entry|entries|entered|buy\s*(?:at|around|zone)?|long\s*(?:at|around)?|short\s*(?:at|around)?|진입(?:가)?|매수가?)\s*[:\-]?\s*\$?\s*([\d,]+\.?\d*)/i,
    /@\s*\$?\s*([\d,]+\.?\d*)/,
  ];
  for (const re of entryRes) {
    const m = text.match(re);
    if (m) { entry = cleanNum(m[1]); if (entry !== null) break; }
  }
  if (entry === null) {
    // Soft zone phrasing: "reacting from the $96–$99 zone", "trading around $112" (midpoint for ranges).
    const zoneM = text.match(/(?:zone|수요|지지|저항|박스권)\s*\$?\s*([\d,]+\.?\d*)\s*[–\-~]\s*\$?\s*([\d,]+\.?\d*)/i)
      ?? text.match(/(?:around|near|nearby|근처|약)\s*\$?\s*([\d,]+\.?\d*)/i);
    if (zoneM) {
      const a = cleanNum(zoneM[1]);
      const b = zoneM[2] !== undefined ? cleanNum(zoneM[2]) : null;
      entry = a !== null && b !== null ? (a + b) / 2 : a;
    }
  }

  const tpRe = /(?:tp\s?\d?|take[\s-]?profit\d?|targets?\s?\d?|목표가|익절가?|익절)\s*[:\-]?\s*\$?\s*([\d,]+\.?\d*)/i;
  const tpM = text.match(tpRe);
  if (tpM) target = cleanNum(tpM[1]);
  if (target === null) {
    // Bare arrow chains: "$0.80 → $0.74 → $0.68" — first chained price is the implied target.
    const chain = text.match(/→\s*\$?\s*([\d,]+\.?\d*)\s*(?:→|$)/);
    if (chain) target = cleanNum(chain[1]);
  }

  const slRe = /(?:stop[\s-]?loss|stop\b|sl\b|손절(?:가)?|스탑로스)\s*[:\-]?\s*\$?\s*([\d,]+\.?\d*)/i;
  const slM = text.match(slRe);
  if (slM) stop = cleanNum(slM[1]);

  const levRe = /(\d{1,3})\s*x\b|(?:leverage|레버리지)\s*[:\-]?\s*(\d{1,3})\s*(?:x|배)?/i;
  const levM = text.match(levRe);
  if (levM) {
    const v = Number.parseInt(levM[1] ?? levM[2] ?? "", 10);
    if (Number.isFinite(v) && v >= 1 && v <= 200) leverage = v;
  }
  return { entry, target, stop, leverage };
}

export function classifyMarket(text: string, leverage: number | null): SquareMarket {
  if (leverage !== null) return "FUTURES";
  if (/(futures|perp|perpetual|선물|퓨처|숏|롱\s*\d+\s*x)/i.test(text)) {
    // Bare 숏/롱 alone does not prove futures; require explicit futures context or leverage.
    if (/(futures|perp|perpetual|선물|퓨처)/i.test(text)) return "FUTURES";
  }
  return "SPOT";
}

export function gradeConfidence(entry: number | null, target: number | null, stop: number | null): SquareConfidence {
  if (entry !== null && (target !== null || stop !== null)) return "high";
  if (target !== null && stop !== null) return "high";
  if (target !== null || stop !== null || entry !== null) return "medium";
  return "low";
}

// --------------------------------------------------------------- scoring ---

export function priceRoiPct(side: SquareSide, entry: number, price: number): number {
  if (!(entry > 0) || !(price > 0)) return 0;
  return side === "LONG" ? ((price - entry) / entry) * 100 : ((entry - price) / entry) * 100;
}

/** 0-100 Trust Score: win quality 50 / return 30 / SL discipline 10 / sample 10, dampened below 5 calls. */
export function trustScore(calls: number, wins: number, losses: number, avgRoi: number, withStopPct: number): number {
  const closed = wins + losses;
  const winRate = closed > 0 ? (wins / closed) * 100 : 0;
  const roiPart = Math.max(-30, Math.min(30, avgRoi)) + 30; // 0..60
  const raw = winRate * 0.5 + roiPart * 0.5 + withStopPct * 0.1 + Math.min(calls, 10);
  const dampen = Math.min(1, 0.4 + (calls / 5) * 0.6);
  return Math.round(Math.max(0, Math.min(100, raw * dampen)));
}

export function aggregateTraders(signals: SquareSignal[]): SquareTrader[] {
  const byAuthor = new Map<string, { signals: SquareSignal[]; verified: boolean }>();
  for (const s of signals) {
    if (s.confidence === "low") continue;
    const g = byAuthor.get(s.author) ?? { signals: [], verified: false };
    g.signals.push(s);
    g.verified = g.verified || s.authorVerified;
    byAuthor.set(s.author, g);
  }
  const out: SquareTrader[] = [];
  for (const [author, g] of byAuthor) {
    const closed = g.signals.filter(s => s.status === "CLOSED_WIN" || s.status === "CLOSED_LOSS");
    const wins = closed.filter(s => s.status === "CLOSED_WIN").length;
    const losses = closed.length - wins;
    const rois = g.signals.map(s => s.roiPct).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const avgRoi = rois.length > 0 ? rois.reduce((a, b) => a + b, 0) / rois.length : 0;
    const withStop = g.signals.filter(s => s.stop !== null).length;
    const withStopPct = g.signals.length > 0 ? (withStop / g.signals.length) * 100 : 0;
    out.push({
      author,
      verified: g.verified,
      calls: g.signals.length,
      wins,
      losses,
      winRate: closed.length > 0 ? (wins / closed.length) * 100 : 0,
      avgRoi,
      trustScore: trustScore(g.signals.length, wins, losses, avgRoi, withStopPct),
      withStopPct,
    });
  }
  return out.sort((a, b) => b.trustScore - a.trustScore || b.calls - a.calls);
}

export { STABLES };
