import { GAS_COSTS_USD, BRIDGE_FEES } from "./calculator-config";
import { simulateTiming } from "./timing-simulator";

export type RiskGrade = "A" | "B" | "C" | "D" | "F";

export interface RiskAxes {
  liquidity: number; // 0-100
  execution: number;
  exchange: number;
  token: number;
  volatility: number;
}

export interface RiskResult {
  total: number; // 0-100
  grade: RiskGrade;
  axes: RiskAxes;
  label: string;
}

export interface RiskWeights {
  liquidity: number;
  execution: number;
  exchange: number;
  token: number;
  volatility: number;
}

export const DEFAULT_WEIGHTS: RiskWeights = {
  liquidity: 0.30,
  execution: 0.25,
  exchange: 0.20,
  token: 0.15,
  volatility: 0.10,
};

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function gradeOf(total: number): RiskGrade {
  if (total <= 20) return "A";
  if (total <= 40) return "B";
  if (total <= 60) return "C";
  if (total <= 80) return "D";
  return "F";
}

function gradeLabel(grade: RiskGrade): string {
  switch (grade) {
    case "A": return "초저위험";
    case "B": return "저위험";
    case "C": return "중위험";
    case "D": return "고위험";
    case "F": return "초고위험";
  }
}

// --- Axis scorers ---

function scoreLiquidity(liquidityUsd: number, volumeKrw?: number): number {
  // Prefer volumeKrw when available (Kimchi), fallback to liquidityUsd (DEX)
  if (typeof volumeKrw === "number" && volumeKrw > 0) {
    if (volumeKrw < 100_000_000) return 95; // <1억
    if (volumeKrw < 1_000_000_000) return 70; // <10억
    if (volumeKrw < 10_000_000_000) return 40; // <100억
    if (volumeKrw < 50_000_000_000) return 20;
    return 10;
  }
  // DEX side: liquidityUsd currently 100 fixed, future Dexscreener will populate real value
  if (liquidityUsd < 50) return 95;
  if (liquidityUsd < 200) return 65;
  if (liquidityUsd < 1000) return 35;
  if (liquidityUsd < 10000) return 20;
  return 10;
}

function scoreExecution(params: { chainId: string; isCrossChain: boolean; totalSec: number }): number {
  const gasUsd = GAS_COSTS_USD[params.chainId] ?? 5;
  const gasScore = clamp(gasUsd * 12.5); // 8 ->100, 0.15->2, 0.05->1
  const bridgeScore = params.isCrossChain ? 60 : 0;
  // timeScore: 0s=0, 300s=17, 600s=33, 1800s=100
  const timeScore = params.totalSec < 0 ? 100 : clamp((params.totalSec / 1800) * 100);
  // weighted inside execution
  return clamp(gasScore * 0.4 + bridgeScore * 0.3 + timeScore * 0.3);
}

function scoreExchange(params: { walletState?: string; blockState?: string; message?: string }): number {
  if (!params.walletState) return 50; // unknown
  const isWorking = params.walletState === "working" && params.blockState === "normal" && !params.message;
  if (isWorking) return 10;
  if (params.walletState === "withdraw_only") return 65;
  if (params.walletState === "deposit_only") return 70;
  // paused, etc
  return 95;
}

function scoreToken(params: { binanceDevPct?: number; verified?: boolean; binanceOnCmc?: boolean }): number {
  let s = 30; // base
  if (params.binanceDevPct === undefined) {
    s = 50;
  } else if (params.binanceDevPct <= 5) {
    s = 10;
  } else if (params.binanceDevPct <= 10) {
    s = 30;
  } else if (params.binanceDevPct <= 20) {
    s = 60;
  } else {
    s = 90;
  }
  if (params.verified === false) s = clamp(s + 20);
  if (params.binanceOnCmc === false) s = clamp(s + 15);
  return s;
}

function scoreVolatility(params: { delta1h?: number; spreadBufferPct?: number }): number {
  let v = 30;
  if (typeof params.delta1h === "number") {
    const ad = Math.abs(params.delta1h);
    if (ad < 1) v = 15;
    else if (ad < 3) v = 45;
    else if (ad < 6) v = 75;
    else v = 95;
  } else {
    v = 40; // unknown -> medium
  }
  if (typeof params.spreadBufferPct === "number") {
    // spreadBuffer = netSpread - breakEven (or MIN_NET_SPREAD)
    // small buffer -> high risk
    if (params.spreadBufferPct < 0.2) v = clamp((v + 90) / 2);
    else if (params.spreadBufferPct < 0.5) v = clamp((v + 55) / 2);
    else v = clamp((v + 15) / 2);
  }
  return v;
}

