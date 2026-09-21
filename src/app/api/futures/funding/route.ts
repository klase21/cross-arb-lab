import { NextResponse } from "next/server";
import { eightHourApr, hourlyApr, type FundingArb, type VenueQuote } from "@/lib/futures";
import { BINANCE_FAPI } from "@/lib/binance";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 2 * 60 * 1000;
let cache: { at: number; data: unknown } | null = null;

interface PremIdx {
  symbol: string;
  lastFundingRate: string;
}

interface HlMeta {
  universe: { name: string }[];
}

interface HlCtx {
  funding: string;
  markPx: string;
}

interface DydxMarkets {
  markets: Record<string, { ticker: string; status: string; nextFundingRate: string; oraclePrice: string }>;
}

interface ParadexSummary {
  results: { symbol: string; funding_rate: string; mark_price: string }[];
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 12000): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.data, { headers: { "Cache-Control": "public, max-age=60" } });
  }
  try {
    const [binRes, hlRes, asterRes, dydxRes, parRes] = await Promise.all([
      fetchJson(`${BINANCE_FAPI}/fapi/v1/premiumIndex`).catch(() => null),
      fetchJson("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      }),
      fetchJson("https://fapi.asterdex.com/fapi/v1/premiumIndex").catch(() => null),
      fetchJson("https://indexer.dydx.trade/v4/perpetualMarkets").catch(() => null),
      fetchJson("https://api.prod.paradex.trade/v1/markets/summary?market=ALL").catch(() => null),
    ]);
    if (!hlRes.ok) throw new Error(`hyperliquid ${hlRes.status}`);

    const venueStatus: Record<string, boolean> = {
      Binance: false,
      Hyperliquid: true,
      Aster: asterRes !== null && asterRes.ok,
      dYdX: dydxRes !== null && dydxRes.ok,
      Paradex: parRes !== null && parRes.ok,
    };

    const byBase = new Map<string, VenueQuote[]>();
    const num = (v: string | undefined): number | null => {
      const n = Number.parseFloat(v ?? "");
      return n > 0 ? n : null;
    };
    const add = (base: string, venue: string, apr: number, mark: number | null) => {
      if (!base || !Number.isFinite(apr)) return;
      const list = byBase.get(base) ?? [];
      if (!list.some(q => q.venue === venue)) list.push({ venue, apr, mark });
      byBase.set(base, list);
    };

    // Binance is optional: if its region is blocked, the other four venues still compare.
    if (binRes && binRes.ok) {
      venueStatus.Binance = true;
      const premAll = (await binRes.json()) as (PremIdx & { markPrice: string })[];
      for (const p of premAll) {
        if (!p.symbol.endsWith("USDT")) continue;
        add(p.symbol.slice(0, -4), "Binance", eightHourApr(Number.parseFloat(p.lastFundingRate) || 0), num(p.markPrice));
      }
    }

    const [hlMeta, hlCtxs] = (await hlRes.json()) as [HlMeta, HlCtx[]];
    hlMeta.universe.forEach((u, i) => {
      const ctx = hlCtxs[i];
      if (ctx) add(u.name, "Hyperliquid", hourlyApr(Number.parseFloat(ctx.funding) || 0), num(ctx.markPx));
    });

    if (asterRes && asterRes.ok) {
      const aster = (await asterRes.json()) as (PremIdx & { markPrice: string })[];
      for (const p of aster) {
        if (!p.symbol.endsWith("USDT")) continue;
        add(p.symbol.slice(0, -4), "Aster", eightHourApr(Number.parseFloat(p.lastFundingRate) || 0), num(p.markPrice));
      }
    }

    if (dydxRes && dydxRes.ok) {
      const dydx = (await dydxRes.json()) as DydxMarkets;
      for (const m of Object.values(dydx.markets)) {
        if (m.status !== "ACTIVE") continue;
        const base = m.ticker.split("-")[0];
        add(base, "dYdX", hourlyApr(Number.parseFloat(m.nextFundingRate) || 0), num(m.oraclePrice));
      }
    }

    if (parRes && parRes.ok) {
      const par = (await parRes.json()) as ParadexSummary;
      for (const r of par.results ?? []) {
        if (!r.symbol.endsWith("-USD-PERP")) continue;
        add(r.symbol.replace(/-USD-PERP$/, ""), "Paradex", eightHourApr(Number.parseFloat(r.funding_rate) || 0), num(r.mark_price));
      }
    }

    const rows: FundingArb[] = [];
    for (const [base, quotes] of byBase) {
      if (quotes.length < 2) continue;
      const sorted = [...quotes].sort((a, b) => a.apr - b.apr);
      const spreadApr = sorted[sorted.length - 1].apr - sorted[0].apr;
      rows.push({
        base,
        quotes: sorted,
        spreadApr,
        longVenue: sorted[0].venue,
        shortVenue: sorted[sorted.length - 1].venue,
        dailyPer10k: (Math.abs(spreadApr) / 100 / 365) * 10000,
        nVenues: quotes.length,
      });
    }
    rows.sort((a, b) => Math.abs(b.spreadApr) - Math.abs(a.spreadApr));
    const payload = { rows: rows.slice(0, 40), count: rows.length, venueStatus, timestamp: new Date().toISOString() };
    cache = { at: now, data: payload };
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "funding failed" }, { status: 502 });
  }
}
