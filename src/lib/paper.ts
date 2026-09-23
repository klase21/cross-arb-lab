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
  tpUsd?: number | null;
  slUsd?: number | null;
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
  pending: PendingOrder[];
  funding: FundingPosition[];
  fundingClosed: FundingClosed[];
  closedTrades: ClosedTrade[];
  updatedAt: number;
}

/** GTC limit order waiting for the market. */
export interface PendingOrder {
  id: string;
  ts: number;
  venue: PaperVenue;
  coin: string;
  side: PaperSide;
  qty: number;
  limitUsd: number;
  note?: string;
}

export interface FundingPosition {
  id: string;
  base: string;
  longVenue: string;
  shortVenue: string;
  notionalUsd: number;
  entryLongMark: number;
  entryShortMark: number;
  accFundingUsd: number;
  openedAt: number;
  lastAccrueAt: number;
}

export interface FundingClosed {
  id: string;
  base: string;
  longVenue: string;
  shortVenue: string;
  pnlUsd: number;
  fundingUsd: number;
  pricePnlUsd: number;
  closedAt: number;
}

/** Fully-closed spot position, kept for per-asset stats (pnl already in cash). */
export interface ClosedTrade {
  id: string;
  venue: PaperVenue;
  coin: string;
  qty: number;
  realizedPnlUsd: number;
  closedAt: number;
}

const MS_PER_YEAR = 365 * 24 * 3600 * 1000;

const STORAGE_KEY = "paperAccount";

export function newAccount(startedUsd: number): PaperAccount {
  return { cashUsd: startedUsd, startedUsd, positions: [], fills: [], pending: [], funding: [], fundingClosed: [], closedTrades: [], updatedAt: Date.now() };
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
    return { account: { ...account, cashUsd, positions, fills: fills.slice(0, 300), updatedAt: Date.now() }, fill };
  }

  const pos = positions.find(p => p.venue === quote.venue && p.coin === quote.coin);
  if (!pos || pos.qty < qty - 1e-12) return { error: "position" };
  const gross = qty * price;
  const fee = gross * feeRate;
  cashUsd += gross - fee;
  pos.realizedPnlUsd += (price - pos.avgPriceUsd) * qty - fee;
  pos.qty -= qty;
  const closed = pos.qty <= 1e-12;
  const kept = positions.filter(p => p.qty > 1e-12);
  const fill: PaperFill = { id: uid(), ts: Date.now(), venue: quote.venue, coin: quote.coin, side, qty, priceUsd: price, feeUsd: fee, note };
  fills.unshift(fill);
  const closedTrades = [...account.closedTrades];
  if (closed) {
    closedTrades.unshift({
      id: uid(), venue: quote.venue, coin: quote.coin,
      qty, realizedPnlUsd: pos.realizedPnlUsd, closedAt: Date.now(),
    });
  }
  return {
    account: { ...account, cashUsd, positions: kept, fills: fills.slice(0, 300), closedTrades: closedTrades.slice(0, 300), updatedAt: Date.now() },
    fill,
  };
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

