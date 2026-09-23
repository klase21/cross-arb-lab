// One-time backfill: past 1 year of hourly closes (Upbit/Binance/Bybit/OKX)
// -> per-day arb opportunity rollup in `arb_daily_stats`.
// Bithumb (max 200 candles, no pagination) and Coinone (no history API) are
// excluded from backfill; they accumulate via /api/collect-arb going forward.
//
// Usage:
//   node scripts/backfill-arb-stats.mjs [--coins=BTC,ETH] [--days=30] [--top=60]
//
// Reads DATABASE_URL from .env (or environment). ~20-40 min for 60 coins x 365d.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(root + "/package.json");
const { neon } = require("@neondatabase/serverless");

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), "1"];
  }),
);
const DAYS = Math.min(Math.max(parseInt(args.days ?? "365", 10) || 365, 1), 370);
const TOP_N = parseInt(args.top ?? "60", 10) || 60;
const COIN_FILTER = args.coins ? args.coins.split(",").map(s => s.trim().toUpperCase()) : null;

const FEES = { upbit: 0.05, binance: 0.1, bybit: 0.1, okx: 0.1 };
const KIMCHI_CUT = 1.0;
// Gross spreads beyond this are data errors (stale quote / listing chaos), not signal.
const GROSS_CAP = 25;
const HOUR = 3600_000;
const VENUES = ["upbit", "binance", "bybit", "okx"];

function loadEnv() {
  for (const f of [".env", ".env.local"]) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  }
}

async function getJson(url, timeoutMs = 20000, retries = 4) {
  let lastErr = null;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      // Unknown symbol / bad request: retrying never helps.
      if (res.status === 400 || res.status === 404) throw Object.assign(new Error(`HTTP ${res.status} (fatal)`), { fatal: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (e.fatal) throw e;
      lastErr = e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1) + Math.random() * 500));
    }
  }
  throw lastErr;
}

// --- Venue hourly-close fetchers: each returns Map<hourMsUtc, priceUsd> ---

async function fetchUpbit(coin, sinceMs) {
  const out = new Map();
  let to = null;
  for (let page = 0; page < 50; page++) {
    const url = `https://api.upbit.com/v1/candles/minutes/60?market=KRW-${coin}&count=200${to ? `&to=${encodeURIComponent(to)}` : ""}`;
    const data = await getJson(url);
    if (!Array.isArray(data) || data.length === 0) break;
    for (const c of data) {
      const t = Date.parse(c.candle_date_time_utc);
      if (Number.isNaN(t) || t < sinceMs) continue;
      const hour = Math.floor(t / HOUR) * HOUR;
      if (c.trade_price > 0 && !out.has(hour)) out.set(hour, c.trade_price); // KRW
    }
    const oldest = Math.min(...data.map(c => Date.parse(c.candle_date_time_utc)));
    if (oldest < sinceMs || data.length < 200) break;
    to = new Date(oldest - 1000).toISOString().slice(0, 19);
    await new Promise(r => setTimeout(r, 120));
  }
  return out;
}

async function fetchBinance(coin, sinceMs, nowMs) {
  const out = new Map();
  let start = sinceMs;
  for (let page = 0; page < 12; page++) {
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${coin}USDT&interval=1h&limit=1000&startTime=${start}&endTime=${nowMs}`;
    const data = await getJson(url);
    if (!Array.isArray(data) || data.length === 0) break;
    for (const k of data) {
      const hour = Math.floor(k[0] / HOUR) * HOUR;
      const close = parseFloat(k[4]);
      if (hour >= sinceMs && close > 0 && !out.has(hour)) out.set(hour, close);
    }
    const lastOpen = data[data.length - 1][0];
    if (lastOpen + HOUR >= nowMs || data.length < 1000) break;
    start = lastOpen + HOUR;
    await new Promise(r => setTimeout(r, 120));
  }
  return out;
}

async function fetchBybit(coin, sinceMs, nowMs) {
  const out = new Map();
  let end = nowMs;
  for (let page = 0; page < 12; page++) {
    const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${coin}USDT&interval=60&limit=1000&end=${end}`;
    const data = await getJson(url);
    const list = data?.result?.list ?? [];
    if (list.length === 0) break;
    for (const k of list) {
      const hour = Math.floor(Number(k[0]) / HOUR) * HOUR;
      const close = parseFloat(k[4]);
      if (hour >= sinceMs && hour < nowMs && close > 0 && !out.has(hour)) out.set(hour, close);
    }
    const oldest = Math.min(...list.map(k => Number(k[0])));
    if (oldest < sinceMs || list.length < 1000) break;
    end = oldest - HOUR;
    await new Promise(r => setTimeout(r, 150));
  }
  return out;
}