// --- Public scorers ---

export interface DexRiskInput {
  pair: string;
  buyChain: string;
  sellChain: string;
  buyCoin: string;
  isCrossChain: boolean;
  liquidityUsd: number;
  netSpreadPct: number;
  breakEvenSpreadPct?: number; // from costBreakdown
  binanceDevPct?: number; // rarely available for DEX, keep optional
  verified?: boolean;
  walletState?: string;
  blockState?: string;
  walletMessage?: string;
}

export function scoreDexArb(input: DexRiskInput, weights: RiskWeights = DEFAULT_WEIGHTS): RiskResult {
  // timing
  let totalSec = 600;
  try {
    const t = simulateTiming({
      coinSymbol: input.buyCoin,
      buyCexId: "upbit",
      sellCexId: "binance",
      chainId: input.buyChain === "upbit" ? input.sellChain : input.buyChain,
      isCrossChainDex: false,
    });
    if (t.totalSec >= 0) totalSec = t.totalSec;
    else totalSec = 9999; // invalid route -> max risk
  } catch {
    totalSec = 9999;
  }

  const axes: RiskAxes = {
    liquidity: scoreLiquidity(input.liquidityUsd),
    execution: scoreExecution({ chainId: input.buyChain === "upbit" ? input.sellChain : input.buyChain, isCrossChain: input.isCrossChain, totalSec }),
    exchange: scoreExchange({ walletState: input.walletState, blockState: input.blockState, message: input.walletMessage }),
    token: scoreToken({ binanceDevPct: input.binanceDevPct, verified: input.verified }),
    volatility: scoreVolatility({
      spreadBufferPct: typeof input.breakEvenSpreadPct === "number" ? input.netSpreadPct - input.breakEvenSpreadPct : undefined,
    }),
  };

  // invalid route forces F
  if (totalSec >= 9999) {
    axes.execution = 100;
  }

  const total = clamp(
    axes.liquidity * weights.liquidity +
      axes.execution * weights.execution +
      axes.exchange * weights.exchange +
      axes.token * weights.token +
      axes.volatility * weights.volatility,
  );
  const grade = gradeOf(total);
  return { total, grade, axes, label: gradeLabel(grade) };
}

export interface KimchiRiskInput {
  coin: string;
  liquidityUsd?: number;
  volumeKrw?: number;
  chainId?: string; // not used but kept for symmetry
  binanceDevPct?: number;
  verified?: boolean;
  binanceOnCmc?: boolean;
  walletState?: string;
  blockState?: string;
  walletMessage?: string;
  delta1h?: number;
  spreadBufferPct?: number; // netProfit vs breakeven gap
}

export function scoreKimchi(input: KimchiRiskInput, weights: RiskWeights = DEFAULT_WEIGHTS): RiskResult {
  const axes: RiskAxes = {
    liquidity: scoreLiquidity(input.liquidityUsd ?? 100, input.volumeKrw),
    execution: scoreExecution({ chainId: input.chainId ?? "ethereum", isCrossChain: false, totalSec: 300 }), // kimchi: assume 5min CEX withdraw
    exchange: scoreExchange({ walletState: input.walletState, blockState: input.blockState, message: input.walletMessage }),
    token: scoreToken({ binanceDevPct: input.binanceDevPct, verified: input.verified, binanceOnCmc: input.binanceOnCmc }),
    volatility: scoreVolatility({ delta1h: input.delta1h, spreadBufferPct: input.spreadBufferPct }),
  };

  const total = clamp(
    axes.liquidity * weights.liquidity +
      axes.execution * weights.execution +
      axes.exchange * weights.exchange +
      axes.token * weights.token +
      axes.volatility * weights.volatility,
  );
  const grade = gradeOf(total);
  return { total, grade, axes, label: gradeLabel(grade) };
}

export function riskColor(grade: RiskGrade): string {
  switch (grade) {
    case "A": return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
    case "B": return "bg-emerald-900/50 text-emerald-300 border-emerald-800";
    case "C": return "bg-amber-500/20 text-amber-300 border-amber-500/30";
    case "D": return "bg-orange-500/20 text-orange-300 border-orange-700/50";
    case "F": return "bg-red-500/20 text-red-300 border-red-700/50";
  }
}

export function riskBarColor(grade: RiskGrade): string {
  switch (grade) {
    case "A": return "bg-emerald-500";
    case "B": return "bg-emerald-600";
    case "C": return "bg-amber-500";
    case "D": return "bg-orange-500";
    case "F": return "bg-red-500";
  }
}
