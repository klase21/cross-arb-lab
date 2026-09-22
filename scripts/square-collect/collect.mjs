// Binance Square collector (plain fetch, no browser needed).
// Scrapes trending + latest feeds and upserts into Neon `square_posts`.
// Usage: npm run collect:square   (needs DATABASE_URL in .env)
// Schedule: Windows Task Scheduler every 10 min (KimpRadar-Square-Collect).

import { neon } from "@neondatabase/serverless";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const envPath = path.join(__dirname, "..", "..", ".env");
    const raw = fs.readFileSync(envPath, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch {}
}

const HEADERS = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  Referer: "https://www.binance.com/en/square/trending",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(type, pageIndex) {
  const url = `https://www.binance.com/bapi/composite/v3/friendly/pgc/content/article/list?pageIndex=${pageIndex}&pageSize=20&type=${type}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`square list ${res.status}`);
  const data = await res.json();
  return data?.data?.vos ?? [];
}

function toMs(date) {
  if (!date) return Date.now();
  return date < 1_000_000_000_000 ? date * 1000 : date;
}

async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS square_posts (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL DEFAULT '',
      verified BOOLEAN NOT NULL DEFAULT FALSE,
      square_author_id TEXT,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      coin_pairs TEXT[] NOT NULL DEFAULT '{}',
      hashtags TEXT[] NOT NULL DEFAULT '{}',
      views INTEGER NOT NULL DEFAULT 0,
      likes INTEGER NOT NULL DEFAULT 0,
      post_ms BIGINT NOT NULL DEFAULT 0,
      url TEXT NOT NULL DEFAULT '',
      collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_square_posts_collected ON square_posts (collected_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_square_posts_author ON square_posts (square_author_id)`;
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

// Author profile contents (their own posts), up to 3 pages via timeOffset cursor.
async function fetchAuthorContents(squareUid, maxPages = 3) {
  const out = [];
  let timeOffset = -1;
  for (let p = 0; p < maxPages; p++) {
    const url = `https://www.binance.com/bapi/composite/v2/friendly/pgc/content/queryUserProfilePageContentsWithFilter?targetSquareUid=${encodeURIComponent(squareUid)}&timeOffset=${timeOffset}&filterType=ALL`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`author contents ${res.status}`);
    const data = await res.json();
    const contents = data?.data?.contents ?? [];
    for (const c of contents) {
      if (c.isReplyPost) continue;
      out.push({
        id: String(c.id),
        authorName: c.displayName || c.username || "unknown",
        authorIsVerified: (c.authorVerificationType ?? 0) > 0,
        squareAuthorId: c.squareUid || squareUid,
        title: c.title ?? "",
        content: c.bodyTextOnly || c.body || "",
        coinPairList: Array.isArray(c.coinPairList) ? c.coinPairList : [],
        hashtagList: Array.isArray(c.hashtagList) ? c.hashtagList : [],
        tradingPairsV2: Array.isArray(c.tradingPairsV2) ? c.tradingPairsV2 : [],
        viewCount: c.viewCount ?? 0,
        likeCount: c.likeCount ?? 0,
        date: c.createTime ?? Date.now(),
        webLink: c.webLink ?? `https://www.binance.com/en/square/post/${c.id}`,
        tendency: c.tendency ?? null,
      });
    }
    if (!data?.data?.isExistSecondPage) break;
    timeOffset = data.data.timeOffset;
    if (!timeOffset || timeOffset < 0) break;
    await sleep(500);
  }
  return out;
}

