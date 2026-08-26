// Live USD/KRW exchange rate with in-memory caching and layered fallbacks.
const DEFAULT_USD_KRW = 1380;
const TTL_MS = 30 * 60 * 1000;

let cache: { rate: number; at: number } | null = null;

function isValidRate(rate: unknown): rate is number {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 500 && rate < 3000;
}

/** Fetches the current USD/KRW rate (cached for 30 minutes across requests). */
export async function getUsdKrwRate(): Promise<number> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rate;

  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(5_000) });
    if (response.ok) {
      const data = await response.json() as { rates?: { KRW?: number } };
      const rate = data.rates?.KRW;
      if (isValidRate(rate)) {
        cache = { rate, at: Date.now() };
        return rate;
      }
    }
  } catch {}

  try {
    const response = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW", { signal: AbortSignal.timeout(5_000) });
    if (response.ok) {
      const data = await response.json() as { rates?: { KRW?: number } };
      const rate = data.rates?.KRW;
      if (isValidRate(rate)) {
        cache = { rate, at: Date.now() };
        return rate;
      }
    }
  } catch {}

  // All sources failed — reuse the last known good rate or a conservative default
  return cache?.rate ?? DEFAULT_USD_KRW;
}

/**
 * Synchronous variant for code paths that cannot await (cost breakdown math).
 * Returns the last cached rate, or the default if never fetched — call
 * getUsdKrwRate() earlier in the request to populate the cache.
 */
export function getUsdKrwRateSync(): number {
  return cache?.rate ?? DEFAULT_USD_KRW;
}
