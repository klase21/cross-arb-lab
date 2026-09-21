// Display formatting: never scientific notation. Money/PnL cap at 2 decimals,
// quantities keep up to 8 plain decimals.

export function fmtUsd2(n: number): string {
  if (!Number.isFinite(n)) return "-";
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  return `${sign}$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

/** Adaptive coin price without exponent: >=1 → ≤4 decimals, <1 → ≤8 decimals. */
export function fmtPricePlain(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "-";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}
