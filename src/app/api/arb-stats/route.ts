import { NextResponse } from "next/server";
import { dbEnabled, queryArbStats } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!dbEnabled()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 503 });
  }
  const params = new URL(req.url).searchParams;
  const coin = (params.get("coin") ?? "").toUpperCase() || null;
  const days = Math.min(Math.max(Number(params.get("days")) || 365, 1), 365);
  const sinceIso = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  const rows = await queryArbStats(coin, sinceIso);

  if (coin) {
    // Merge both types per day.
    const byDay = new Map<string, { kimchiHits: number; kimchiBest: number; invHits: number; invBest: number }>();
    for (const r of rows) {
      const e = byDay.get(r.day) ?? { kimchiHits: 0, kimchiBest: 0, invHits: 0, invBest: 0 };
      if (r.type === "kimchi") { e.kimchiHits += r.hits; e.kimchiBest = Math.max(e.kimchiBest, r.bestNet); }
      else { e.invHits += r.hits; e.invBest = Math.max(e.invBest, r.bestNet); }
      byDay.set(r.day, e);
    }
    const daily = [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, v]) => ({ day, ...v }));
    const summary = daily.reduce(
      (s, d) => ({
        kimchiHits: s.kimchiHits + d.kimchiHits,
        kimchiBest: Math.max(s.kimchiBest, d.kimchiBest),
        invHits: s.invHits + d.invHits,
        invBest: Math.max(s.invBest, d.invBest),
        activeDays: s.activeDays + (d.kimchiHits + d.invHits > 0 ? 1 : 0),
      }),
      { kimchiHits: 0, kimchiBest: 0, invHits: 0, invBest: 0, activeDays: 0 },
    );
    return NextResponse.json({ coin, days, daily, summary });
  }

  // Leaderboard: per-coin totals across all types.
  const byCoin = new Map<string, { kimchiHits: number; kimchiBest: number; invHits: number; invBest: number }>();
  for (const r of rows) {
    const e = byCoin.get(r.coin) ?? { kimchiHits: 0, kimchiBest: 0, invHits: 0, invBest: 0 };
    if (r.type === "kimchi") { e.kimchiHits += r.hits; e.kimchiBest = Math.max(e.kimchiBest, r.bestNet); }
    else { e.invHits += r.hits; e.invBest = Math.max(e.invBest, r.bestNet); }
    byCoin.set(r.coin, e);
  }
  const totals = [...byCoin.entries()]
    .map(([c, v]) => ({ coin: c, ...v, totalHits: v.kimchiHits + v.invHits }))
    .sort((a, b) => b.totalHits - a.totalHits);
  return NextResponse.json({ days, totals });
}
