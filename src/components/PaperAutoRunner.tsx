"use client";

import { useEffect, useRef } from "react";
import {
  isCooledDown,
  loadAutoConfig,
  loadAutoStatus,
  markTraded,
  pickFunding,
  pickFundingExits,
  pickSpot,
  saveAutoStatus,
  type FundingOpportunity,
  type SpotOpportunity,
} from "@/lib/auto";
import {
  accrueFunding,
  closeFunding,
  executeMarket,
  executePair,
  loadAccount,
  openFunding,
  recordEquity,
  saveAccount,
  valuate,
} from "@/lib/paper";
import { notifyBrowser } from "@/lib/notifications";

// Always-mounted background worker: turns detected opportunities into paper
// fills on a 2-minute cycle. Real-order executors plug in where executePair /
// openFunding / closeFunding are called.
export default function PaperAutoRunner() {
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (running.current || cancelled) return;
      const cfg = loadAutoConfig();
      if (!cfg.enabled) return;
      const account = loadAccount();
      if (!account) return;
      running.current = true;
      const status = loadAutoStatus();
      status.cycles += 1;
      try {
        // --- spot legs from kimchi ---
        try {
          const res = await fetch("/api/kimchi");
          if (res.ok) {
            const data = await res.json();
            const fx = typeof data.fxRate === "number" && data.fxRate > 500 ? data.fxRate : 1386;
            const opps: SpotOpportunity[] = ((data.items ?? []) as {
              coin: string; premiumPct: number; upbitAsk?: number; upbitBid?: number;
              upbitKrw: number; globalAsk?: number; globalBid?: number; globalUsd: number;
            }[])
              .filter(i => i.premiumPct >= cfg.spotThresholdPct || i.premiumPct <= -cfg.spotThresholdPct)
              .map(i => ({
                coin: i.coin,
                premiumPct: i.premiumPct,
                upbitBidUsd: (i.upbitBid ?? i.upbitKrw) / fx,
                upbitAskUsd: (i.upbitAsk ?? i.upbitKrw) / fx,
                binBidUsd: i.globalBid ?? i.globalUsd,
                binAskUsd: i.globalAsk ?? i.globalUsd,
              }));
            const longPrem = pickSpot(opps.filter(o => o.premiumPct > 0), cfg);
            const shortPrem = opps
              .filter(o => o.premiumPct <= -cfg.spotThresholdPct && o.upbitAskUsd > 0 && o.binBidUsd > 0)
              .filter(o => isCooledDown(`spot:${o.coin}`, cfg.cooldownMin))
              .sort((a, b) => a.premiumPct - b.premiumPct)
              .slice(0, cfg.maxSpotPerCycle);
            let acc = loadAccount() ?? account;
            const tradePair = (
              o: SpotOpportunity,
              buyVenue: "upbit" | "binance",
              buyPrice: number,
              sellVenue: "upbit" | "binance",
              sellPrice: number,
            ) => {
              const qty = cfg.spotNotionalUsd / buyPrice;
              if (!(qty > 0)) return;
              // Bootstrap sell-side inventory first if needed (visible as its own fill).
              const inv = acc.positions.find(p => p.venue === sellVenue && p.coin === o.coin);
              if (!inv || inv.qty < qty - 1e-12) {
                const boot = executeMarket(acc, { venue: sellVenue, coin: o.coin, bidUsd: sellPrice, askUsd: sellPrice }, "buy", qty, `auto-inventory:${o.coin}`);
                if ("error" in boot) return;
                acc = boot.account;
              }
              const result = executePair(
                acc,
                { venue: buyVenue, coin: o.coin, bidUsd: buyPrice, askUsd: buyPrice },
                { venue: sellVenue, coin: o.coin, bidUsd: sellPrice, askUsd: sellPrice },
                qty,
                `auto:${o.coin}`,
              );
              if (!("error" in result)) {
                acc = result.account;
                status.spotFills += 2;
                markTraded(`spot:${o.coin}`);
                notifyBrowser(
                  `Auto PAPER ${o.coin}`,
                  `${buyVenue} buy → ${sellVenue} sell ${qty.toPrecision(4)} @ prem ${o.premiumPct.toFixed(2)}%`,
                  `auto-spot-${o.coin}`,
                );
              }
            };
            for (const o of longPrem) tradePair(o, "upbit", o.upbitAskUsd, "binance", o.binBidUsd);
            for (const o of shortPrem) tradePair(o, "binance", o.binAskUsd, "upbit", o.upbitBidUsd);
            saveAccount(acc);
          }
        } catch {}

        // --- funding legs ---
        try {
          const res = await fetch("/api/futures/funding");
          if (res.ok) {
            const data = await res.json();
            const rows = ((data.rows ?? []) as {
              base: string; longVenue: string; shortVenue: string; spreadApr: number;
              quotes: { venue: string; apr: number; mark: number | null }[];
            }[]);
            const live = new Map<string, number>(rows.map(r => [r.base, r.spreadApr]));
            const opps: FundingOpportunity[] = [];
            for (const r of rows) {
              const lq = r.quotes.find(q => q.venue === r.longVenue);
              const sq = r.quotes.find(q => q.venue === r.shortVenue);
              if (lq && sq) {
                opps.push({
                  base: r.base, spreadApr: r.spreadApr,
                  longVenue: r.longVenue, shortVenue: r.shortVenue,
                  longMark: lq.mark, shortMark: sq.mark,
                });
              }
            }
            let acc = loadAccount() ?? account;
            const now = Date.now();
            // Accrue + exits on existing positions.
            const qmap = new Map(rows.map(r => [r.base, r]));
            if (acc.funding.length > 0) {
              acc = {
                ...acc,
                funding: acc.funding.map(f => {
                  const q = qmap.get(f.base);
                  if (!q) return f;
                  const lq = q.quotes.find(x => x.venue === f.longVenue);
                  const sq = q.quotes.find(x => x.venue === f.shortVenue);
                  return accrueFunding(f, lq?.apr ?? 0, sq?.apr ?? 0, now);
                }),
                updatedAt: now,
              };
              const spreadByBase = live;
              for (const base of pickFundingExits(acc.funding, spreadByBase, cfg)) {
                const pos = acc.funding.find(f => f.base === base);
                const q = qmap.get(base);
                if (!pos || !q) continue;
                const lq = q.quotes.find(x => x.venue === pos.longVenue);
                const sq = q.quotes.find(x => x.venue === pos.shortVenue);
                if (!lq || !sq || lq.mark === null || sq.mark === null) continue;
                const closed = closeFunding(acc, pos.id, {
                  longApr: lq.apr, shortApr: sq.apr, longMark: lq.mark, shortMark: sq.mark,
                }, Date.now());
                if (!("error" in closed)) {
                  acc = closed.account;
                  status.fundCloses += 1;
                  notifyBrowser(`Auto PAPER close ${base}`, `funding PnL ${closed.closed.pnlUsd >= 0 ? "+" : ""}${closed.closed.pnlUsd.toFixed(2)}`, `auto-fund-${base}`);
                }
              }
              saveAccount(acc);
            }
            // Entries.
            const picks = pickFunding(opps, acc.funding.length, cfg);
            for (const o of picks) {
              if (o.longMark === null || o.shortMark === null) continue;
              const opened = openFunding(acc, {
                base: o.base, longVenue: o.longVenue, shortVenue: o.shortVenue,
                notionalUsd: cfg.fundingNotionalUsd, longMark: o.longMark, shortMark: o.shortMark,
              });
              if (!("error" in opened)) {
                acc = opened.account;
                status.fundOpens += 1;
                markTraded(`fund:${o.base}`);
                notifyBrowser(`Auto PAPER fund ${o.base}`, `L ${o.longVenue} / S ${o.shortVenue} ${o.spreadApr.toFixed(0)}% APR`, `auto-fund-${o.base}`);
              }
            }
            saveAccount(acc);
            try {
              const eq = valuate(acc, () => null);
              recordEquity(eq.equityUsd);
            } catch {}
          }
        } catch {}
      } finally {
        status.lastTick = Date.now();
        try { saveAutoStatus(status); } catch {}
        running.current = false;
      }
    };

    const kickoff = setTimeout(() => { void tick(); }, 15000);
    const timer = setInterval(() => { void tick(); }, 120 * 1000);
    return () => { cancelled = true; clearTimeout(kickoff); clearInterval(timer); };
  }, []);

  return null;
}
