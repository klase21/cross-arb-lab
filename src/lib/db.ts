import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let client: NeonQueryFunction<false, false> | null = null;

export function dbEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function getClient(): NeonQueryFunction<false, false> | null {
  if (!dbEnabled()) return null;
  if (!client) client = neon(process.env.DATABASE_URL!);
  return client;
}

export async function ensureSchema(): Promise<void> {
  const sql = getClient();
  if (!sql) throw new Error("DATABASE_URL is not set");
  await sql`
    CREATE TABLE IF NOT EXISTS price_history (
      symbol TEXT NOT NULL,
      exchange TEXT NOT NULL,
      price_usd DOUBLE PRECISION NOT NULL,
      price_krw DOUBLE PRECISION NOT NULL,
      volume_usd DOUBLE PRECISION,
      collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (symbol, exchange, collected_at)
    )`;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_ph_lookup
    ON price_history (symbol, collected_at DESC)`;
}

export interface PriceRow {
  symbol: string;
  exchange: string;
  priceUsd: number;
  priceKrw: number;
  volumeUsd: number | null;
  collectedAt: string;
}

export async function insertPrices(
  rows: { symbol: string; exchange: string; priceUsd: number; priceKrw: number; volumeUsd: number | null }[],
  collectedAt: Date,
): Promise<number> {
  const sql = getClient();
  if (!sql || rows.length === 0) return 0;
  const values = rows.map(r => [r.symbol, r.exchange, r.priceUsd, r.priceKrw, r.volumeUsd, collectedAt.toISOString()]);
  // Bulk insert via unnest to keep it to a single round trip.
  const result = await sql`
    INSERT INTO price_history (symbol, exchange, price_usd, price_krw, volume_usd, collected_at)
    SELECT * FROM UNNEST(
      ${values.map(v => v[0])}::text[],
      ${values.map(v => v[1])}::text[],
      ${values.map(v => v[2])}::float8[],
      ${values.map(v => v[3])}::float8[],
      ${values.map(v => v[4])}::float8[],
      ${values.map(v => v[5])}::timestamptz[]
    ) AS t(symbol, exchange, price_usd, price_krw, volume_usd, collected_at)
    ON CONFLICT DO NOTHING
    RETURNING 1`;
  return Array.isArray(result) ? result.length : 0;
}

export async function pruneHistory(retentionDays: number): Promise<void> {
  const sql = getClient();
  if (!sql) return;
  await sql`
    DELETE FROM price_history
    WHERE collected_at < now() - (${retentionDays}::int * interval '1 day')`;
}

export async function queryHistory(symbol: string, sinceIso: string): Promise<PriceRow[]> {
  const sql = getClient();
  if (!sql) return [];
  const rows = (await sql`
    SELECT symbol, exchange, price_usd AS "priceUsd", price_krw AS "priceKrw",
           volume_usd AS "volumeUsd", collected_at AS "collectedAt"
    FROM price_history
    WHERE symbol = ${symbol.toUpperCase()} AND collected_at >= ${sinceIso}::timestamptz
    ORDER BY collected_at ASC`) as PriceRow[];
  return rows;
}

export async function historyStatus(): Promise<{ enabled: boolean; latest: string | null; rows7d: number }> {
  const sql = getClient();
  if (!sql) return { enabled: false, latest: null, rows7d: 0 };
  try {
    const latest = (await sql`SELECT max(collected_at) AS m FROM price_history`) as { m: string | null }[];
    const count = (await sql`SELECT count(*)::int AS c FROM price_history WHERE collected_at > now() - interval '7 days'`) as { c: number }[];
    return { enabled: true, latest: latest[0]?.m ?? null, rows7d: count[0]?.c ?? 0 };
  } catch {
    return { enabled: true, latest: null, rows7d: 0 };
  }
}

// --- Daily arb-opportunity rollup (1-year retention, tiny) ---
// One row per (day, coin, type). `hits` = number of 10-min scans that day
// where the opportunity was observable; `bestNet` = max net pct seen.

export type ArbStatType = "kimchi" | "inventory";

export async function ensureArbStatsSchema(): Promise<void> {
  const sql = getClient();
  if (!sql) throw new Error("DATABASE_URL is not set");
  await sql`
    CREATE TABLE IF NOT EXISTS arb_daily_stats (
      day DATE NOT NULL,
      coin TEXT NOT NULL,
      type TEXT NOT NULL,
      hits INTEGER NOT NULL DEFAULT 0,
      best_net DOUBLE PRECISION NOT NULL DEFAULT 0,
      PRIMARY KEY (day, coin, type)
    )`;
}

export async function upsertArbDaily(
  dayIso: string,
  rows: { coin: string; type: ArbStatType; net: number }[],
): Promise<number> {
  const sql = getClient();
  if (!sql || rows.length === 0) return 0;
  const result = await sql`
    INSERT INTO arb_daily_stats (day, coin, type, hits, best_net)
    SELECT * FROM UNNEST(
      ${rows.map(() => dayIso)}::date[],
      ${rows.map(r => r.coin)}::text[],
      ${rows.map(r => r.type)}::text[],
      ${rows.map(() => 1)}::int[],
      ${rows.map(r => r.net)}::float8[]
    ) AS t(day, coin, type, hits, best_net)
    ON CONFLICT (day, coin, type) DO UPDATE SET
      hits = arb_daily_stats.hits + 1,
      best_net = GREATEST(arb_daily_stats.best_net, EXCLUDED.best_net)
    RETURNING 1`;
  return Array.isArray(result) ? result.length : 0;
}

export async function pruneArbStats(retentionDays: number): Promise<void> {
  const sql = getClient();
  if (!sql) return;
  await sql`
    DELETE FROM arb_daily_stats
    WHERE day < CURRENT_DATE - (${retentionDays}::int * interval '1 day')`;
}

export interface ArbStatRow {
  day: string;
  coin: string;
  type: string;
  hits: number;
  bestNet: number;
}

// --- TA snapshots (latest-only per symbol+interval; screener serves from DB) ---

export async function ensureTaSchema(): Promise<void> {
  const sql = getClient();
  if (!sql) throw new Error("DATABASE_URL is not set");
  await sql`
    CREATE TABLE IF NOT EXISTS ta_snapshots (
      symbol TEXT NOT NULL,
      interval TEXT NOT NULL,
      bias TEXT NOT NULL,
      score DOUBLE PRECISION NOT NULL,
      reading JSONB NOT NULL,
      collected_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (symbol, interval)
    )`;
}

export async function upsertTaSnapshots(
  rows: { symbol: string; interval: string; bias: string; score: number; reading: unknown }[],
  collectedAt: Date,
): Promise<number> {
  const sql = getClient();
  if (!sql || rows.length === 0) return 0;
  const at = collectedAt.toISOString();
  const result = await sql`
    INSERT INTO ta_snapshots (symbol, interval, bias, score, reading, collected_at)
    SELECT * FROM UNNEST(
      ${rows.map(r => r.symbol)}::text[],
      ${rows.map(r => r.interval)}::text[],
      ${rows.map(r => r.bias)}::text[],
      ${rows.map(r => r.score)}::float8[],
      ${rows.map(r => JSON.stringify(r.reading))}::jsonb[],
      ${rows.map(() => at)}::timestamptz[]
    ) AS t(symbol, interval, bias, score, reading, collected_at)
    ON CONFLICT (symbol, interval) DO UPDATE SET
      bias = EXCLUDED.bias,
      score = EXCLUDED.score,
      reading = EXCLUDED.reading,
      collected_at = EXCLUDED.collected_at
    RETURNING 1`;
  return Array.isArray(result) ? result.length : 0;
}

export async function queryTaLatest(
  interval: string,
  maxAgeMin: number,
  minRows: number,
): Promise<{ readings: unknown[]; collectedAt: string } | null> {
  const sql = getClient();
  if (!sql) return null;
  const rows = (await sql`
    SELECT reading, collected_at AS "collectedAt"
    FROM ta_snapshots
    WHERE interval = ${interval}
      AND collected_at > now() - (${maxAgeMin}::int * interval '1 minute')
    ORDER BY abs(score) DESC`) as { reading: unknown; collectedAt: string }[];
  if (rows.length < minRows) return null;
  return { readings: rows.map(r => r.reading), collectedAt: rows[0]?.collectedAt ?? new Date().toISOString() };
}
export async function queryArbStats(coin: string | null, sinceIso: string): Promise<ArbStatRow[]> {
  const sql = getClient();
  if (!sql) return [];
  const rows = coin
    ? await sql`
        SELECT day::text AS day, coin, type, hits, best_net AS "bestNet"
        FROM arb_daily_stats
        WHERE coin = ${coin.toUpperCase()} AND day >= ${sinceIso}::date
        ORDER BY day ASC`
    : await sql`
        SELECT day::text AS day, coin, type, hits, best_net AS "bestNet"
        FROM arb_daily_stats
        WHERE day >= ${sinceIso}::date
        ORDER BY day ASC`;
  return rows as ArbStatRow[];
}