export function valuate(
  account: PaperAccount,
  mark: (venue: PaperVenue, coin: string) => number | null,
  fundingMark?: (base: string, venue: string) => number | null,
): PaperValuation {
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
  // Open funding positions: accrued funding always counts; live price PnL too
  // when marks are available.
  let fundingAcc = 0;
  for (const f of account.funding) {
    fundingAcc += f.accFundingUsd;
    unrealizedPnlUsd += f.accFundingUsd;
    if (fundingMark) {
      const lm = fundingMark(f.base, f.longVenue);
      const sm = fundingMark(f.base, f.shortVenue);
      if (lm !== null && f.entryLongMark > 0) unrealizedPnlUsd += f.notionalUsd * (lm / f.entryLongMark - 1);
      if (sm !== null && f.entryShortMark > 0) unrealizedPnlUsd += f.notionalUsd * (1 - sm / f.entryShortMark);
    }
  }
  for (const c of account.fundingClosed) realizedPnlUsd += c.pnlUsd;
  const equityUsd = account.cashUsd + positionsValueUsd + fundingAcc;
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
    // Normalize accounts saved before funding/closed-trade fields existed.
    if (!Array.isArray(parsed.funding)) parsed.funding = [];
    if (!Array.isArray(parsed.fundingClosed)) parsed.fundingClosed = [];
    if (!Array.isArray(parsed.closedTrades)) parsed.closedTrades = [];
    if (!Array.isArray((parsed as { pending?: unknown }).pending)) parsed.pending = [];
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

/** Place a GTC limit order. Funds/inventory are checked at match time, but
 * obviously insufficient orders are rejected upfront. */
export function executeLimit(
  account: PaperAccount,
  quote: PaperQuote,
  side: PaperSide,
  qty: number,
  limitUsd: number,
  note?: string,
): { account: PaperAccount; order: PendingOrder } | { error: string } {
  if (!(qty > 0) || !Number.isFinite(qty)) return { error: "qty" };
  if (!(limitUsd > 0) || !Number.isFinite(limitUsd)) return { error: "price" };
  const feeRate = PAPER_FEES[quote.venue];
  if (side === "buy" && qty * limitUsd * (1 + feeRate) > account.cashUsd + 1e-9) return { error: "cash" };
  if (side === "sell") {
    const pos = account.positions.find(p => p.venue === quote.venue && p.coin === quote.coin);
    if (!pos || pos.qty < qty - 1e-12) return { error: "position" };
  }
  const order: PendingOrder = {
    id: uid(), ts: Date.now(), venue: quote.venue, coin: quote.coin,
    side, qty, limitUsd, note,
  };
  return {
    account: { ...account, pending: [order, ...account.pending].slice(0, 100), updatedAt: Date.now() },
    order,
  };
}

export function cancelOrder(
  account: PaperAccount,
  orderId: string,
): { account: PaperAccount } | { error: string } {
  if (!account.pending.some(o => o.id === orderId)) return { error: "position" };
  return {
    account: { ...account, pending: account.pending.filter(o => o.id !== orderId), updatedAt: Date.now() },
  };
}

/** Fill crossing limit orders against a fresh bid/ask. Buy fills when ask <=
 * limit, sell fills when bid >= limit. Settles at the limit price. */
export function matchLimitOrders(
  account: PaperAccount,
  quote: PaperQuote,
): { account: PaperAccount; fills: PaperFill[] } {
  if (account.pending.length === 0) return { account, fills: [] };
  const acc: PaperAccount = {
    ...account,
    positions: account.positions.map(p => ({ ...p })),
    fills: [...account.fills],
    closedTrades: [...account.closedTrades],
    pending: [...account.pending],
  };
  const fills: PaperFill[] = [];
  for (const order of [...acc.pending]) {
    if (order.venue !== quote.venue || order.coin !== quote.coin) continue;
    const crossed = order.side === "buy" ? quote.askUsd <= order.limitUsd : quote.bidUsd >= order.limitUsd;
    if (!crossed) continue;
    const feeRate = PAPER_FEES[order.venue];
    if (order.side === "buy") {
      const gross = order.qty * order.limitUsd;
      const fee = gross * feeRate;
      if (gross + fee > acc.cashUsd + 1e-9) continue; // cash moved — leave resting
      acc.cashUsd -= gross + fee;
      const pos = acc.positions.find(p => p.venue === order.venue && p.coin === order.coin);
      if (pos) {
        pos.avgPriceUsd = (pos.avgPriceUsd * pos.qty + gross) / (pos.qty + order.qty);
        pos.qty += order.qty;
      } else {
        acc.positions.push({ venue: order.venue, coin: order.coin, qty: order.qty, avgPriceUsd: order.limitUsd, realizedPnlUsd: 0 });
      }
      fills.unshift({ id: uid(), ts: Date.now(), venue: order.venue, coin: order.coin, side: "buy", qty: order.qty, priceUsd: order.limitUsd, feeUsd: fee, note: order.note });
    } else {
      const pos = acc.positions.find(p => p.venue === order.venue && p.coin === order.coin);
      if (!pos || pos.qty < order.qty - 1e-12) continue;
      const gross = order.qty * order.limitUsd;
      const fee = gross * feeRate;
      acc.cashUsd += gross - fee;
      pos.realizedPnlUsd += (order.limitUsd - pos.avgPriceUsd) * order.qty - fee;
      pos.qty -= order.qty;
      const closed = pos.qty <= 1e-12;
      acc.positions = acc.positions.filter(p => p.qty > 1e-12);
      fills.unshift({ id: uid(), ts: Date.now(), venue: order.venue, coin: order.coin, side: "sell", qty: order.qty, priceUsd: order.limitUsd, feeUsd: fee, note: order.note });
      if (closed) {
        acc.closedTrades.unshift({
          id: uid(), venue: order.venue, coin: order.coin,
          qty: order.qty, realizedPnlUsd: pos.realizedPnlUsd, closedAt: Date.now(),
        });
        acc.closedTrades = acc.closedTrades.slice(0, 300);
      }
    }
    acc.pending = acc.pending.filter(o => o.id !== order.id);
    acc.fills = [fills[0], ...acc.fills].slice(0, 300);
  }
  acc.updatedAt = Date.now();
  return { account: acc, fills };
}

/** Close tracking helper shared by market/limit/TP-SL fills. */
function settleSell(
  acc: PaperAccount,
  pos: PaperPosition,
  qty: number,
  price: number,
  note?: string,
): { fill: PaperFill; closedOut: boolean } {
  const feeRate = PAPER_FEES[pos.venue];
  const gross = qty * price;
  const fee = gross * feeRate;
  acc.cashUsd += gross - fee;
  pos.realizedPnlUsd += (price - pos.avgPriceUsd) * qty - fee;
  pos.qty -= qty;
  const closedOut = pos.qty <= 1e-12;
  acc.positions = acc.positions.filter(p => p.qty > 1e-12);
  const fill: PaperFill = {
    id: uid(), ts: Date.now(), venue: pos.venue, coin: pos.coin,
    side: "sell", qty, priceUsd: price, feeUsd: fee, note,
  };
  acc.fills.unshift(fill);
  if (closedOut) {
    acc.closedTrades.unshift({
      id: uid(), venue: pos.venue, coin: pos.coin,
      qty, realizedPnlUsd: pos.realizedPnlUsd, closedAt: Date.now(),
    });
    acc.closedTrades = acc.closedTrades.slice(0, 300);
  }
  acc.fills = acc.fills.slice(0, 300);
  return { fill, closedOut };
}

/** Check TP/SL attachments on open positions against a fresh mark.
 * Full-position exits at market (exit the whole remaining qty). */
export function checkTpSl(
  account: PaperAccount,
  mark: (venue: PaperVenue, coin: string) => number | null,
): { account: PaperAccount; fills: PaperFill[] } {
  if (!account.positions.some(p => p.tpUsd != null || p.slUsd != null)) {
    return { account, fills: [] };
  }
  const acc: PaperAccount = {
    ...account,
    positions: account.positions.map(p => ({ ...p })),
    fills: [...account.fills],
    closedTrades: [...account.closedTrades],
    pending: [...account.pending],
  };
  const fills: PaperFill[] = [];
  for (const pos of [...acc.positions]) {
    if (pos.tpUsd == null && pos.slUsd == null) continue;
    const m = mark(pos.venue, pos.coin);
    if (m === null || !(m > 0)) continue;
    const hitTp = pos.tpUsd != null && m >= pos.tpUsd;
    const hitSl = pos.slUsd != null && m <= pos.slUsd;
    if (!hitTp && !hitSl) continue;
    const qty = pos.qty;
    if (!(qty > 0)) continue;
    const { fill } = settleSell(acc, pos, qty, m, hitTp ? "take-profit" : "stop-loss");
    fills.unshift(fill);
  }
  if (fills.length === 0) return { account, fills: [] };
  acc.updatedAt = Date.now();
  return { account: acc, fills };
}

export function setTpSl(
  account: PaperAccount,
  venue: PaperVenue,
  coin: string,
  tpUsd: number | null,
  slUsd: number | null,
): { account: PaperAccount } {
  const positions = account.positions.map(p =>
    p.venue === venue && p.coin === coin ? { ...p, tpUsd, slUsd } : p,
  );
  return { account: { ...account, positions, updatedAt: Date.now() } };
}

/** Pair (inventory-hedge) trade: buy on one venue while simultaneously selling
 * the same qty from existing inventory on the other venue. Atomic — either
 * both legs fill or nothing happens. The sell leg requires inventory, which
 * mirrors real CEX-to-CEX arbitrage (no naked shorts). */
export function executePair(
  account: PaperAccount,
  buyQuote: PaperQuote,
  sellQuote: PaperQuote,
  qty: number,
  note?: string,
): { account: PaperAccount; fills: PaperFill[] } | { error: string } {
  if (buyQuote.venue === sellQuote.venue || buyQuote.coin !== sellQuote.coin) {
    return { error: "pair" };
  }
  const first = executeMarket(account, buyQuote, "buy", qty, note);
  if ("error" in first) return first;
  const second = executeMarket(first.account, sellQuote, "sell", qty, note);
  if ("error" in second) return second;
  return { account: second.account, fills: [first.fill, second.fill] };
}

// ---------------------------------------------------------------- funding ---

/** Open a delta-neutral funding position (10% notional margin proxy, no lock). */
export function openFunding(
  account: PaperAccount,
  input: {
    base: string;
    longVenue: string;
    shortVenue: string;
    notionalUsd: number;
    longMark: number;
    shortMark: number;
  },
): { account: PaperAccount; position: FundingPosition } | { error: string } {
  const { base, longVenue, shortVenue, notionalUsd, longMark, shortMark } = input;
  if (longVenue === shortVenue) return { error: "pair" };
  if (!(notionalUsd > 0) || !Number.isFinite(notionalUsd)) return { error: "qty" };
  if (!(longMark > 0) || !(shortMark > 0)) return { error: "price" };
  if (account.cashUsd < notionalUsd * 0.1) return { error: "cash" };
  if (account.funding.some(f => f.base === base)) return { error: "exists" };
  const now = Date.now();
  const position: FundingPosition = {
    id: uid(), base, longVenue, shortVenue, notionalUsd,
    entryLongMark: longMark, entryShortMark: shortMark,
    accFundingUsd: 0, openedAt: now, lastAccrueAt: now,
  };
  return {
    account: { ...account, funding: [position, ...account.funding].slice(0, 30), updatedAt: now },
    position,
  };
}

/** Accrue funding between lastAccrueAt and now from live APRs (long pays short when positive). */
export function accrueFunding(
  position: FundingPosition,
  longApr: number,
  shortApr: number,
  now: number,
): FundingPosition {
  const dtYears = Math.max(0, (now - position.lastAccrueAt) / MS_PER_YEAR);
  return {
    ...position,
    accFundingUsd: position.accFundingUsd + (position.notionalUsd * (shortApr - longApr)) / 100 * dtYears,
    lastAccrueAt: now,
  };
}

export function fundingPricePnl(
  position: FundingPosition,
  longMark: number | null,
  shortMark: number | null,
): number {
  let pnl = 0;
  if (longMark !== null && position.entryLongMark > 0) {
    pnl += position.notionalUsd * (longMark / position.entryLongMark - 1);
  }
  if (shortMark !== null && position.entryShortMark > 0) {
    pnl += position.notionalUsd * (1 - shortMark / position.entryShortMark);
  }
  return pnl;
}

export function closeFunding(
  account: PaperAccount,
  positionId: string,
  live: { longApr: number; shortApr: number; longMark: number | null; shortMark: number | null },
  now: number,
): { account: PaperAccount; closed: FundingClosed } | { error: string } {
  const position = account.funding.find(f => f.id === positionId);
  if (!position) return { error: "position" };
  const accrued = accrueFunding(position, live.longApr, live.shortApr, now);
  const pricePnl = fundingPricePnl(accrued, live.longMark, live.shortMark);
  const total = accrued.accFundingUsd + pricePnl;
  const closed: FundingClosed = {
    id: position.id, base: position.base,
    longVenue: position.longVenue, shortVenue: position.shortVenue,
    pnlUsd: total, fundingUsd: accrued.accFundingUsd, pricePnlUsd: pricePnl, closedAt: now,
  };
  return {
    account: {
      ...account,
      cashUsd: account.cashUsd + total,
      funding: account.funding.filter(f => f.id !== positionId),
      fundingClosed: [closed, ...account.fundingClosed].slice(0, 100),
      updatedAt: now,
    },
    closed,
  };
}

// -------------------------------------------------------- equity snapshots ---

export interface EquityPoint {
  t: number;
  e: number;
}

const EQUITY_KEY = "paperEquity";

export function recordEquity(equityUsd: number): EquityPoint[] {
  try {
    const raw = localStorage.getItem(EQUITY_KEY);
    const pts: EquityPoint[] = raw ? (JSON.parse(raw) as EquityPoint[]) : [];
    const last = pts[pts.length - 1];
    if (!last || Date.now() - last.t > 5 * 60 * 1000 || Math.abs(equityUsd - last.e) > 1e-9) {
      pts.push({ t: Date.now(), e: equityUsd });
    }
    const trimmed = pts.slice(-500);
    localStorage.setItem(EQUITY_KEY, JSON.stringify(trimmed));
    return trimmed;
  } catch {
    return [];
  }
}

export function loadEquity(): EquityPoint[] {
  try {
    const raw = localStorage.getItem(EQUITY_KEY);
    const pts = raw ? (JSON.parse(raw) as EquityPoint[]) : [];
    return Array.isArray(pts) ? pts : [];
  } catch {
    return [];
  }
}

export function clearEquity(): void {
  try {
    localStorage.removeItem(EQUITY_KEY);
  } catch {}
}

// ------------------------------------------------------------ force close ---

/** Force-close a spot position at average cost when no live quote exists
 * (delisted/unquoted). Settles at avg price with no extra fee; keeps
 * already-realized PnL. */
export function forceClosePosition(
  account: PaperAccount,
  venue: PaperVenue,
  coin: string,
): { account: PaperAccount; fill: PaperFill } | { error: string } {
  const positions = account.positions.map(p => ({ ...p }));
  const pos = positions.find(p => p.venue === venue && p.coin === coin);
  if (!pos || pos.qty <= 1e-12) return { error: "position" };
  const fills = [...account.fills];
  const cashUsd = account.cashUsd + pos.qty * pos.avgPriceUsd;
  const fill: PaperFill = {
    id: uid(), ts: Date.now(), venue, coin, side: "sell",
    qty: pos.qty, priceUsd: pos.avgPriceUsd, feeUsd: 0, note: "force-close",
  };
  fills.unshift(fill);
  const closedTrades = [...account.closedTrades];
  closedTrades.unshift({
    id: uid(), venue, coin, qty: pos.qty,
    realizedPnlUsd: pos.realizedPnlUsd, closedAt: Date.now(),
  });
  return {
    account: {
      ...account,
      cashUsd,
      positions: positions.filter(p => p !== pos),
      fills: fills.slice(0, 300),
      closedTrades: closedTrades.slice(0, 300),
      updatedAt: Date.now(),
    },
    fill,
  };
}

/** Force-close a funding position at entry marks (price PnL zeroed). */
export function forceCloseFunding(
  account: PaperAccount,
  positionId: string,
): { account: PaperAccount; closed: FundingClosed } | { error: string } {
  const position = account.funding.find(f => f.id === positionId);
  if (!position) return { error: "position" };
  const now = Date.now();
  const closed: FundingClosed = {
    id: position.id, base: position.base,
    longVenue: position.longVenue, shortVenue: position.shortVenue,
    pnlUsd: position.accFundingUsd, fundingUsd: position.accFundingUsd,
    pricePnlUsd: 0, closedAt: now,
  };
  return {
    account: {
      ...account,
      cashUsd: account.cashUsd + position.accFundingUsd,
      funding: account.funding.filter(f => f.id !== positionId),
      fundingClosed: [closed, ...account.fundingClosed].slice(0, 100),
      updatedAt: now,
    },
    closed,
  };
}
