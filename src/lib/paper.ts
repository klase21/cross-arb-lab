// Paper trading engine: virtual portfolio over Upbit + Binance spot.
// Pure functions (no I/O) + localStorage persistence helpers. No real orders,
// no keys. Fees mirror the live venues: Upbit 0.05%, Binance spot 0.1%.

export type PaperVenue = "upbit" | "binance";
export type PaperSide = "buy" | "sell";

export const PAPER_FEES: Record<PaperVenue, number> = {
  upbit: 0.0005,
  binance: 0.001,
};

export interface PaperPosition {
  venue: PaperVenue;
  coin: string;
  qty: number;
  avgPriceUsd: number;
  realizedPnlUsd: number;
}

export interface PaperFill {
  id: string;
  ts: number;
  venue: PaperVenue;
  coin: string;
  side: PaperSide;
  qty: number;
  priceUsd: number;
  feeUsd: number;
  note?: string;
}

export interface PaperAccount {
  cashUsd: number;
  startedUsd: number;
  positions: PaperPosition[];
  fills: PaperFill[];
  updatedAt: number;
}

const STORAGE_KEY = "paperAccount";

export function newAccount(startedUsd: number): PaperAccount {
  return { cashUsd: startedUsd, startedUsd, positions: [], fills: [], updatedAt: Date.now() };
}

function uid(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export interface PaperQuote {
  venue: PaperVenue;
  coin: string;
  bidUsd: number;
  askUsd: number;
}

/** Market execution against the quote: buys lift the ask, sells hit the bid. */
export function executeMarket(
  account: PaperAccount,
  quote: PaperQuote,
  side: PaperSide,
  qty: number,
  note?: string,
): { account: PaperAccount; fill: PaperFill } | { error: string } {
  if (!(qty > 0) || !Number.isFinite(qty)) return { error: "qty" };
  const price = side === "buy" ? quote.askUsd : quote.bidUsd;
  if (!(price > 0) || !Number.isFinite(price)) return { error: "price" };
  const feeRate = PAPER_FEES[quote.venue];
  const positions = account.positions.map(p => ({ ...p }));
  const fills = [...account.fills];
  let cashUsd = account.cashUsd;

  if (side === "buy") {
    const gross = qty * price;
    const fee = gross * feeRate;
    if (gross + fee > cashUsd + 1e-9) return { error: "cash" };
    cashUsd -= gross + fee;
    const pos = positions.find(p => p.venue === quote.venue && p.coin === quote.coin);
    if (pos) {
      pos.avgPriceUsd = (pos.avgPriceUsd * pos.qty + gross) / (pos.qty + qty);
      pos.qty += qty;
    } else {
      positions.push({ venue: quote.venue, coin: quote.coin, qty, avgPriceUsd: price, realizedPnlUsd: 0 });
    }
    const fill: PaperFill = { id: uid(), ts: Date.now(), venue: quote.venue, coin: quote.coin, side, qty, priceUsd: price, feeUsd: fee, note };
    fills.unshift(fill);
    return { account: { cashUsd, startedUsd: account.startedUsd, positions, fills: fills.slice(0, 300), updatedAt: Date.now() }, fill };
  }

  const pos = positions.find(p => p.venue === quote.venue && p.coin === quote.coin);
  if (!pos || pos.qty < qty - 1e-12) return { error: "position" };
  const gross = qty * price;
  const fee = gross * feeRate;
  cashUsd += gross - fee;
  pos.realizedPnlUsd += (price - pos.avgPriceUsd) * qty - fee;
  pos.qty -= qty;
  const kept = positions.filter(p => p.qty > 1e-12);
  const fill: PaperFill = { id: uid(), ts: Date.now(), venue: quote.venue, coin: quote.coin, side, qty, priceUsd: price, feeUsd: fee, note };
  fills.unshift(fill);
  return { account: { cashUsd, startedUsd: account.startedUsd, positions: kept, fills: fills.slice(0, 300), updatedAt: Date.now() }, fill };
}

export interface PaperValuation {
  equityUsd: number;
  cashUsd: number;
  positionsValueUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number;
  totalPnlUsd: number;
  totalPnlPct: number;
}

export function valuate(account: PaperAccount, mark: (venue: PaperVenue, coin: string) => number | null): PaperValuation {
  let positionsValueUsd = 0;
  let unrealizedPnlUsd = 0;
  let realizedPnlUsd = 0;
  for (const p of account.positions) {
    const m = mark(p.venue, p.coin);
    const value = m !== null ? p.qty * m : p.qty * p.avgPriceUsd;
    positionsValueUsd += value;
    if (m !== null) unrealizedPnlUsd += (m - p.avgPriceUsd) * p.qty;
    realizedPnlUsd += p.realizedPnlUsd;
  }
  const equityUsd = account.cashUsd + positionsValueUsd;
  const totalPnlUsd = equityUsd - account.startedUsd;
  return {
    equityUsd,
    cashUsd: account.cashUsd,
    positionsValueUsd,
    unrealizedPnlUsd,
    realizedPnlUsd,
    totalPnlUsd,
    totalPnlPct: account.startedUsd > 0 ? (totalPnlUsd / account.startedUsd) * 100 : 0,
  };
}

export function loadAccount(): PaperAccount | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PaperAccount;
    if (!Number.isFinite(parsed.cashUsd) || !Array.isArray(parsed.positions) || !Array.isArray(parsed.fills)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveAccount(account: PaperAccount): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
  } catch {}
}

export function clearAccount(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/** Cross-tab draft: kimchi rows stage a symbol here, PaperView picks it up. */
const DRAFT_KEY = "paperDraft";

export function stageDraft(coin: string): void {
  try {
    localStorage.setItem(DRAFT_KEY, coin);
    window.dispatchEvent(new Event("paperDraft"));
  } catch {}
}

export function consumeDraft(): string | null {
  try {
    const coin = localStorage.getItem(DRAFT_KEY);
    localStorage.removeItem(DRAFT_KEY);
    return coin;
  } catch {
    return null;
  }
}
