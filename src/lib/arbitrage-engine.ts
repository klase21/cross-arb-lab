import { WITHDRAWAL_FEES, GAS_COSTS_USD, DEX_SWAP_FEES } from "./calculator-config";
import { getUsdKrwRateSync } from "./fx";
import { calculateRoundTrip } from "./price-scanner";
import type { RoundTripResult } from "./types";
import type { DexSpotPrice } from "./types";
import type { ArbitrageOpportunity, ChainQuoteResult, ScanResult, CostBreakdown, FlowStep } from "./types";
const GAS_ESTIMATE_USD = 5;
const BRIDGE_FEE_PCT = 0.1;
const MIN_NET_SPREAD_PCT = 0.15;


const UPBIT_FEE_PCT = 0.05;


const UPBIT_SYMBOL_MAP: Record<string, string> = {
  WETH: "ETH", WBTC: "BTC", LINK: "LINK", UNI: "UNI", AAVE: "AAVE",
  CRV: "CRV", MKR: "MKR", PEPE: "PEPE", SHIB: "SHIB", ARB: "ARB",
  GMX: "GMX", MAGIC: "MAGIC", OP: "OP", CAKE: "CAKE",
};

function getUpbitBuySymbol(pair: string): string {
  const [base] = pair.split("/");
  return UPBIT_SYMBOL_MAP[base] ?? base;
}

function getUpbitMarket(pair: string): string {
  const symbol = getUpbitBuySymbol(pair);
  return `KRW-${symbol}`;
}

export interface CostCalcInput {
  investmentKrw: number;
  pair: string;
  buyChain: string;
  sellChain: string;
  arbProfitPct: number;
}

export function calculateCostBreakdown(input: CostCalcInput): CostBreakdown {
  const { investmentKrw, buyChain, arbProfitPct, pair } = input;

  const upbitFeeKrw = investmentKrw * (UPBIT_FEE_PCT / 100);
  const netAfterUpbitFee = investmentKrw - upbitFeeKrw;
  // Approximate prices in USD for cost calculation
  const APPROX_PRICES_USD: Record<string, number> = { ETH: 3500, BTC: 95000, LINK: 18, UNI: 10, AAVE: 150, CRV: 0.5, MKR: 2500, PEPE: 0.00001, SHIB: 0.00002 };
  const baseSymbol = pair.split("/")[0];
  const approxUsdPrice = APPROX_PRICES_USD[baseSymbol === "WETH" ? "ETH" : baseSymbol] ?? 100;
  const approxKrwPrice = approxUsdPrice * getUsdKrwRateSync();
  const tokensReceived = netAfterUpbitFee / approxKrwPrice;

  const withdrawFee = WITHDRAWAL_FEES[buyChain] ?? 0.0017;
  const gasCostUsd = GAS_COSTS_USD[buyChain] ?? 5;
  const swapFeePct = DEX_SWAP_FEES[buyChain] ?? 0.3;
  const isCrossChain = input.buyChain !== input.sellChain;
  const totalSwapFeesPct = isCrossChain ? swapFeePct * 2 : swapFeePct;
  const bridgeFeePct = isCrossChain ? 0.05 : 0;
  const totalOnchainFeesPct = totalSwapFeesPct + bridgeFeePct;
  const onchainFeeKrw = tokensReceived * approxKrwPrice * (totalOnchainFeesPct / 100);
  const gasCostKrw = gasCostUsd * getUsdKrwRateSync();
  const totalCostsKrw = upbitFeeKrw + withdrawFee * approxKrwPrice + gasCostKrw + onchainFeeKrw;

  const grossArbRevenue = investmentKrw * (arbProfitPct / 100);
  const netProfitKrw = grossArbRevenue - totalCostsKrw;
  const roiPct = (netProfitKrw / investmentKrw) * 100;
  const breakEvenSpreadPct = (totalCostsKrw / investmentKrw) * 100;

  return {
    upbitFeeKrw,
    withdrawalFeeKrw: withdrawFee * approxKrwPrice,
    gasCostKrw,
    onchainFeeKrw,
    totalCostsKrw,
    tokensReceived,
    netProfitKrw,
    roiPct,
    breakEvenSpreadPct,
  };
}


