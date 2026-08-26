export interface CexInfo {
  id: string;
  name: string;
  tradingFeePct: number; // taker fee
  withdrawalFeeUsdt: number; // withdrawal fee in USDT equivalent
}

export const CEXES: CexInfo[] = [
  { id: "upbit", name: "Upbit", tradingFeePct: 0.05, withdrawalFeeUsdt: 2 },
  { id: "bithumb", name: "Bithumb", tradingFeePct: 0.1, withdrawalFeeUsdt: 2 },
  { id: "binance", name: "Binance", tradingFeePct: 0.1, withdrawalFeeUsdt: 1 },
  { id: "bybit", name: "Bybit", tradingFeePct: 0.1, withdrawalFeeUsdt: 1 },
  { id: "okx", name: "OKX", tradingFeePct: 0.1, withdrawalFeeUsdt: 1 },
];

// Coins available on multiple CEXes for cross-CEX arbitrage
export const CEX_PAIRS = ["BTC", "ETH", "XRP", "SOL", "ADA"];