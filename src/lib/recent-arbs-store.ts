import type { ArbitrageOpportunity } from "./types";

export interface RecentArbEntry {
  key: string;
  pair: string;
  buyChain: string;
  sellChain: string;
  buyDex: string;
  sellDex: string;
  buyCoin: string;
  direction?: string;
  netSpreadPct: number;
  estimatedProfitUsd: number;
  firstSeen: string;
  lastSeen: string;
  seenCount: number;
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_ENTRIES = 300;

// module-level store (per server process)
const store = new Map<string, RecentArbEntry>();

function keyOf(opp: ArbitrageOpportunity): string {
  return `${opp.pair}|${opp.buyChain}|${opp.sellChain}|${opp.direction ?? "dexToDex"}`;
}

export function recordOpportunities(opportunities: ArbitrageOpportunity[]): void {
  const now = new Date().toISOString();
  for (const opp of opportunities) {
    const key = keyOf(opp);
    const existing = store.get(key);
    if (existing) {
      existing.lastSeen = now;
      existing.seenCount += 1;
      existing.netSpreadPct = opp.netSpreadPct;
      existing.estimatedProfitUsd = opp.estimatedProfitUsd;
    } else {
      store.set(key, {
        key,
        pair: opp.pair,
        buyChain: opp.buyChain,
        sellChain: opp.sellChain,
        buyDex: opp.buyDex,
        sellDex: opp.sellDex,
        buyCoin: opp.buyCoin,
        direction: opp.direction,
        netSpreadPct: opp.netSpreadPct,
        estimatedProfitUsd: opp.estimatedProfitUsd,
        firstSeen: now,
        lastSeen: now,
        seenCount: 1,
      });
    }
  }
  // prune
  const cutoff = Date.now() - TTL_MS;
  for (const [key, entry] of store) {
    if (Date.parse(entry.lastSeen) < cutoff) store.delete(key);
  }
  if (store.size > MAX_ENTRIES) {
    const sorted = [...store.values()].sort((a, b) => Date.parse(a.lastSeen) - Date.parse(b.lastSeen));
    for (let i = 0; i < store.size - MAX_ENTRIES; i++) store.delete(sorted[i].key);
  }
}

export function getRecentArbs(hours = 24): RecentArbEntry[] {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return [...store.values()]
    .filter(entry => Date.parse(entry.lastSeen) >= cutoff)
    .sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
}
