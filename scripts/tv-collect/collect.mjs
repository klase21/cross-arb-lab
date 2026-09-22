// TradingView crypto ideas collector (headless, local/VPS only — NOT Vercel).
// Scrapes the recent ideas stream and upserts into Neon `tv_ideas`.
// Usage: npm run collect:tv   (needs DATABASE_URL in .env)
// Schedule: Windows Task Scheduler every 30 min (see README section below).

import { chromium } from "playwright";
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

async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS tv_ideas (
      url TEXT PRIMARY KEY,
      author TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      symbol_hint TEXT,
      likes INTEGER,
      published_at TIMESTAMPTZ,
      collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tv_ideas_collected ON tv_ideas (collected_at DESC)`;
}

async function scrape() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
  });
  await page.goto("https://www.tradingview.com/markets/cryptocurrencies/ideas/?sort=recent", {
    waitUntil: "domcontentloaded", timeout: 60000,
  });
  await page.waitForTimeout(7000);
  const challenge = await page.locator("text=Just a moment, text=Verify you are human").count().catch(() => 0);
  if (challenge > 0) throw new Error("cloudflare challenge hit — retry later or use a logged-in session");

  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(3500);
  }

  const ideas = await page.evaluate(() => {
    const seen = new Map();
    const links = document.querySelectorAll('a[href*="/chart/"]');
    for (const a of links) {
      let href = a.getAttribute("href") || "";
      if (!href) continue;
      if (href.startsWith("/")) href = "https://www.tradingview.com" + href;
      const m = href.match(/\/chart\/([^/]+)\/([A-Za-z0-9_-]+)-/);
      if (!m) continue;
      const url = href.split("#")[0];
      if (seen.has(url)) continue;
      const card = a.closest("article") || a.parentElement;
      const text = ((card && card.innerText) || "").trim().replace(/\s+/g, " ");
      if (text.length < 40) continue;
      let author = "";
      try {
        const u = card ? card.querySelector('a[href^="/u/"]') : null;
        if (u) author = (u.textContent || "").trim().slice(0, 80);
      } catch {}
      let published = "";
      try {
        const t = card ? card.querySelector("time[datetime]") : null;
        if (t) published = t.getAttribute("datetime") || "";
      } catch {}
      seen.set(url, {
        url,
        symbol: m[1].toUpperCase().slice(0, 20),
        title: text.slice(0, 200),
        text: text.slice(0, 1500),
        author,
        published,
      });
      if (seen.size >= 80) break;
    }
    return [...seen.values()];
  });
  await browser.close();
  return ideas;
}

(async () => {
  loadEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing (.env)");
  const started = Date.now();
  const ideas = await scrape();
  const sql = neon(process.env.DATABASE_URL);
  await ensureTable(sql);
  let inserted = 0;
  for (const idea of ideas) {
    const pub = idea.published && !Number.isNaN(Date.parse(idea.published)) ? new Date(idea.published).toISOString() : null;
    const r = await sql`
      INSERT INTO tv_ideas (url, author, title, text, symbol_hint, published_at)
      VALUES (${idea.url}, ${idea.author}, ${idea.title}, ${idea.text}, ${idea.symbol}, ${pub})
      ON CONFLICT (url) DO NOTHING
      RETURNING 1`;
    inserted += r.length;
  }
  // Keep 30 days.
  await sql`DELETE FROM tv_ideas WHERE collected_at < now() - interval '30 days'`;
  console.log(JSON.stringify({ scraped: ideas.length, inserted, ms: Date.now() - started }));
})().catch((e) => { console.error("COLLECT-ERR", e.message); process.exit(1); });
