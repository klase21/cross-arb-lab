import { NextResponse } from "next/server";
import {
  aggregateTraders,
  classifyMarket,
  detectSide,
  extractLevels,
  gradeConfidence,
  priceRoiPct,
  type SquareSignal,
  type SquareStatus,
} from "@/lib/square";
import { BINANCE_SPOT } from "@/lib/binance";
import { replay, type Kline } from "@/lib/signal-track";
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; data: unknown } | null = null;

interface StRow {
  id: number;
  author: string;
  title: string;
  text: string;
  symbol_hint: string | null;
  bullish: boolean | null;
  likes: number | null;
  published_at: string | null;
  collected_at: string;
}

async function fetchKlines(symbol: string, startMs: number): Promise<Kline[]> {
  const url = `${BINANCE_SPOT}/api/v3/klines?symbol=${symbol}&interval=15m&startTime=${startMs}&limit=200`;
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
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 503 });
  }
  try {
    const sql = neon(process.env.DATABASE_URL);
    const posts = (await sql`
      SELECT id, author, title, text, symbol_hint, bullish, likes, published_at, collected_at
      FROM st_ideas
      WHERE collected_at > now() - interval '3 days'
      ORDER BY collected_at DESC
      LIMIT 150`) as StRow[];

    const priceMap = new Map<string, number>();
    try {
      const res = await fetch(`${BINANCE_SPOT}/api/v3/ticker/price`, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const list = (await res.json()) as { symbol: string; price: string }[];
        for (const row of list) priceMap.set(row.symbol, Number.parseFloat(row.price));
      }
    } catch {}
    const spotBases = new Set<string>();
    for (const sym of priceMap.keys()) {
      if (sym.endsWith("USDT")) spotBases.add(sym.slice(0, -4));
    }

    const candidates: (Omit<SquareSignal, "postPrice" | "curPrice" | "roiPct" | "status" | "closeReason"> & { postMs: number })[] = [];
    for (const post of posts) {
      const text = `${post.title}\n${post.text}`;
      if (text.trim().length < 10) continue;
      // StockTwits symbol tags are authoritative (per-symbol streams).
      const hint = (post.symbol_hint ?? "").toUpperCase();
      const asset = spotBases.has(hint) && hint !== "USDT" ? hint : null;
      if (!asset) continue;
      // Sentiment tag breaks ties; explicit text direction wins.
      let side = detectSide(text);
      if (!side && post.bullish !== null) side = post.bullish ? "LONG" : "SHORT";
      if (!side) continue;
      const { entry, target, stop, leverage } = extractLevels(text);
      const market = classifyMarket(text, leverage);
      const confidence = gradeConfidence(entry, target, stop);
      const postMs = (post.published_at && Date.parse(post.published_at)) || Date.parse(post.collected_at) || now;
      candidates.push({
        id: `st:${post.id}`,
        source: "st",
        postId: String(post.id),
        author: post.author || "stocktwits",
        authorVerified: false,
        asset,
        symbol: `${asset}USDT`,
        side,
        market,
        confidence,
        entry,
        target,
        stop,
        leverage,
        postMs,
        views: 0,
        likes: post.likes ?? 0,
        snippet: text.replace(/\s+/g, " ").slice(0, 220),
        url: `https://stocktwits.com/symbol/${asset}`,
      });
    }

    const priceCands = candidates.filter(c => priceMap.has(c.symbol)).sort((a, b) => b.postMs - a.postMs);
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

    signals.sort((a, b) => b.postMs - a.postMs);
    const traders = aggregateTraders(signals);
    const payload = { postsScanned: posts.length, signals, traders, timestamp: new Date().toISOString() };
    cache = { at: now, data: payload };
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "st failed" }, { status: 502 });
  }
}
