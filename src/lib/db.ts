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
