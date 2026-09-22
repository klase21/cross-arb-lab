import { NextResponse } from "next/server";
import {
  aggregateTraders,
  classifyMarket,
  detectAsset,
  detectSide,
  extractLevels,
  gradeConfidence,
  priceRoiPct,
  type RawSquarePost,
  type SquareSignal,
  type SquareStatus,
} from "@/lib/square";
import { BINANCE_BAPI, BINANCE_SPOT } from "@/lib/binance";
import { replay, type Kline } from "@/lib/signal-track";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; data: unknown } | null = null;

const BROWSER_HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  referer: "https://www.binance.com/en/square/trending",
};

const SQUARE_LIST = `${BINANCE_BAPI}/bapi/composite/v3/friendly/pgc/content/article/list`;
const BINANCE_SPOT_PRICE = `${BINANCE_SPOT}/api/v3/ticker/price`;
const BINANCE_KLINES = `${BINANCE_SPOT}/api/v3/klines`;

interface SquareVo {
  id?: number | string;
  authorName?: string;
  authorIsVerified?: boolean;
  title?: string | null;
  content?: string | null;
  coinPairList?: string[] | null;
  hashtagList?: string[] | null;
  tradingPairsV2?: { symbol?: string }[] | null;
  viewCount?: number;
  likeCount?: number;
  date?: number;
  webLink?: string;
}

function toMs(date?: number): number {
  if (!date) return Date.now();
  return date < 1_000_000_000_000 ? date * 1000 : date;
}

function parseVo(v: SquareVo): RawSquarePost {
  return {
    id: String(v.id ?? ""),
    author: v.authorName ?? "unknown",
    verified: v.authorIsVerified === true,
    title: v.title ?? "",
    content: v.content ?? "",
    coinPairs: Array.isArray(v.coinPairList) ? v.coinPairList : [],
    hashtags: Array.isArray(v.hashtagList) ? v.hashtagList : [],
    quoteSymbols: Array.isArray(v.tradingPairsV2)
      ? v.tradingPairsV2.map(t => (t.symbol ?? "").replace(/USDT$/i, "")).filter(Boolean)
      : [],
    views: v.viewCount ?? 0,
    likes: v.likeCount ?? 0,
    dateMs: toMs(v.date),
    url: v.webLink ?? (v.id ? `https://www.binance.com/en/square/post/${v.id}` : "https://www.binance.com/en/square"),
  };
}

