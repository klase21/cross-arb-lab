export interface CexArbitrageOpportunity {
  coin: string;
  buyCex: string;
  sellCex: string;
  buyPriceUsd: number;
  sellPriceUsd: number;
  spreadPct: number; // gross
  netSpreadPct: number; // after fees
  estimatedProfitUsd: number;
  detectedAt: string;
}

const CEX_FEES: Record<string, number> = { upbit: 0.05, bithumb: 0.1, binance: 0.1, bybit: 0.1, okx: 0.1 };
const WITHDRAWAL_FEE_USD = 2;

export function findCexOpportunities(prices: Record<string, Record<string, number>>): CexArbitrageOpportunity[] {
  const opportunities: CexArbitrageOpportunity[] = [];

  for (const [coin, exchangePrices] of Object.entries(prices)) {
    if (coin === "USDT") continue;
    const entries = Object.entries(exchangePrices).filter(([,p]) => p > 0);
    if (entries.length < 2) continue;

    const sorted = [...entries].sort((a, b) => b[1] - a[1]);

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const [sellCex, sellP] = sorted[i];
        const [buyCex, buyP] = sorted[j];
        const grossSpread = ((sellP - buyP) / buyP) * 100;
        const totalFeePct = (CEX_FEES[buyCex] ?? 0.1) + (CEX_FEES[sellCex] ?? 0.1);
        const netSpread = grossSpread - totalFeePct - 0.05; // withdrawal ~0.05% on $1000
        if (netSpread <= 0.1) continue;

        const investmentUsd = 1000;
        const profit = (investmentUsd * netSpread) / 100 - WITHDRAWAL_FEE_USD;
        if (profit <= 0) continue;

        opportunities.push({ coin, buyCex, sellCex, buyPriceUsd: buyP, sellPriceUsd: sellP, spreadPct: grossSpread, netSpreadPct: netSpread, estimatedProfitUsd: profit, detectedAt: new Date().toISOString() });
      }
    }
  }

  return opportunities.sort((a, b) => b.netSpreadPct - a.netSpreadPct);
}
