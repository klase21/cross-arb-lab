// Futures intelligence math: funding annualization, squeeze risk, liquidation estimates.
// Data: Binance Futures public REST (no key) + Hyperliquid public info endpoint.
// forceOrders (actual liquidation prints) needs an API key, so liquidation levels are
// OI-based *estimates* (like myposition's "Est." map) — never presented as actual events.

export interface FutRow {
  symbol: string;
  base: string;
  price: number;
  change24h: number;
  volume24h: number;
  oiContracts: number;
  oiUsd: number;
  oiChange24h: number | null;
  fundingRate: number;
  fundingApr: number;
  nextFundingMs: number;
  longAccount: number | null;
  lsRatio: number | null;
  squeezeScore: number;
  squeezeSide: "LONG" | "SHORT" | null;
}

export interface VenueQuote {
  venue: string;
  apr: number;
  mark: number | null;
}

export interface FundingArb {
  base: string;
  quotes: VenueQuote[];
  spreadApr: number;
  longVenue: string;
  shortVenue: string;
  dailyPer10k: number;
  nVenues: number;
}

/** 8h-quoted venues: Binance, Aster, Paradex. */
export function eightHourApr(rate8h: number): number {
  return rate8h * 3 * 365 * 100;
}

/** 1h-quoted venues: Hyperliquid, dYdX v4. */
export function hourlyApr(rate1h: number): number {
  return rate1h * 24 * 365 * 100;
}

/** Binance lastFundingRate covers 8h. */
export function binanceApr(rate8h: number): number {
  return rate8h * 3 * 365 * 100;
}

/** Hyperliquid funding field covers 1h. */
export function hyperliquidApr(rate1h: number): number {
  return rate1h * 24 * 365 * 100;
}

/**
 * Squeeze risk 0-100. Crowded longs + rising leverage + positive funding
 * = long-squeeze fuel (and mirrored for shorts). Purely descriptive.
 */
export function squeezeRisk(
  fundingAprPct: number,
  longAccount: number | null,
  oiChange24h: number | null,
  change24h: number,
): { score: number; side: "LONG" | "SHORT" | null } {
  let longFuel = 0;
  let shortFuel = 0;
  longFuel += Math.min(30, Math.max(0, fundingAprPct) * 1.2);
  shortFuel += Math.min(30, Math.max(0, -fundingAprPct) * 1.2);
  if (longAccount !== null) {
    longFuel += Math.min(30, Math.max(0, (longAccount - 0.5) * 2) * 30);
    shortFuel += Math.min(30, Math.max(0, (0.5 - longAccount) * 2) * 30);
  }
  if (oiChange24h !== null && oiChange24h > 0) {
    const boost = Math.min(20, oiChange24h * 0.5);
    longFuel += boost / 2;
    shortFuel += boost / 2;
  }
  const move = Math.min(20, Math.abs(change24h) * 1.5);
  longFuel += move / 2;
  shortFuel += move / 2;
  if (longFuel < 15 && shortFuel < 15) return { score: Math.round(Math.max(longFuel, shortFuel)), side: null };
  if (longFuel === shortFuel) return { score: Math.round(longFuel), side: null };
  return longFuel > shortFuel
    ? { score: Math.round(Math.min(100, longFuel)), side: "LONG" }
    : { score: Math.round(Math.min(100, shortFuel)), side: "SHORT" };
}

/** Estimated long/short liquidation price zones from mark price at standard leverages. */
export function liquidationZones(mark: number): { leverage: number; longLiq: number; shortLiq: number }[] {
  return [50, 25, 10, 5].map(leverage => {
    const mmr = 0.005;
    const longLiq = mark * (1 - (1 / leverage - mmr));
    const shortLiq = mark * (1 + (1 / leverage - mmr));
    return { leverage, longLiq: Math.max(longLiq, 0), shortLiq };
  });
}
