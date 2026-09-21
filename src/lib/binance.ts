// Binance hosts, centralized so geo-blocking can be worked around in one place.
//
// Background: api.binance.com / fapi.binance.com / www.binance.com reject US
// IPs (HTTP 451), which includes Vercel's default region. data-api.binance.vision
// is Binance's official market-data-only mirror with no geo restriction and
// serves every /api/v3 spot endpoint we use (ticker, klines, bookTicker).
// All three bases are env-overridable (e.g. point at a Cloudflare Worker proxy
// in a non-US region if futures/bapi also get blocked from your host).

function cleanBase(value: string | undefined, fallback: string): string {
  const v = (value ?? fallback).trim().replace(/\/+$/, "");
  return v.length > 0 ? v : fallback;
}

/** Spot market data: .vision mirror by default (no geo-block). */
export const BINANCE_SPOT = cleanBase(process.env.BINANCE_SPOT_BASE, "https://data-api.binance.vision");

/** Futures (fapi) — no official mirror; override if your host region is blocked. */
export const BINANCE_FAPI = cleanBase(process.env.BINANCE_FAPI_BASE, "https://fapi.binance.com");

/** Square/CMS bapi on www — override with a proxy if blocked. */
export const BINANCE_BAPI = cleanBase(process.env.BINANCE_BAPI_BASE, "https://www.binance.com");
