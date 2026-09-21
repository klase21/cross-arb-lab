import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Gate.io currency info is public (no key): per-chain deposit/withdraw flags.
// Binance / Bybit / OKX equivalents require API keys, so they are not wired.
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; data: unknown }>();

const BULK_TTL_MS = 10 * 60_000;
let bulkCache: { at: number; byCurrency: Record<string, { name: string; depositOk: boolean; withdrawOk: boolean; delayed: boolean }[]> } | null = null;

async function getBulk(): Promise<Record<string, { name: string; depositOk: boolean; withdrawOk: boolean; delayed: boolean }[]>> {
  if (bulkCache && Date.now() - bulkCache.at < BULK_TTL_MS) return bulkCache.byCurrency;
  const res = await fetch("https://api.gateio.ws/api/v4/spot/currencies", {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = (await res.json()) as {
    currency: string;
    delisted?: boolean;
    chains?: { name: string; withdraw_disabled?: boolean; withdraw_delayed?: boolean; deposit_disabled?: boolean }[];
  }[];
  const byCurrency: Record<string, { name: string; depositOk: boolean; withdrawOk: boolean; delayed: boolean }[]> = {};
  for (const c of Array.isArray(list) ? list : []) {
    if (!c.currency || c.delisted) continue;
    const chains = (Array.isArray(c.chains) ? c.chains : []).map(x => ({
      name: x.name,
      depositOk: x.deposit_disabled !== true,
      withdrawOk: x.withdraw_disabled !== true,
      delayed: x.withdraw_delayed === true,
    }));
    if (chains.length > 0) byCurrency[c.currency] = chains;
  }
  bulkCache = { at: Date.now(), byCurrency };
  return byCurrency;
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const batch = (params.get("currencies") ?? "")
    .split(",")
    .map(s => s.trim().toUpperCase())
    .filter(s => /^[A-Z0-9]{2,20}$/.test(s))
    .slice(0, 300);
  if (batch.length > 0) {
    // Bulk mode for table badges: one upstream call, filtered to requested coins.
    try {
      const all = await getBulk();
      const out: Record<string, { name: string; depositOk: boolean; withdrawOk: boolean; delayed: boolean }[]> = {};
      for (const cur of batch) if (all[cur]) out[cur] = all[cur].slice(0, 8);
      return NextResponse.json({ chains: out, timestamp: new Date().toISOString() });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "gate bulk failed" }, { status: 502 });
    }
  }
  const currency = (params.get("currency") ?? "").toUpperCase();
  if (!/^[A-Z0-9]{2,20}$/.test(currency)) {
    return NextResponse.json({ error: "currency required, e.g. BTC" }, { status: 400 });
  }
  const hit = cache.get(currency);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json(hit.data, { headers: { "Cache-Control": "public, max-age=60" } });
  }
  try {
    const res = await fetch(`https://api.gateio.ws/api/v4/spot/currencies/${currency}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as {
      currency: string;
      delisted?: boolean;
      trade_disabled?: boolean;
      chains?: { name: string; withdraw_disabled?: boolean; withdraw_delayed?: boolean; deposit_disabled?: boolean }[];
    };
    const chains = (Array.isArray(data.chains) ? data.chains : []).map(c => ({
      name: c.name,
      depositOk: c.deposit_disabled !== true,
      withdrawOk: c.withdraw_disabled !== true,
      delayed: c.withdraw_delayed === true,
    }));
    const payload = {
      currency: data.currency,
      delisted: data.delisted === true,
      tradeDisabled: data.trade_disabled === true,
      chains,
      timestamp: new Date().toISOString(),
    };
    if (cache.size > 200) cache.clear();
    cache.set(currency, { at: Date.now(), data: payload });
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (e) {
    if (hit) return NextResponse.json(hit.data, { headers: { "Cache-Control": "public, max-age=60" } });
    return NextResponse.json({ error: e instanceof Error ? e.message : "gate wallet failed" }, { status: 502 });
  }
}