function buildFlowSteps(opp: {
  pair: string;
  buyCoin: string;
  buyChain: string;
  sellChain: string;
  buyDex: string;
  sellDex: string;
  isCrossChain: boolean;
}): FlowStep[] {
  const [baseSymbol, quoteSymbol] = opp.pair.split("/");
  const swapChain = opp.isCrossChain ? opp.sellChain : opp.buyChain;
  const steps: FlowStep[] = [];

  // Step 1: Upbit purchase
  steps.push({
    order: 1,
    action: `Buy ${opp.buyCoin}`,
    detail: `${opp.buyCoin} on Upbit (KRW market)`,
    platform: "Upbit",
    icon: "🏦",
  });

  // Step 2: Withdrawal
  steps.push({
    order: 2,
    action: "Withdraw",
    detail: `${opp.buyCoin} → ${opp.buyChain} wallet`,
    platform: opp.buyChain,
    chain: opp.buyChain,
    icon: "🔄",
  });

  if (opp.isCrossChain && opp.buyChain !== opp.sellChain) {
    // Step 3: Bridge
    steps.push({
      order: 3,
      action: "Bridge",
      detail: `Move to ${opp.sellChain}`,
      platform: "Bridge",
      chain: opp.sellChain,
      icon: "🌉",
    });
  }

  // Step 4: First DEX swap (buy cheap)
  steps.push({
    order: 4,
    action: "Swap",
    detail: `${opp.buyCoin} → ${quoteSymbol} on ${opp.buyDex}`,
    platform: opp.buyDex,
    chain: swapChain,
    icon: "🗄️",
  });

  // Step 5: Second DEX swap (sell expensive)
  steps.push({
    order: 5,
    action: "Reverse Swap",
    detail: `${quoteSymbol} → ${opp.buyCoin} on ${opp.sellDex}`,
    platform: opp.sellDex,
    chain: opp.sellChain,
    icon: "🔃",
  });

  // Step 6: Return to Upbit
  steps.push({
    order: 6,
    action: "Deposit",
    detail: `${opp.buyCoin} → Upbit`,
    platform: "Upbit",
    chain: opp.buyChain,
    icon: "📥",
  });

  // Step 7: Sell to KRW
  steps.push({
    order: 7,
    action: "Sell to KRW",
    detail: `Convert back to Korean Won`,
    platform: "Upbit",
    icon: "💰",
  });

  return steps;
}


export function findOpportunities(quotesByPair: Map<string, ChainQuoteResult[]>): ArbitrageOpportunity[] {
  const opportunities: ArbitrageOpportunity[] = [];

  for (const [pair, chainResults] of quotesByPair) {
    const allQuotes: { chainId: string; dex: string; price: number; feeTier: number; liquidityUsd: number }[] = [];

    for (const chainResult of chainResults) {
      for (const quote of chainResult.quotes) {
        allQuotes.push({ chainId: chainResult.chainId, ...quote });
      }
    }

    if (allQuotes.length < 2) continue;

    for (let i = 0; i < allQuotes.length; i++) {
      for (let j = i + 1; j < allQuotes.length; j++) {
        const a = allQuotes[i];
        const b = allQuotes[j];
        if (a.chainId === b.chainId && a.dex === b.dex) continue;

        const high = a.price > b.price ? a : b;
        const low = a.price > b.price ? b : a;
        const buyPrice = low.price;
        const sellPrice = high.price;
        const grossSpreadPct = ((sellPrice - buyPrice) / buyPrice) * 100;

        const isCrossChain = high.chainId !== low.chainId;
        let totalFeePct = ((low.feeTier + high.feeTier) / 10_000) * 100;
        if (isCrossChain) totalFeePct += BRIDGE_FEE_PCT;

        const netSpreadPct = grossSpreadPct - totalFeePct;
        if (netSpreadPct < MIN_NET_SPREAD_PCT) continue;

        const minLiquidity = Math.min(low.liquidityUsd, high.liquidityUsd);
        const gasEstimate = isCrossChain ? GAS_ESTIMATE_USD * 3 : GAS_ESTIMATE_USD;
        const estimatedProfitUsd = (minLiquidity * netSpreadPct) / 100 - gasEstimate;
        if (estimatedProfitUsd <= 0) continue;

        opportunities.push({
          pair,
          buyCoin: getUpbitBuySymbol(pair),
          upbitMarket: getUpbitMarket(pair),
          buyChain: low.chainId,
          sellChain: high.chainId,
          buyDex: low.dex,
          sellDex: high.dex,
          buyPrice,
          sellPrice,
          spreadPct: grossSpreadPct,
          netSpreadPct,
          liquidityUsd: minLiquidity,
          estimatedProfitUsd,
          isCrossChain,
          bridgeFeePct: isCrossChain ? BRIDGE_FEE_PCT : 0,
          direction: "dexToDex",
          costBreakdown: calculateCostBreakdown({
            investmentKrw: 1_000_000,
            pair,
            buyChain: low.chainId,
            sellChain: high.chainId,
            arbProfitPct: netSpreadPct,
          }),
          flowSteps: buildFlowSteps({
            pair,
            buyCoin: getUpbitBuySymbol(pair),
            buyChain: low.chainId,
            sellChain: high.chainId,
            buyDex: low.dex,
            sellDex: high.dex,
            isCrossChain,
          }),
          detectedAt: new Date().toISOString(),
        });
      }
    }
  }

  return opportunities.sort((a, b) => b.estimatedProfitUsd - a.estimatedProfitUsd);
}

