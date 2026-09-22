import { NextResponse } from "next/server";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { BINANCE_BAPI } from "@/lib/binance";

export const dynamic = "force-dynamic";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

type Sql = NeonQueryFunction<false, false>;

function getSql(): Sql | null {
  if (!process.env.DATABASE_URL) return null;
  return neon(process.env.DATABASE_URL);
}

async function ensureTable(sql: Sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS tracked_traders (
      square_uid TEXT PRIMARY KEY,
      username TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      followers INTEGER NOT NULL DEFAULT 0,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_scraped_at TIMESTAMPTZ
    )`;
}

export async function GET() {
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 503 });
  try {
    await ensureTable(sql);
    const traders = (await sql`
      SELECT t.square_uid AS "squareUid", t.username, t.display_name AS "displayName",
             t.followers, t.enabled, t.added_at AS "addedAt", t.last_scraped_at AS "lastScrapedAt",
             (SELECT count(*)::int FROM square_posts p WHERE p.square_author_id = t.square_uid) AS "postCount"
      FROM tracked_traders t
      ORDER BY t.followers DESC`) as {
      squareUid: string; username: string; displayName: string;
      followers: number; enabled: boolean; addedAt: string; lastScrapedAt: string | null;
      postCount: number;
    }[];
    return NextResponse.json({ traders, timestamp: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "track failed" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 503 });
  try {
    const body = (await req.json()) as { input?: string };
    const input = (body.input ?? "").trim();
    if (!input) return NextResponse.json({ error: "input required" }, { status: 400 });

    // Accept raw squareUid, profile URL, or username. UID shape varies, so try
    // squareUid lookup first and fall back to username.
    interface ProfileData { squareUid?: string; displayName?: string; username?: string; totalFollowerCount?: number }
    const profile = async (body: Record<string, unknown>): Promise<ProfileData | null> => {
      const res = await fetch(`${BINANCE_BAPI}/bapi/composite/v3/friendly/pgc/user/client`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA, Referer: "https://www.binance.com/en/square/trending" },
        body: JSON.stringify({ getFollowCount: true, ...body }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { data?: ProfileData };
      return data.data ?? null;
    };

    await ensureTable(sql);
    let found: ProfileData | null = null;
    let username = "";
    if (/^[A-Za-z0-9_-]{8,64}$/.test(input)) {
      found = await profile({ squareUid: input });
    }
    if (!found) {
      const urlMatch = input.match(/square\/profile\/([A-Za-z0-9_.-]+)/i);
      username = urlMatch ? urlMatch[1] : input.replace(/^@/, "");
      found = await profile({ username });
    }
    if (!found?.squareUid) return NextResponse.json({ error: "trader not found" }, { status: 404 });
    const squareUid: string = found.squareUid;
    await sql`
      INSERT INTO tracked_traders (square_uid, username, display_name, followers)
      VALUES (${squareUid}, ${String(found.username ?? username)}, ${String(found.displayName ?? username)}, ${Number(found.totalFollowerCount) || 0})
      ON CONFLICT (square_uid) DO UPDATE SET enabled = TRUE, username = EXCLUDED.username`;
    return NextResponse.json({ ok: true, squareUid });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "track failed" }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 503 });
  try {
    const uid = new URL(req.url).searchParams.get("uid") ?? "";
    if (!uid) return NextResponse.json({ error: "uid required" }, { status: 400 });
    await ensureTable(sql);
    await sql`UPDATE tracked_traders SET enabled = FALSE WHERE square_uid = ${uid}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "track failed" }, { status: 502 });
  }
}
