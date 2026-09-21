import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Gate.io currency info is public (no key): per-chain deposit/withdraw flags.
// Binance / Bybit / OKX equivalents require API keys, so they are not wired.
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; data: unknown }>();

export async function GET(req: Request) {
  const currency = (new URL(req.url).searchParams.get("currency") ?? "").toUpperCase();
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