const STABLE_USD_PER_UNIT: Record<string, number> = { USDC: 1, USDT: 1, DAI: 1, BUSD: 1, USDC_NATIVE: 1, USDC_BRIDGED: 1 };

/**
 * Derives USD prices for every base token from the scan quotes themselves:
 * pairs quoted in stables give the base USD directly; pairs quoted in wrapped
 * natives (WETH/WBNB/WBTC) are resolved in a second pass.
 */
export function deriveUsdPrices(quotesByPair: Map<string, ChainQuoteResult[]>): Record<string, number> {
  const usd: Record<string, number> = { ...STABLE_USD_PER_UNIT };
  const midPrice = (chainResults: ChainQuoteResult[]): number | null => {
    const prices: number[] = [];
    for (const cr of chainResults) for (const q of cr.quotes) prices.push(q.price);
    if (prices.length === 0) return null;
    prices.sort((a, b) => a - b);
    return prices[Math.floor(prices.length / 2)];
  };
  // Pass 1: stable-quoted pairs
  for (const [pair, chainResults] of quotesByPair) {
    const [base, quote] = pair.split("/");
    if (usd[base] !== undefined || !STABLE_USD_PER_UNIT[quote]) continue;
    const mid = midPrice(chainResults);
    if (mid && mid > 0) usd[base] = mid;
  }
  // Pass 2: wrapped-native quoted pairs (WETH/WBNB/WBTC priced in stables)
  for (const [pair, chainResults] of quotesByPair) {
    const [base, quote] = pair.split("/");
    if (usd[base] !== undefined || usd[quote] === undefined) continue;
    const mid = midPrice(chainResults);
    if (mid && mid > 0) usd[base] = mid * usd[quote];
  }
  return usd;
}

/**
 * Upbit-direction arbitrage in the same opportunity shape:
 *  - upbitToDex: buy on Upbit (KRW) → withdraw → sell on DEX
 *  - dexToUpbit: buy on DEX → withdraw → sell on Upbit (KRW)
 * Profitable when Upbit and DEX USD prices diverge beyond both legs' fees.
 */
