import { NextResponse } from "next/server";
import { getRecentArbs } from "@/lib/recent-arbs-store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const hours = Math.min(Math.max(Number(searchParams.get("hours") ?? 24), 1), 168);
  const entries = getRecentArbs(hours);
  return NextResponse.json({
    count: entries.length,
    hours,
    entries,
    timestamp: new Date().toISOString(),
  });
}