async function fetchOkx(coin, sinceMs, nowMs) {
  const out = new Map();
  let before = nowMs;
  for (let page = 0; page < 95; page++) {
    const url = `https://www.okx.com/api/v5/market/history-candles?instId=${coin}-USDT&bar=1H&limit=100&before=${before}`;
    const data = await getJson(url);
    const list = data?.data ?? [];
    if (list.length === 0) break;
    for (const k of list) {
      const hour = Math.floor(Number(k[0]) / HOUR) * HOUR;
      const close = parseFloat(k[4]);
      if (hour >= sinceMs && hour < nowMs && close > 0 && !out.has(hour)) out.set(hour, close);
    }
    const oldest = Math.min(...list.map(k => Number(k[0])));
    if (oldest < sinceMs || list.length < 100) break;
    before = oldest;
    await new Promise(r => setTimeout(r, 150));
  }
  return out;
}

const FETCHERS = { upbit: fetchUpbit, binance: fetchBinance, bybit: fetchBybit, okx: fetchOkx };

function kstDay(hourMs) {
  return new Date(hourMs + 9 * HOUR).toISOString().slice(0, 10);
}

async function main() {
  loadEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (.env or env)");
  const sql = neon(process.env.DATABASE_URL);
  const nowMs = Math.floor(Date.now() / HOUR) * HOUR;
  const sinceMs = nowMs - DAYS * 24 * HOUR;
  const todayKst = new Date(Date.now() + 9 * HOUR).toISOString().slice(0, 10);

  // Universe: top-N by Upbit 24h volume (same as /api/collect).
  const markets = await getJson("https://api.upbit.com/v1/market/all?isDetails=false");
  const krwMarkets = markets.map(m => m.market).filter(m => typeof m === "string" && m.startsWith("KRW-"));
  const tickers = await getJson(`https://api.upbit.com/v1/ticker?markets=${krwMarkets.join(",")}`);
  let coins = [...tickers]
    .sort((a, b) => (b.acc_trade_price_24h ?? 0) - (a.acc_trade_price_24h ?? 0))
    .slice(0, TOP_N)
    .map(t => t.market.replace("KRW-", ""))
    .filter(c => /^[A-Z0-9]{2,12}$/.test(c));
  if (COIN_FILTER) coins = COIN_FILTER.filter(c => /^[A-Z0-9]{2,12}$/.test(c));
  console.log(`universe: ${coins.length} coins, ${DAYS} days`);

  // USDT/KRW hourly (FX proxy for kimchi premium) — fetched once.
  const usdtKrw = await fetchUpbit("USDT", sinceMs);
  console.log(`USDT/KRW hours: ${usdtKrw.size}`);

  await sql`CREATE TABLE IF NOT EXISTS arb_daily_stats (
    day DATE NOT NULL, coin TEXT NOT NULL, type TEXT NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0, best_net DOUBLE PRECISION NOT NULL DEFAULT 0,
    PRIMARY KEY (day, coin, type))`;

  let done = 0;
  const CONC = 2;
  for (let i = 0; i < coins.length; i += CONC) {
    const batch = coins.slice(i, i + CONC);
    await Promise.all(batch.map(async coin => {
      try {
        const books = {};
        for (const v of VENUES) {
          books[v] = await FETCHERS[v](coin, sinceMs, nowMs).catch(err => {
            console.log(`  ${coin}/${v} failed: ${err.message}`);
            return new Map();
          });
        }
        // Convert Upbit KRW -> USD via hourly USDT/KRW.
        const hours = new Set();
        for (const v of VENUES) for (const h of books[v].keys()) hours.add(h);
        const daily = new Map(); // day -> {kimchi:{hits,best}, inventory:{hits,best}}
        const bump = (day, type, net) => {
          let e = daily.get(day);
          if (!e) { e = { kimchi: { hits: 0, best: 0 }, inventory: { hits: 0, best: 0 } }; daily.set(day, e); }
          e[type].hits += 1;
          if (net > e[type].best) e[type].best = net;
        };
        for (const h of hours) {
          const px = {};
          for (const v of VENUES) {
            const p = books[v].get(h);
            if (p === undefined) continue;
            px[v] = v === "upbit" ? (usdtKrw.get(h) ? p / usdtKrw.get(h) : null) : p;
            if (!px[v]) delete px[v];
          }
          const entries = Object.entries(px).filter(([, p]) => p > 0);
          if (entries.length < 2) continue;
          const day = kstDay(h);
          // Kimchi premium (Upbit vs Binance).
          if (px.upbit && px.binance) {
            const prem = ((px.upbit - px.binance) / px.binance) * 100;
            if (prem > KIMCHI_CUT && prem <= GROSS_CAP) bump(day, "kimchi", prem);
          }
          // Inventory: best net across venue pairs (one hit per hour max,
          // same semantics as the live 10-min collector: best per coin per scan).
          const sorted = [...entries].sort((a, b) => b[1] - a[1]);
          let bestNet = -Infinity;
          for (let a = 0; a < sorted.length; a++) {
            for (let b = a + 1; b < sorted.length; b++) {
              const [sellV, sellP] = sorted[a];
              const [buyV, buyP] = sorted[b];
              const gross = ((sellP - buyP) / buyP) * 100;
              if (gross > GROSS_CAP) continue; // bad quote, not signal
              const net = gross - (FEES[buyV] + FEES[sellV]) - 0.05;
              if (net > bestNet) bestNet = net;
            }
          }
          if (bestNet > 0.1) bump(day, "inventory", bestNet);
        }
        // Upsert this coin's daily rows (skip today: live collector owns it).
        // Delete-then-insert per coin makes reruns idempotent.
        await sql`DELETE FROM arb_daily_stats WHERE coin = ${coin} AND day < ${todayKst}::date`;
        const rows = [];
        for (const [day, e] of daily) {
          if (day >= todayKst) continue;
          if (e.kimchi.hits > 0) rows.push([day, coin, "kimchi", e.kimchi.hits, e.kimchi.best]);
          if (e.inventory.hits > 0) rows.push([day, coin, "inventory", e.inventory.hits, e.inventory.best]);
        }
        for (let c = 0; c < rows.length; c += 1000) {
          const chunk = rows.slice(c, c + 1000);
          await sql`
            INSERT INTO arb_daily_stats (day, coin, type, hits, best_net)
            SELECT * FROM UNNEST(
              ${chunk.map(r => r[0])}::date[],
              ${chunk.map(r => r[1])}::text[],
              ${chunk.map(r => r[2])}::text[],
              ${chunk.map(r => r[3])}::int[],
              ${chunk.map(r => r[4])}::float8[]
            ) AS t(day, coin, type, hits, best_net)
            ON CONFLICT (day, coin, type) DO UPDATE SET
              hits = arb_daily_stats.hits + EXCLUDED.hits,
              best_net = GREATEST(arb_daily_stats.best_net, EXCLUDED.best_net)`;
        }
        done += 1;
        console.log(`[${done}/${coins.length}] ${coin}: ${rows.length} day-rows`);
      } catch (err) {
        console.log(`[${done + 1}/${coins.length}] ${coin} ERROR: ${err.message}`);
        done += 1;
      }
    }));
  }
  console.log("backfill complete");
}

main().catch(err => { console.error("FATAL:", err.message); process.exit(1); });