export function findUpbitDirectionOpportunities(
  quotesByPair: Map<string, ChainQuoteResult[]>,
  upbitPricesKrw: Record<string, number>,
  fxRate: number,
): ArbitrageOpportunity[] {
  const usd = deriveUsdPrices(quotesByPair);
  const opportunities: ArbitrageOpportunity[] = [];
  const NOTIONAL_USD = 1000;

  for (const [pair, chainResults] of quotesByPair) {
    const [baseSymbol, quoteSymbol] = pair.split("/");
    const upbitSymbol = getUpbitBuySymbol(pair);
    const upbitKrw = upbitPricesKrw[upbitSymbol];
    const baseUsd = usd[baseSymbol];
    const quoteUsd = usd[quoteSymbol];
    if (!upbitKrw || upbitKrw <= 0 || !baseUsd || baseUsd <= 0 || !quoteUsd) continue;
    const upbitUsd = upbitKrw / fxRate;
    const upbitFeePct = UPBIT_FEE_PCT; // 0.05%

    for (const chainResult of chainResults) {
      for (const quote of chainResult.quotes) {
        const dexUsd = quote.price * quoteUsd;
        if (dexUsd <= 0) continue;
        const chainName = chainResult.chainId;
        const isCrossChain = true; // CEX↔DEX always crosses (withdrawal leg)
        const withdrawFeeUsd = (WITHDRAWAL_FEES[chainName] ?? 0.002) * baseUsd;
        const gasUsd = GAS_COSTS_USD[chainName] ?? 5;

        // Direction A: buy on Upbit → sell on DEX
        {
          const grossPct = ((dexUsd - upbitUsd) / upbitUsd) * 100;
          const feePct = upbitFeePct + 0.05 + (withdrawFeeUsd / NOTIONAL_USD) * 100 + (gasUsd / NOTIONAL_USD) * 100;
          const netPct = grossPct - feePct;
          if (netPct >= MIN_NET_SPREAD_PCT) {
            const estimatedProfitUsd = (NOTIONAL_USD * netPct) / 100;
            opportunities.push({
              pair,
              buyCoin: upbitSymbol,
              upbitMarket: `KRW-${upbitSymbol}`,
              buyChain: "upbit",
              sellChain: chainResult.chainId,
              buyDex: "Upbit",
              sellDex: quote.dex,
              buyPrice: upbitKrw,
              sellPrice: quote.price,
              spreadPct: grossPct,
              netSpreadPct: netPct,
              liquidityUsd: quote.liquidityUsd,
              estimatedProfitUsd,
              isCrossChain,
              bridgeFeePct: 0,
              direction: "upbitToDex",
              upbitPriceKrw: upbitKrw,
              detectedAt: new Date().toISOString(),
            });
          }
        }

        // Direction B: buy on DEX → withdraw to Upbit → sell on Upbit
        {
          const grossPct = ((upbitUsd - dexUsd) / dexUsd) * 100;
          const feePct = upbitFeePct + 0.05 + (withdrawFeeUsd / NOTIONAL_USD) * 100 + (gasUsd / NOTIONAL_USD) * 100;
          const netPct = grossPct - feePct;
          if (netPct >= MIN_NET_SPREAD_PCT) {
            const estimatedProfitUsd = (NOTIONAL_USD * netPct) / 100;
            opportunities.push({
              pair,
              buyCoin: upbitSymbol,
              upbitMarket: `KRW-${upbitSymbol}`,
              buyChain: chainResult.chainId,
              sellChain: "upbit",
              buyDex: quote.dex,
              sellDex: "Upbit",
              buyPrice: quote.price,
              sellPrice: upbitKrw,
              spreadPct: grossPct,
              netSpreadPct: netPct,
              liquidityUsd: quote.liquidityUsd,
              estimatedProfitUsd,
              isCrossChain,
              bridgeFeePct: 0,
              direction: "dexToUpbit",
              upbitPriceKrw: upbitKrw,
              detectedAt: new Date().toISOString(),
            });
          }
        }
      }
    }
  }

  return opportunities.sort((a, b) => b.netSpreadPct - a.netSpreadPct);
}

/** Stablecoin DEX-to-DEX rows, computed from the same scan (no extra request). */
export function findStableArbRows(quotesByPair: Map<string, ChainQuoteResult[]>): { pair: string; buyChain: string; buyDex: string; sellChain: string; sellDex: string; buyPrice: number; sellPrice: number; spreadPct: number; quotes: { chainId: string; dex: string; price: number }[] }[] {
  const rows: { pair: string; buyChain: string; buyDex: string; sellChain: string; sellDex: string; buyPrice: number; sellPrice: number; spreadPct: number; quotes: { chainId: string; dex: string; price: number }[] }[] = [];
  for (const [pair, chainResults] of quotesByPair) {
    const [base, quote] = pair.split("/");
    if (!STABLE_USD_PER_UNIT[base] || !STABLE_USD_PER_UNIT[quote]) continue;
    const flat: { chainId: string; dex: string; price: number }[] = [];
    for (const cr of chainResults) for (const q of cr.quotes) flat.push({ chainId: cr.chainId, dex: q.dex, price: q.price });
    if (flat.length < 2) continue;
    flat.sort((a, b) => a.price - b.price);
    const low = flat[0];
    const high = flat[flat.length - 1];
    rows.push({
      pair,
      buyChain: low.chainId,
      buyDex: low.dex,
      sellChain: high.chainId,
      sellDex: high.dex,
      buyPrice: low.price,
      sellPrice: high.price,
      spreadPct: ((high.price - low.price) / low.price) * 100,
      quotes: flat,
    });
  }
  return rows.sort((a, b) => b.spreadPct - a.spreadPct);
}

