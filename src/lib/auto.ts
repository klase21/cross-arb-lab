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
