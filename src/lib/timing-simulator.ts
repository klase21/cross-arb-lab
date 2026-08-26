
// Valid coin-chain combinations (what can actually exist on-chain)
// BTC native coin cannot be sent to EVM chains - only wrapped versions (WBTC) work there
const VALID_COMBOS: Record<string, string[]> = {
  ETH: ["ethereum", "arbitrum", "polygon", "base", "optimism", "bsc"], // WETH on all
  BTC: ["bsc"], // BTC-BEP20 token on BSC only; WBTC exists on ethereum/arbitrum but is a different symbol
  XRP: ["bsc"],
  SOL: [],
  ADA: [],
};

export function isValidCoinChainCombo(coinSymbol: string, chainId: string): boolean {
  const allowed = VALID_COMBOS[coinSymbol];
  // Coins without explicit config are assumed tradable unless proven otherwise
  return allowed ? allowed.includes(chainId) : true;
}

import { CHAIN_TIMING, DEPOSIT_CONFIRMATIONS, PROCESSING_DELAYS } from "./timing-config";

export interface SimulationStep {
  order: number;
  label: string;
  detail: string;
  durationSec: number; // estimated duration for this step
  cumulativeSec: number; // total elapsed after this step
  icon: string;
}

export interface TimingSimulationResult {
  steps: SimulationStep[];
  totalSec: number;
  totalMinutes: string;
  bottleneckLabel: string;
  bottleneckSec: number;
}


export interface SimulateInput {
  coinSymbol: string;
  coin?: string;       // e.g. ETH
  buyCexId: string;         // e.g. upbit
  sellCexId: string;        // e.g. binance
  chainId: string;          // withdrawal network
  isCrossChainDex: boolean; // does route include a DEX swap?
  dexChainId?: string;      // which chain the DEX swap happens on
}


function getBlockTime(chainId: string): number {
  return CHAIN_TIMING.find(c => c.chainId === chainId)?.avgBlockTimeSec ?? 5;
}

export function simulateTiming(input: SimulateInput): TimingSimulationResult {
  // Validate that the coin can actually be sent to this chain
  if (!isValidCoinChainCombo(input.coinSymbol, input.chainId)) {
    // Return a result with an error indicator via bottleneckLabel
    return {
      steps: [],
      totalSec: -1,
      totalMinutes: "INVALID ROUTE",
      bottleneckLabel: `${input.coinSymbol} cannot be sent to ${input.chainId}. Use the correct wrapped token or a supported network.`,
      bottleneckSec: 0,
    };
  }
  const steps: SimulationStep[] = [];
  let cumulative = 0;
  const add = (label: string, detail: string, dur: number, icon: string) => {
    cumulative += dur;
    steps.push({ order: steps.length + 1, label, detail, durationSec: Math.round(dur), cumulativeSec: Math.round(cumulative), icon });
  };

  add(`Market buy ${input.coinSymbol} on ${input.buyCexId}`, `CEX matching engine fills your order`, PROCESSING_DELAYS.marketOrderExecutionSec, "\u{1F3E6}");

  add(`Withdrawal approval on ${input.buyCexId}`, `Internal review + broadcast`, PROCESSING_DELAYS.withdrawalProcessingSec, "\u{1F4E4}");

  if (input.isCrossChainDex && input.dexChainId) {
    add(`DEX swap on ${input.dexChainId}`, `Wallet sign + broadcast + inclusion`, PROCESSING_DELAYS.dexSwapSec, "\u{1F504}");
  }

  const confs = DEPOSIT_CONFIRMATIONS[input.sellCexId]?.[input.chainId] ?? 12;
  const blockTime = getBlockTime(input.chainId);
  const confirmSec = confs * blockTime;
  add(`On-chain confirmations (${confs} blocks)`, `${input.chainId} ~${blockTime}s per block`, confirmSec, "\u26D3");
  add(`Deposit credited on ${input.sellCexId}`, `CEX internal crediting after confirmations`, PROCESSING_DELAYS.depositCreditingSec, "📥");
  add(`Market sell on ${input.sellCexId}`, `CEX matching engine fills your order`, PROCESSING_DELAYS.marketOrderExecutionSec, "\u{1F4B8}");

  const bottleneck = [...steps].sort((a, b) => b.durationSec - a.durationSec)[0];

  const totalMin = Math.floor(cumulative / 60);
  const totalSecRem = Math.round(cumulative % 60);

  return {
    steps,
    totalSec: Math.round(cumulative),
    totalMinutes: `${totalMin}m ${totalSecRem}s`,
    bottleneckLabel: bottleneck?.label ?? "",
    bottleneckSec: bottleneck?.durationSec ?? 0,
  };
}