async function fetchAuthorProfile(squareUid) {
  const res = await fetch("https://www.binance.com/bapi/composite/v3/friendly/pgc/user/client", {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ squareUid, getFollowCount: true }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.data ?? null;
}

(async () => {
  loadEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing (.env)");
  const started = Date.now();
  const sql = neon(process.env.DATABASE_URL);
  await ensureTable(sql);

  // Trending (type=1, ~24h) + Latest (type=2, ~42h). 0.5s courtesy gap.
  const jobs = [];
  for (let p = 1; p <= 6; p++) jobs.push([1, p]);
  for (let p = 1; p <= 6; p++) jobs.push([2, p]);
  const seen = new Map();
  for (const [type, page] of jobs) {
    try {
      const vos = await fetchPage(type, page);
      if (vos.length === 0) break;
      for (const v of vos) {
        if (!v || v.id === undefined || v.id === null) continue;
        seen.set(String(v.id), v);
      }
    } catch (e) {
      console.error("page fail", type, page, e.message);
    }
    await sleep(500);
  }

  async function upsertPost(v) {
    const id = String(v.id);
    const pairs = Array.isArray(v.coinPairList) ? v.coinPairList.map(String).slice(0, 10) : [];
    const tags = Array.isArray(v.hashtagList) ? v.hashtagList.map(String).slice(0, 10) : [];
    const url = v.webLink ?? `https://www.binance.com/en/square/post/${id}`;
    const r = await sql`
      INSERT INTO square_posts (id, author, verified, square_author_id, title, content, coin_pairs, hashtags, views, likes, post_ms, url)
      VALUES (
        ${id}, ${String(v.authorName ?? v.displayName ?? v.username ?? "unknown")}, ${v.authorIsVerified === true || (v.authorVerificationType ?? 0) > 0},
        ${v.squareAuthorId ? String(v.squareAuthorId) : null},
        ${String(v.title ?? "")}, ${String(v.content ?? "")},
        ${pairs}, ${tags},
        ${Number(v.viewCount) || 0}, ${Number(v.likeCount) || 0},
        ${toMs(v.date ?? v.createTime)}, ${url}
      )
      ON CONFLICT (id) DO UPDATE SET
        views = EXCLUDED.views, likes = EXCLUDED.likes, collected_at = now()
      RETURNING (xmax = 0) AS is_new`;
    if (r.length > 0 && r[0].is_new) inserted++;
    else updated++;
  }

  let inserted = 0;
  let updated = 0;
  for (const v of seen.values()) {
    if (!v || v.id === undefined || v.id === null) continue;
    try {
      await upsertPost(v);
    } catch (e) {
      console.error("upsert fail", String(v.id), e.message);
    }
  }

  // Tracked traders: full post history per author (up to 3 pages each).
  let trackedPosts = 0;
  try {
    const tracked = await sql`SELECT square_uid FROM tracked_traders WHERE enabled = TRUE`;
    for (const row of tracked) {
      try {
        const contents = await fetchAuthorContents(row.square_uid, 3);
        for (const c of contents) {
          try {
            const before = inserted;
            await upsertPost(c);
            if (inserted > before) trackedPosts++;
          } catch {}
        }
        let followers = 0;
        let display = "";
        try {
          const prof = await fetchAuthorProfile(row.square_uid);
          if (prof) {
            followers = Number(prof.totalFollowerCount) || 0;
            display = String(prof.displayName || prof.username || "");
          }
        } catch {}
        if (followers > 0) {
          await sql`UPDATE tracked_traders SET followers = ${followers}, last_scraped_at = now() WHERE square_uid = ${row.square_uid}`;
        } else {
          await sql`UPDATE tracked_traders SET last_scraped_at = now() WHERE square_uid = ${row.square_uid}`;
        }
        if (display) {
          await sql`UPDATE tracked_traders SET display_name = ${display} WHERE square_uid = ${row.square_uid}`;
        }
      } catch (e) {
        console.error("author fail", row.square_uid, e.message);
      }
      await sleep(500);
    }
  } catch (e) {
    console.error("tracked fail", e.message);
  }

  await sql`DELETE FROM square_posts WHERE collected_at < now() - interval '14 days'`;
  console.log(JSON.stringify({ scraped: seen.size, inserted, updated, trackedPosts, ms: Date.now() - started }));
})().catch((e) => { console.error("COLLECT-ERR", e.message); process.exit(1); });
