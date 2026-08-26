import { UPBIT_TRADING_FEE_PCT, CEX_TRADING_FEES } from "./calculator-config";

export interface UsdtRoundTripResult {
  coin: string;
  investmentKrw: number;
  upbitUsdtKrwPrice: number;
  binanceCoinUsdPrice: number;
  upbitCoinKrwPrice: number;
  finalKrw: number;
  netProfitKrw: number;
  netProfitPct: number;
  isProfitable: boolean;
  currentPremiumPct: number;        // coin kimchi premium vs global price right now
  breakevenPremiumPct: number;      // coin kimchi premium needed for 0 profit (all else held constant)
  premiumGapToBreakevenPct: number; // percentage points of premium still missing (negative = buffer)
  upbitPriceRiseNeededPct: number;  // % rise of the Upbit coin price from now to break even
}


/**
 * Simulates funding a Kimchi-premium trade from KRW already held on Upbit.
 * KRW -> USDT on Upbit -> transfer USDT to Binance -> buy coin -> transfer coin
 * back to Upbit -> sell coin for KRW.
 */
export function evaluateUpbitUsdtRoundTrips(
  prices: Record<string, Record<string, number>>,
  krwUsdRate = 1350,
  investmentKrw = 1_000_000,
): UsdtRoundTripResult[] {
  const upbitUsdtUsd = prices.USDT?.upbit;
  if (!upbitUsdtUsd || upbitUsdtUsd <= 0) return [];

  const UPBIT_FEE_PCT = UPBIT_TRADING_FEE_PCT;
  const BINANCE_FEE_PCT = CEX_TRADING_FEES.binance;
  const USDT_WITHDRAWAL_FEE = 1;
  const COIN_WITHDRAWAL_USD = 2;
  const upbitUsdtKrwPrice = upbitUsdtUsd * krwUsdRate;
  const results: UsdtRoundTripResult[] = [];

  for (const [coin, exchangePrices] of Object.entries(prices)) {
    if (coin === "USDT") continue;
    const binanceCoinUsdPrice = exchangePrices.binance;
    const upbitCoinUsdPrice = exchangePrices.upbit;
    if (!binanceCoinUsdPrice || !upbitCoinUsdPrice || binanceCoinUsdPrice <= 0 || upbitCoinUsdPrice <= 0) continue;

    const usdtPurchased = (investmentKrw / upbitUsdtKrwPrice) * (1 - UPBIT_FEE_PCT / 100);
    const usdtAtBinance = usdtPurchased - USDT_WITHDRAWAL_FEE;
    if (usdtAtBinance <= 0) continue;

    const coinBought = (usdtAtBinance / binanceCoinUsdPrice) * (1 - BINANCE_FEE_PCT / 100);
    const coinAtUpbit = coinBought - COIN_WITHDRAWAL_USD / binanceCoinUsdPrice;
    if (coinAtUpbit <= 0) continue;

    const upbitCoinKrwPrice = upbitCoinUsdPrice * krwUsdRate;
    const finalKrw = coinAtUpbit * upbitCoinKrwPrice * (1 - UPBIT_FEE_PCT / 100);
    const netProfitKrw = finalKrw - investmentKrw;
    const netProfitPct = (netProfitKrw / investmentKrw) * 100;

    // Break-even: solve coinAtUpbit * priceKrw * (1 - fee) = investmentKrw for priceKrw.
    // coinAtUpbit is independent of the Upbit selling price, so this is exact.
    const breakevenUpbitKrwPrice = investmentKrw / (coinAtUpbit * (1 - UPBIT_FEE_PCT / 100));
    const breakevenUpbitUsdPrice = breakevenUpbitKrwPrice / krwUsdRate;
    const currentPremiumPct = ((upbitCoinUsdPrice - binanceCoinUsdPrice) / binanceCoinUsdPrice) * 100;
    const breakevenPremiumPct = ((breakevenUpbitUsdPrice - binanceCoinUsdPrice) / binanceCoinUsdPrice) * 100;

    results.push({
      coin,
      investmentKrw,
      upbitUsdtKrwPrice,
      binanceCoinUsdPrice,
      upbitCoinKrwPrice,
      finalKrw,
      netProfitKrw,
      netProfitPct,
      isProfitable: netProfitKrw > 0,
      currentPremiumPct,
      breakevenPremiumPct,
      premiumGapToBreakevenPct: breakevenPremiumPct - currentPremiumPct,
      upbitPriceRiseNeededPct: (breakevenUpbitKrwPrice / upbitCoinKrwPrice - 1) * 100,
    });
  }

  return results.sort((left, right) => right.netProfitKrw - left.netProfitKrw);
}
