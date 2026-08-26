export interface DexQuote {
  dex: string;
  price: number;
  liquidityUsd: number;
  feeTier: number;
}

export interface ChainQuoteResult {
  chainId: string;
  pair: string;
  quotes: DexQuote[];
}

export interface RoundTripResult {
  inputBase: number;
  midQuote: number;
  finalBase: number;
  profitPct: number;
  leg1Dex: string;
  leg2Dex: string;
}

export interface CostBreakdown {
  upbitFeeKrw: number;
  withdrawalFeeKrw: number;
  gasCostKrw: number;
  onchainFeeKrw: number;
  totalCostsKrw: number;
  tokensReceived: number;
  netProfitKrw: number;
  roiPct: number;
  breakEvenSpreadPct: number;
}

export interface FlowStep {
  order: number;
  action: string;
  detail: string;
  platform: string;
  chain?: string;
  icon: string;
}

export interface DexSpotPrice {
  dex: string;
  chainId: string;
  baseToQuote: number; // 1 base = X quote
  reverseBase: number; // after round trip, how much base you get back from the quote amount
}

export type ArbDirection = "upbitToDex" | "dexToUpbit" | "dexToDex";

export interface ArbitrageOpportunity {
  pair: string;
  buyCoin: string; // what to buy on Upbit
  upbitMarket: string; // e.g. KRW-ETH
  buyChain: string;
  sellChain: string;
  buyDex: string;
  sellDex: string;
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
  netSpreadPct: number;
  liquidityUsd: number;
  estimatedProfitUsd: number;
  isCrossChain: boolean;
  bridgeFeePct: number;
  direction?: ArbDirection; // default "dexToDex" for legacy DEX↔DEX rows
  upbitPriceKrw?: number; // Upbit KRW price used in Upbit-direction comparisons
  detectedAt: string;
  costBreakdown?: CostBreakdown;
  roundTrip?: RoundTripResult;
  flowSteps?: FlowStep[];
  spotPrices?: DexSpotPrice[];
}

export interface ScanResult {
  opportunities: ArbitrageOpportunity[];
  totalScannedPairs: number;
  chainsScanned: number;
  crossChainCount: number;
  sameChainCount: number;
  timestamp: string;
}

export interface StableArbRow {
  pair: string;
  buyChain: string;
  buyDex: string;
  sellChain: string;
  sellDex: string;
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
  quotes: { chainId: string; dex: string; price: number }[];
}