import type { ChainQuoteResult, DexQuote } from "./types";

export interface HybridArbOpportunity {
  coin: string; // what we buy on DEX (e.g. ETH)
  stablecoin: string; // what we use (e.g. USDT)
  entryCex: string; // where we buy the stablecoin with KRW
  exitCex: string; // where we sell the coin back
  dexName: string;
  chainId: string;
  cexCoinPriceUsd: number; // price of coin on exit CEX
  dexCoinPriceUsd: number; // effective price paid on DEX
  spreadPct: number; // gross spread between DEX and CEX
  netSpreadPct: number; // after all fees
  estimatedProfitUsd: number; // per $1000
  detectedAt: string;
}


/**
 * Find hybrid opportunities:
 * 1. Buy USDT on Upbit with KRW
 * 2. Withdraw USDT to a chain wallet
 * 3. Swap USDT -> COIN on a DEX (buying at DEX price)
 * 4. Deposit COIN to Binance
 * 5. Sell COIN for USDT at CEX price
 * 
 * Profit = (CEX sell price - DEX buy price) / DEX buy price - all fees
 */


// Which chains each coin can actually be traded as the native/wrapped version
// WBTC exists on ethereum/arbitrum; BTC-BEP20 only on bsc
const VALID_HYBRID_COMBOS: Record<string, string[]> = {
  ETH: ["ethereum", "arbitrum", "polygon", "base", "optimism", "bsc"],
  BTC: ["ethereum", "arbitrum", "bsc"], // via WBTC or BTCB
};

export function findHybridOpportunities(
  dexQuotes: Map<string, ChainQuoteResult[]>,
  cexPrices: Record<string, Record<string, number>>,
): HybridArbOpportunity[] {
  const opportunities: HybridArbOpportunity[] = [];

  const UPBIT_FEE_PCT = 0.05;   // buying USDT on Upbit
  const BINANCE_FEE_PCT = 0.1;  // selling coin on Binance
  const WITHDRAWAL_USD = 3;     // total withdrawal fees (USDT + coin)
  const GAS_USD = 2;            // average gas for one swap
  const INVESTMENT = 1000;

  const SYMBOL_MAP: Record<string, string> = { WETH: "ETH", WBTC: "BTC" };

  for (const [pairKey, chainResults] of dexQuotes) {
    const [baseSymbol, quoteSymbol] = pairKey.split("/");
    if (!["WETH", "WBTC"].includes(baseSymbol)) continue;
    const cexSymbol = SYMBOL_MAP[baseSymbol];
    const cexPriceList = cexPrices[cexSymbol];
    if (!cexPriceList) continue;

    for (const cr of chainResults) {
      if (cr.quotes.length === 0) continue;
      if (!(VALID_HYBRID_COMBOS[cexSymbol]?.includes(cr.chainId))) continue;
      // Find cheapest DEX price for this pair (lowest quote per base)
      const bestDex = [...cr.quotes].sort((a, b) => a.price - b.price)[0];

      for (const [cexName, cexPrice] of Object.entries(cexPriceList)) {
        if (!cexPrice || cexPrice <= 0) continue;

        // DEX price is already in USD terms (quote token assumed ~$1 stablecoin)
        const dexPriceUsd = bestDex.price;
        const spreadPct = ((cexPrice - dexPriceUsd) / dexPriceUsd) * 100;

        const totalFeesPct = UPBIT_FEE_PCT + BINANCE_FEE_PCT + bestDex.feeTier / 100;
        const netSpreadPct = spreadPct - totalFeesPct - 0.1; // extra slippage buffer

        if (netSpreadPct < 0.3) continue;

        const estimatedProfitUsd = (INVESTMENT * netSpreadPct) / 100 - WITHDRAWAL_USD - GAS_USD;
        if (estimatedProfitUsd <= 0) continue;

        opportunities.push({
          coin: cexSymbol,
          stablecoin: quoteSymbol,
          entryCex: "Upbit",
          exitCex: cexName.charAt(0).toUpperCase() + cexName.slice(1),
          dexName: bestDex.dex,
          chainId: cr.chainId,
          cexCoinPriceUsd: cexPrice,
          dexCoinPriceUsd: dexPriceUsd,
          spreadPct,
          netSpreadPct,
          estimatedProfitUsd,
          detectedAt: new Date().toISOString(),
        });
      }
    }
  }

  return opportunities.sort((a, b) => b.netSpreadPct - a.netSpreadPct);
}