async function fetchSquarePage(pageIndex: number): Promise<RawSquarePost[]> {
  const res = await fetch(`${SQUARE_LIST}?pageIndex=${pageIndex}&pageSize=20&type=1`, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { data?: { vos?: SquareVo[] } };
  const vos = data.data?.vos ?? [];
  return vos.map(parseVo).filter(p => p.id);
}

async function fetchKlines(symbol: string, startMs: number): Promise<Kline[]> {
  const url = `${BINANCE_KLINES}?symbol=${symbol}&interval=15m&startTime=${startMs}&limit=200`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const data = (await res.json()) as Kline[];
  return Array.isArray(data) ? data : [];
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.data, { headers: { "Cache-Control": "public, max-age=60" } });
  }

  const pages = await Promise.all([fetchSquarePage(1), fetchSquarePage(2), fetchSquarePage(3)]);
  const seen = new Map<string, RawSquarePost>();
  for (const p of pages.flat()) if (!seen.has(p.id)) seen.set(p.id, p);
  const posts = Array.from(seen.values());

  const priceMap = new Map<string, number>();
  try {
    const res = await fetch(BINANCE_SPOT_PRICE, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const list = (await res.json()) as { symbol: string; price: string }[];
      for (const row of list) priceMap.set(row.symbol, Number.parseFloat(row.price));
    }
  } catch { /* keep empty */ }

  const spotBases = new Set<string>();
  for (const sym of priceMap.keys()) {
    if (sym.endsWith("USDT")) spotBases.add(sym.slice(0, -4));
  }

  // Extract candidate signals (filter stage: needs asset + side).
  const candidates: (Omit<SquareSignal, "postPrice" | "curPrice" | "roiPct" | "status" | "closeReason"> & { postMs: number })[] = [];
  for (const post of posts) {
    const text = `${post.title}\n${post.content}`;
    if (text.trim().length < 10) continue;
    const asset = detectAsset(text, post.coinPairs, post.hashtags, post.quoteSymbols, spotBases);
    if (!asset) continue;
    const side = detectSide(text);
    if (!side) continue;
    const { entry, target, stop, leverage } = extractLevels(text);
    const market = classifyMarket(text, leverage);
    const confidence = gradeConfidence(entry, target, stop);
    const snippet = text.replace(/\s+/g, " ").slice(0, 220);
    candidates.push({
      id: `${post.id}:${asset}:${side}`,
      source: "square",
      postId: post.id,
      author: post.author,
      authorVerified: post.verified,
      asset,
      symbol: `${asset}USDT`,
      side,
      market,
      confidence,
      entry,
      target,
      stop,
      leverage,
      postMs: post.dateMs,
      views: post.views,
      likes: post.likes,
      snippet,
      url: post.url,
    });
  }

  // Optional LLM refinement: upgrades low/medium rule hits when SQUARE_LLM_KEY is set.
  // Rule-based results always stand alone when the key is absent or the call fails.
  if (process.env.SQUARE_LLM_KEY) {
    try {
      const { refineWithLlm } = await import("@/lib/square-ai");
      const textByPost = new Map(posts.map(p => [p.id, `${p.title}\n${p.content}`]));
      const targets = candidates
        .filter(c => c.confidence !== "high")
        .sort((a, b) => b.views - a.views)
        .slice(0, 10);
      const aiResults = await refineWithLlm(
        targets.map(c => ({ id: c.id, text: textByPost.get(c.postId) ?? c.snippet })),
      );
      for (const c of targets) {
        const ai = aiResults.get(c.id);
        if (!ai || !ai.side) continue;
        const asset = ai.asset && spotBases.has(ai.asset) ? ai.asset : c.asset;
        c.asset = asset;
        c.symbol = `${asset}USDT`;
        c.side = ai.side;
        if (ai.entry !== null) c.entry = ai.entry;
        if (ai.target !== null) c.target = ai.target;
        if (ai.stop !== null) c.stop = ai.stop;
        if (ai.leverage !== null) c.leverage = ai.leverage;
        if (ai.market !== null) c.market = ai.market;
        const upgraded = gradeConfidence(c.entry, c.target, c.stop);
        c.confidence = upgraded === "low" ? "medium" : upgraded;
        c.id = `${c.postId}:${c.asset}:${c.side}`;
        c.ai = true;
      }
    } catch { /* keep rule-based results */ }
  }

  // Kline replay grouped by symbol: fetch for every candidate symbol (cap 25)
  // so bias calls also get postPrice/ROI; TP/SL simulation stays high/medium-only.
  const priceCands = candidates.filter(c => priceMap.has(c.symbol)).sort((a, b) => b.views - a.views);
  const symbols: string[] = [];
  const minPostBySymbol = new Map<string, number>();
  for (const c of priceCands) {
    if (!symbols.includes(c.symbol) && symbols.length < 25) symbols.push(c.symbol);
    if (symbols.includes(c.symbol)) {
      minPostBySymbol.set(c.symbol, Math.min(minPostBySymbol.get(c.symbol) ?? c.postMs, c.postMs));
    }
  }
  const klineMap = new Map<string, Kline[]>();
  const BATCH = 5;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async s => {
        try {
          return await fetchKlines(s, (minPostBySymbol.get(s) ?? now) - 3600000);
        } catch {
          return [] as Kline[];
        }
      }),
    );
    batch.forEach((s, idx) => klineMap.set(s, results[idx]));
  }

  const signals: SquareSignal[] = candidates.map(c => {
    const curPrice = priceMap.get(c.symbol) ?? null;
    const klines = klineMap.get(c.symbol) ?? [];
    let postPrice: number | null = null;
    for (const k of klines) {
      if (k[0] >= c.postMs - 900000) { postPrice = Number.parseFloat(k[1]) || null; break; }
    }
    let entry = c.entry;
    let target = c.target;
    let stop = c.stop;
    const ref = postPrice ?? curPrice;
    if (ref !== null && ref > 0) {
      // Drop garbage levels: entry must sit near the market, TP/SL in sane bands with right side.
      if (entry !== null && Math.abs(entry - ref) / ref > 0.5) entry = null;
      const basis = entry ?? ref;
      if (target !== null) {
        const ratio = target / basis;
        if (ratio > 5 || ratio < 0.2) target = null;
        else if (c.side === "LONG" && target <= basis) target = null;
        else if (c.side === "SHORT" && target >= basis) target = null;
      }
      if (stop !== null) {
        const ratio = stop / basis;
        if (ratio > 5 || ratio < 0.2) stop = null;
        else if (c.side === "LONG" && stop >= basis) stop = null;
        else if (c.side === "SHORT" && stop <= basis) stop = null;
      }
    }
    const confidence = gradeConfidence(entry, target, stop);
    const basis = entry ?? postPrice;
    let status: SquareStatus = "OPEN";
    let closeReason: string | null = null;
    if (basis !== null && klines.length > 0 && confidence !== "low") {
      ({ status, closeReason } = replay(c.side, basis, target, stop, klines, c.postMs));
    } else if (basis !== null && curPrice !== null) {
      status = "LIVE";
    }
    let roiPct: number | null = null;
    if (basis !== null && curPrice !== null && basis > 0) {
      roiPct = priceRoiPct(c.side, basis, curPrice);
      if (c.market === "FUTURES" && c.leverage !== null) roiPct = roiPct * c.leverage;
    }
    return { ...c, entry, target, stop, confidence, postPrice, curPrice, roiPct, status, closeReason };
  });

  signals.sort((a, b) => b.views - a.views);

  const traders = aggregateTraders(signals);
  const payload = {
    postsScanned: posts.length,
    signals,
    traders,
    timestamp: new Date().toISOString(),
  };
  cache = { at: now, data: payload };
  return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=60" } });
}
