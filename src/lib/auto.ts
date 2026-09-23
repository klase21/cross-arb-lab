// Auto paper-trader rules: pure decision layer. Spot pairs trigger on kimchi
// premium; funding positions trigger on cross-venue APR spread. Execution is
// delegated to the paper engine (real-order executors plug in later with the
// same decision output). Cooldowns prevent overtrading the same coin.

export interface SpotOpportunity {
  coin: string;
  premiumPct: number;
  upbitBidUsd: number;
  upbitAskUsd: number;
  binBidUsd: number;
  binAskUsd: number;
}

export interface FundingOpportunity {
  base: string;
  spreadApr: number;
  longVenue: string;
  shortVenue: string;
  longMark: number | null;
  shortMark: number | null;
}

export interface AutoConfig {
  enabled: boolean;
  spotEnabled: boolean;
  fundingEnabled: boolean;
  spotThresholdPct: number;
  fundingThresholdApr: number;
  fundingExitApr: number;
  spotNotionalUsd: number;
  fundingNotionalUsd: number;
  cooldownMin: number;
  maxSpotPerCycle: number;
  maxFundingOpen: number;
}

const CONFIG_KEY = "paperAutoConfig";
const COOLDOWN_KEY = "paperAutoCooldown";
const STATUS_KEY = "paperAutoStatus";

export interface AutoStatus {
  lastTick: number | null;
  cycles: number;
  spotFills: number;
  fundOpens: number;
  fundCloses: number;
}

export function loadAutoStatus(): AutoStatus {
  const empty: AutoStatus = { lastTick: null, cycles: 0, spotFills: 0, fundOpens: 0, fundCloses: 0 };
  if (typeof window === "undefined") return empty;
  try {
    const raw = localStorage.getItem(STATUS_KEY);
    if (raw) return { ...empty, ...JSON.parse(raw) };
  } catch {}
  return empty;
}

export function saveAutoStatus(s: AutoStatus): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify(s));
  } catch {}
}

export const DEFAULT_AUTO_CONFIG: AutoConfig = {
  enabled: false,
  spotEnabled: true,
  fundingEnabled: true,
  spotThresholdPct: 2,
  fundingThresholdApr: 50,
  fundingExitApr: 15,
  spotNotionalUsd: 500,
  fundingNotionalUsd: 1000,
  cooldownMin: 60,
  maxSpotPerCycle: 3,
  maxFundingOpen: 5,
};

export type PresetId = "conservative" | "balanced" | "aggressive";

export const AUTO_PRESETS: Record<PresetId, Omit<AutoConfig, "enabled">> = {
  conservative: {
    spotEnabled: true,
    fundingEnabled: true,
    spotThresholdPct: 3,
    fundingThresholdApr: 100,
    fundingExitApr: 20,
    spotNotionalUsd: 300,
    fundingNotionalUsd: 500,
    cooldownMin: 120,
    maxSpotPerCycle: 2,
    maxFundingOpen: 3,
  },
  balanced: {
    spotEnabled: true,
    fundingEnabled: true,
    spotThresholdPct: 2,
    fundingThresholdApr: 50,
    fundingExitApr: 15,
    spotNotionalUsd: 500,
    fundingNotionalUsd: 1000,
    cooldownMin: 60,
    maxSpotPerCycle: 3,
    maxFundingOpen: 5,
  },
  aggressive: {
    spotEnabled: true,
    fundingEnabled: true,
    spotThresholdPct: 1,
    fundingThresholdApr: 30,
    fundingExitApr: 10,
    spotNotionalUsd: 1000,
    fundingNotionalUsd: 2000,
    cooldownMin: 30,
    maxSpotPerCycle: 5,
    maxFundingOpen: 8,
  },
};

/** Which preset the config currently matches (null = custom tweaks). */
export function matchPreset(cfg: AutoConfig): PresetId | null {
  for (const id of Object.keys(AUTO_PRESETS) as PresetId[]) {
    const p = AUTO_PRESETS[id];
    if (
      p.spotEnabled === cfg.spotEnabled &&
      p.fundingEnabled === cfg.fundingEnabled &&
      p.spotThresholdPct === cfg.spotThresholdPct &&
      p.fundingThresholdApr === cfg.fundingThresholdApr &&
      p.fundingExitApr === cfg.fundingExitApr &&
      p.spotNotionalUsd === cfg.spotNotionalUsd &&
      p.fundingNotionalUsd === cfg.fundingNotionalUsd &&
      p.cooldownMin === cfg.cooldownMin &&
      p.maxSpotPerCycle === cfg.maxSpotPerCycle &&
      p.maxFundingOpen === cfg.maxFundingOpen
    ) {
      return id;
    }
  }
  return null;
}

export function loadAutoConfig(): AutoConfig {
  if (typeof window === "undefined") return DEFAULT_AUTO_CONFIG;
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_AUTO_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_AUTO_CONFIG;
}

export function saveAutoConfig(cfg: AutoConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch {}
}

function loadCooldowns(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(COOLDOWN_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function saveCooldowns(map: Record<string, number>): void {
  try {
    localStorage.setItem(COOLDOWN_KEY, JSON.stringify(map));
  } catch {}
}

export function isCooledDown(key: string, cooldownMin: number): boolean {
  const map = loadCooldowns();
  const last = map[key] ?? 0;
  return Date.now() - last >= cooldownMin * 60 * 1000;
}

export function markTraded(key: string): void {
  const map = loadCooldowns();
  map[key] = Date.now();
  saveCooldowns(map);
}

/** Spot candidates: premium above threshold, strongest first. */
export function pickSpot(
  opportunities: SpotOpportunity[],
  cfg: AutoConfig,
): SpotOpportunity[] {
  if (!cfg.enabled || !cfg.spotEnabled) return [];
  return opportunities
    .filter(o => o.premiumPct >= cfg.spotThresholdPct && o.upbitAskUsd > 0 && o.binBidUsd > 0)
    .filter(o => isCooledDown(`spot:${o.coin}`, cfg.cooldownMin))
    .sort((a, b) => b.premiumPct - a.premiumPct)
    .slice(0, cfg.maxSpotPerCycle);
}

/** Funding candidates: spread above entry threshold with both marks known. */
export function pickFunding(
  opportunities: FundingOpportunity[],
  openCount: number,
  cfg: AutoConfig,
): FundingOpportunity[] {
  if (!cfg.enabled || !cfg.fundingEnabled) return [];
  if (openCount >= cfg.maxFundingOpen) return [];
  return opportunities
    .filter(o => o.spreadApr >= cfg.fundingThresholdApr && o.longMark !== null && o.shortMark !== null)
    .filter(o => isCooledDown(`fund:${o.base}`, cfg.cooldownMin))
    .sort((a, b) => b.spreadApr - a.spreadApr)
    .slice(0, Math.max(0, cfg.maxFundingOpen - openCount));
}

/** Funding exits: spread collapsed below the exit threshold. */
export function pickFundingExits(
  open: { base: string }[],
  live: Map<string, number>,
  cfg: AutoConfig,
): string[] {
  if (!cfg.enabled || !cfg.fundingEnabled) return [];
  return open
    .filter(p => {
      const spread = live.get(p.base);
      return spread !== undefined && spread < cfg.fundingExitApr;
    })
    .map(p => p.base);
}
