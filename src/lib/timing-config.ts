export interface ChainTimingInfo {
  chainId: string;
  chainName: string;
  avgBlockTimeSec: number;
}

export const CHAIN_TIMING: ChainTimingInfo[] = [
  { chainId: "ethereum", chainName: "Ethereum", avgBlockTimeSec: 12 },
  { chainId: "arbitrum", chainName: "Arbitrum", avgBlockTimeSec: 0.25 },
  { chainId: "polygon", chainName: "Polygon", avgBlockTimeSec: 2 },
  { chainId: "base", chainName: "Base", avgBlockTimeSec: 2 },
  { chainId: "optimism", chainName: "Optimism", avgBlockTimeSec: 2 },
  { chainId: "bsc", chainName: "BNB Chain", avgBlockTimeSec: 3 },
];

// Exchange deposit confirmation requirements (number of blocks/confirmations)
export const DEPOSIT_CONFIRMATIONS: Record<string, Record<string, number>> = {
  // coin -> chain -> confirmations required by Binance
  binance: { ethereum: 12, arbitrum: 64, polygon: 100, base: 100, optimism: 64, bsc: 15 },
  upbit: { ethereum: 25, bsc: 20 },
};

// Typical CEX processing delays in seconds
export const PROCESSING_DELAYS = {
  marketOrderExecutionSec: 2,     // CEX matching engine
  withdrawalProcessingSec: 60,    // CEX internal withdrawal approval (avg 30-120s)
  dexSwapSec: 15,                 // wallet sign + broadcast + mempool inclusion
  bridgeSec: 180,                 // cross-chain bridge average
  depositCreditingSec: 30,        // CEX internal deposit crediting after confirmations
};