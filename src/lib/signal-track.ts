import type { SquareStatus } from "./square";

export type Kline = [number, string, string, string, string];

/** Chronological TP/SL simulation. Conservative: same-candle double-hit counts SL first. */
export function replay(
  side: "LONG" | "SHORT",
  entry: number,
  target: number | null,
  stop: number | null,
  klines: Kline[],
  postMs: number,
): { status: SquareStatus; closeReason: string | null; closedAtMs: number | null } {
  let filled = false;
  for (const k of klines) {
    if (k[0] < postMs) continue;
    const high = Number.parseFloat(k[2]);
    const low = Number.parseFloat(k[3]);
    if (!Number.isFinite(high) || !Number.isFinite(low)) continue;
    if (!filled) {
      filled = side === "LONG" ? low <= entry : high >= entry;
      if (!filled) continue;
    }
    if (side === "LONG") {
      const hitStop = stop !== null && low <= stop;
      const hitTp = target !== null && high >= target;
      if (hitStop && hitTp) return { status: "CLOSED_LOSS", closeReason: "SL", closedAtMs: k[0] };
      if (hitStop) return { status: "CLOSED_LOSS", closeReason: "SL", closedAtMs: k[0] };
      if (hitTp) return { status: "CLOSED_WIN", closeReason: "TP", closedAtMs: k[0] };
    } else {
      const hitStop = stop !== null && high >= stop;
      const hitTp = target !== null && low <= target;
      if (hitStop && hitTp) return { status: "CLOSED_LOSS", closeReason: "SL", closedAtMs: k[0] };
      if (hitStop) return { status: "CLOSED_LOSS", closeReason: "SL", closedAtMs: k[0] };
      if (hitTp) return { status: "CLOSED_WIN", closeReason: "TP", closedAtMs: k[0] };
    }
  }
  return { status: filled ? "LIVE" : "OPEN", closeReason: null, closedAtMs: null };
}
