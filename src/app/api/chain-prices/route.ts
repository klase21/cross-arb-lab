import { NextResponse } from "next/server";
import { scanAllChains } from "@/lib/price-scanner";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const quotesByPair = await scanAllChains();
    const pairs = Array.from(quotesByPair.entries()).map(([pair, chains]) => ({ pair, chains }));
    return NextResponse.json({ pairs, timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to scan chain prices", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