export function buildScanResult(
  quotesByPair: Map<string, ChainQuoteResult[]>,
  upbitPricesKrw?: Record<string, number>,
  fxRate?: number,
): ScanResult & { stableArbs: ReturnType<typeof findStableArbRows> } {
  const dexDex = findOpportunities(quotesByPair);
  const upbitDir = upbitPricesKrw && fxRate ? findUpbitDirectionOpportunities(quotesByPair, upbitPricesKrw, fxRate) : [];
  const opportunities = [...dexDex, ...upbitDir].sort((a, b) => b.estimatedProfitUsd - a.estimatedProfitUsd);
  const uniqueChains = new Set<string>();
  for (const results of quotesByPair.values()) {
    for (const r of results) uniqueChains.add(r.chainId);
  }

  return {
    opportunities,
    totalScannedPairs: quotesByPair.size,
    chainsScanned: uniqueChains.size,
    crossChainCount: opportunities.filter(o => o.isCrossChain).length,
    sameChainCount: opportunities.filter(o => !o.isCrossChain).length,
    timestamp: new Date().toISOString(),
    stableArbs: findStableArbRows(quotesByPair),
  };
}
export async function enrichWithRoundTrips(opportunities: ArbitrageOpportunity[]): Promise<ArbitrageOpportunity[]> {
  const enriched = await Promise.all(opportunities.map(async opp => {
    try {
      const [baseSymbol] = opp.pair.split("/");
      const rt = await calculateRoundTrip({
        pairKey: opp.pair,
        buyChainId: opp.buyChain as any,
        buyDexName: opp.buyDex,
        sellChainId: opp.sellChain as any,
        sellDexName: opp.sellDex,
      });
      if (!rt) return opp;
      const profitPct = ((rt.finalBase - 1) / 1) * 100;
      const roundTrip: RoundTripResult = {
        inputBase: 1,
        midQuote: rt.midQuote,
        finalBase: rt.finalBase,
        profitPct,
        leg1Dex: opp.buyDex,
        leg2Dex: opp.sellDex,
      };
      // Recalculate cost breakdown using the REAL round-trip profit
      const recalculatedCost = calculateCostBreakdown({
        investmentKrw: opp.costBreakdown ? 1_000_000 : 1_000_000,
        pair: opp.pair,
        buyChain: opp.buyChain,
        sellChain: opp.sellChain,
        arbProfitPct: profitPct, // use actual round-trip result
      });

      return { ...opp, roundTrip, netSpreadPct: profitPct, costBreakdown: recalculatedCost };
    } catch { return opp; }
  }));
  return enriched;
}

export async function enrichWithSpotPrices(opportunities: ArbitrageOpportunity[]): Promise<ArbitrageOpportunity[]> {
  const { getSpotPrices } = await import("./price-scanner");
  
  const enriched = await Promise.all(opportunities.map(async opp => {
    try {
      const [baseSymbol, quoteSymbol] = opp.pair.split("/");
      
      // Get spot price on buy DEX
      const buySpot = await getSpotPrices(
        opp.buyChain as any, opp.buyDex, baseSymbol, quoteSymbol
      );
      
      // Get spot price on sell DEX
      const sellSpot = await getSpotPrices(
        opp.sellChain as any, opp.sellDex, baseSymbol, quoteSymbol
      );
      
      if (!buySpot || !sellSpot) return opp;
      
      const spotPrices: DexSpotPrice[] = [
        {
          dex: opp.buyDex,
          chainId: opp.buyChain,
          baseToQuote: buySpot.baseToQuotePrice,
          reverseBase: sellSpot.quoteToBasePrice,
        },
        {
          dex: opp.sellDex,
          chainId: opp.sellChain,
          baseToQuote: sellSpot.baseToQuotePrice,
          reverseBase: buySpot.quoteToBasePrice,
        },
      ];
      
      return { ...opp, spotPrices };
    } catch { return opp; }
  }));
  
  return enriched;
}
