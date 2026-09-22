import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60 * 60 * 1000;
let cache: { at: number; data: unknown } | null = null;

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.data, { headers: { "Cache-Control": "public, max-age=300" } });
  }
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=31", { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`fng ${res.status}`);
    const data = (await res.json()) as {
      data: { value: string; value_classification: string; timestamp: string }[];
    };
    const rows = (Array.isArray(data.data) ? data.data : []).map(r => ({
      value: Number.parseInt(r.value, 10),
      label: r.value_classification,
      t: Number.parseInt(r.timestamp, 10) * 1000,
    })).filter(r => Number.isFinite(r.value));
    if (rows.length === 0) throw new Error("empty fng");
    const payload = { current: rows[0], history: rows, timestamp: new Date().toISOString() };
    cache = { at: now, data: payload };
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "fng failed" }, { status: 502 });
  }
}
