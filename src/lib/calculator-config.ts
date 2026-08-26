export interface ChainCostInfo {
  chainName: string;
  upbitWithdrawalFee: number; // in native token units
  gasEstimateUsd: number; // estimated gas cost in USD for a swap
  dexSwapFeePct: number; // typical DEX swap fee
  bridgeFeePct: number; // bridge fee percentage if cross-chain needed
}

// Upbit KRW market symbols and their supported withdrawal chains
export interface UpbitMarket {
  symbol: string; // e.g. "ETH", "BTC"
  krwMarket: string; // e.g. "KRW-ETH"
  name: string;
  chains: { chainId: string; tokenAddress: string }[]; // which chains Upbit supports withdrawal to
}

export const UPBIT_MARKETS: UpbitMarket[] = [
  {
    symbol: "ETH",
    krwMarket: "KRW-ETH",
    name: "Ethereum",
    chains: [
      { chainId: "ethereum", tokenAddress: "native" },
      { chainId: "arbitrum", tokenAddress: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" },
      { chainId: "polygon", tokenAddress: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619" },
      { chainId: "base", tokenAddress: "0x4200000000000000000000000000000000000006" },
      { chainId: "optimism", tokenAddress: "0x4200000000000000000000000000000000000006" },
      { chainId: "bsc", tokenAddress: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8" },
    ],
  },
  {
    symbol: "BTC",
    krwMarket: "KRW-BTC",
    name: "Bitcoin",
    chains: [
      { chainId: "bsc", tokenAddress: "0x7130d2A12B9BCBFAe4f2634d864A1Ee1Ce3Ead9c" },
    ],
  },
  {
    symbol: "XRP",
    krwMarket: "KRW-XRP",
    name: "Ripple",
    chains: [
      { chainId: "bsc", tokenAddress: "0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE" },
    ],
  },
];

// Withdrawal fees from Upbit (approximate, in native token)
export const WITHDRAWAL_FEES: Record<string, number> = {
  ethereum: 0.0017, // ETH
  arbitrum: 0.0017, // ETH
  polygon: 0.0017, // ETH (WETH)
  base: 0.0017, // ETH (WETH)
  optimism: 0.0017, // ETH (WETH)
  bsc: 0.0005, // BNB equivalent
};

// Estimated gas costs per transaction in USD
export const GAS_COSTS_USD: Record<string, number> = {
  ethereum: 8,
  arbitrum: 0.15,
  polygon: 0.01,
  base: 0.05,
  optimism: 0.08,
  bsc: 0.25,
};

// Typical DEX swap fees
export const DEX_SWAP_FEES: Record<string, number> = {
  ethereum: 0.3,
  arbitrum: 0.3,
  polygon: 0.3,
  base: 0.3,
  optimism: 0.3,
  bsc: 0.25,
};

// Bridge fees if moving assets between chains
export const BRIDGE_FEES: Record<string, number> = {
  ethereum: 0.05,
  arbitrum: 0.05,
  polygon: 0.05,
  base: 0.05,
  optimism: 0.05,
  bsc: 0.05,
};

// Upbit trading fee (maker/taker both 0.05%)
export const UPBIT_TRADING_FEE_PCT = 0.05;

// Centralized trading fees per CEX (percentage)
export const CEX_TRADING_FEES: Record<string, number> = {
  upbit: 0.05,
  bithumb: 0.1,
  binance: 0.1,
  bybit: 0.1,
  okx: 0.1,
};

// Fallback gas estimate when per-chain value is unavailable
export const DEFAULT_GAS_ESTIMATE_USD = 5;

// Single-value bridge fee percentage for generic cross-chain spread math (matches BRIDGE_FEES per-chain)
export const SINGLE_BRIDGE_FEE_PCT = 0.05;
export const MIN_NET_SPREAD_PCT = 0.15;