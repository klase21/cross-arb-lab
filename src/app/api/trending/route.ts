import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const OUR_CHAINS = new Set(["ethereum", "arbitrum", "polygon", "base", "optimism", "bsc"]);

const CACHE_TTL_MS = 2 * 60 * 1000;
let cache: { at: number; data: unknown } | null = null;

const BROWSER_HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
};

interface BoostEntry {
  url?: string;
  chainId?: string;
  tokenAddress?: string;
  amount?: number;
  totalAmount?: number;
  icon?: string;
  header?: string;
  description?: string;
}

interface DexPair {
  chainId?: string;
  dexId?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number; h1?: number };
  priceChange?: { h24?: number; h1?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
}

export interface TrendToken {
  chainId: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  priceUsd: number;
  marketCap: number;
  fdv: number;
  liquidityUsd: number;
  volumeH24: number;
  volumeH1: number;
  priceChangeH24: number;
  priceChangeH1: number;
  dexId: string;
  pairCreatedAt?: number;
  boostAmount: number;
  totalBoost: number;
  description?: string;
}

export interface CexListing {
  symbol: string;
  name: string;
  source: "binance" | "upbit" | "cmc";
  title?: string;
  priceUsd: number;
  marketCap: number;
  volume24h: number;
  percentChange24h: number;
  dateIso: string;
}

async function enrichToken(chainId: string, tokenAddress: string): Promise<Partial<TrendToken>> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 60 },
    });
    if (!res.ok) return {};
    const data = await res.json() as { pairs?: DexPair[] };
    const pairs = (Array.isArray(data.pairs) ? data.pairs : []).filter(p => p.chainId === chainId);
    if (pairs.length === 0) return {};
    const best = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    return {
      symbol: best.baseToken?.symbol ?? "",
      name: best.baseToken?.name ?? "",
      priceUsd: Number.parseFloat(best.priceUsd ?? "0") || 0,
      marketCap: best.marketCap ?? 0,
      fdv: best.fdv ?? 0,
      liquidityUsd: best.liquidity?.usd ?? 0,
      volumeH24: best.volume?.h24 ?? 0,
      volumeH1: best.volume?.h1 ?? 0,
      priceChangeH24: best.priceChange?.h24 ?? 0,
      priceChangeH1: best.priceChange?.h1 ?? 0,
      dexId: best.dexId ?? "",
      pairCreatedAt: best.pairCreatedAt,
    };
  } catch {
    return {};
  }
}

async function fetchBinanceListings(): Promise<CexListing[]> {
  try {
    const res = await fetch(
      "https://www.binance.com/bapi/composite/v1/public/cms/article/catalog/list/query?catalogId=48&pageNo=1&pageSize=20",
      { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(8000), next: { revalidate: 300 } },
    );
    if (!res.ok) return [];
    const data = await res.json() as { data?: { catalog?: { articles?: { title?: string; releaseDate?: number }[] } } };
    const articles = data.data?.catalog?.articles ?? [];
    const out: CexListing[] = [];
    for (const article of articles) {
      const title = article.title ?? "";
      // Titles like "Binance Will List Xterio (XTO)" or "Binance Lists Humanity (H)"
      const match = title.match(/\(([A-Z0-9]{2,12})\)/);
      if (!match) continue;
      out.push({
        symbol: match[1],
        name: title.replace(/^Binance\s+(Will\s+List|Lists)\s*/i, "").replace(/\s*\([A-Z0-9]{2,12}\)\s*$/, "").trim(),
        source: "binance",
        title,
        priceUsd: 0,
        marketCap: 0,
        volume24h: 0,
        percentChange24h: 0,
        dateIso: article.releaseDate ? new Date(article.releaseDate).toISOString() : new Date().toISOString(),
      });
    }
    return out.slice(0, 15);
  } catch {
    return [];
  }
}

interface CmcRow {
  id: number;
  symbol: string;
  name: string;
  dateAdded?: string;
  quotes?: { name: string; price?: number; marketCap?: number; volume24h?: number; percentChange24h?: number }[];
}

async function fetchCmcNewListings(): Promise<CexListing[]> {
  try {
    const res = await fetch(
      "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing?start=1&limit=5000&sortBy=date_added&sortType=desc&convert=USD&cryptoType=all&tagType=all&audited=false",
      { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(12000), next: { revalidate: 300 } },
    );
    if (!res.ok) return [];
    const data = await res.json() as { data?: { cryptoCurrencyList?: CmcRow[] } };
    const list = data.data?.cryptoCurrencyList ?? [];
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const out: CexListing[] = [];
    for (const row of list) {
      const added = row.dateAdded ? Date.parse(row.dateAdded) : 0;
      if (!added || added < cutoff) continue;
      const q = row.quotes?.find(x => x.name === "USD");
      out.push({
        symbol: row.symbol,
        name: row.name,
        source: "cmc",
        priceUsd: q?.price ?? 0,
        marketCap: q?.marketCap ?? 0,
        volume24h: q?.volume24h ?? 0,
        percentChange24h: q?.percentChange24h ?? 0,
        dateIso: row.dateAdded ?? new Date().toISOString(),
      });
      if (out.length >= 20) break;
    }
    return out;
  } catch {
    return [];
  }
}

interface UpbitNotice {
  id?: number;
  title?: string;
  listed_at?: string;
  first_listed_at?: string;
  created_at?: string;
}

async function fetchUpbitListings(): Promise<CexListing[]> {
  try {
    const res = await fetch("https://api.upbit.com/v1/notices?page=1&per_page=30", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const data = await res.json() as { data?: { list?: UpbitNotice[] } } & { list?: UpbitNotice[] };
    const notices = data.data?.list ?? data.list ?? [];
    const out: CexListing[] = [];
    for (const notice of notices) {
      const title = notice.title ?? "";
      if (!title.includes("상장")) continue;
      // Titles like "[거래] 신규 상장 : 세이퍼프로토콜 (SAFER)" — extract ticker in parens
      const match = title.match(/\(([A-Z0-9]{2,12})\)\s*$/);
      const symbol = match ? match[1] : "";
      out.push({
        symbol: symbol || "-",
        name: title.replace(/^\[[^\]]*\]\s*/, "").trim(),
        source: "upbit",
        title,
        priceUsd: 0,
        marketCap: 0,
        volume24h: 0,
        percentChange24h: 0,
        dateIso: notice.listed_at ?? notice.first_listed_at ?? notice.created_at ?? new Date().toISOString(),
      });
      if (out.length >= 15) break;
    }
    return out;
  } catch {
    return [];
  }
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.data, { headers: { "Cache-Control": "public, max-age=60" } });
  }

  const [boostRes, binance, upbit, cmc] = await Promise.all([
    fetch("https://api.dexscreener.com/token-boosts/latest/v1", { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(8000), next: { revalidate: 60 } })
      .then(r => (r.ok ? r.json() as Promise<BoostEntry[]> : Promise.resolve([])))
      .catch(() => [] as BoostEntry[]),
    fetchBinanceListings(),
    fetchUpbitListings(),
    fetchCmcNewListings(),
  ]);

  let tokens: TrendToken[] = [];
  try {
    const entries = Array.isArray(boostRes) ? boostRes : [];
    const boosted = entries
      .filter(entry => entry.chainId && OUR_CHAINS.has(entry.chainId) && entry.tokenAddress)
      .reduce<Map<string, BoostEntry>>((map, entry) => {
        const key = `${entry.chainId}:${entry.tokenAddress}`;
        const existing = map.get(key);
        if (!existing || (entry.amount ?? 0) > (existing.amount ?? 0)) map.set(key, entry);
        return map;
      }, new Map());

    const top = Array.from(boosted.values())
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
      .slice(0, 24);

    const BATCH = 6;
    for (let i = 0; i < top.length; i += BATCH) {
      const batch = top.slice(i, i + BATCH);
      const enriched = await Promise.all(batch.map(async entry => {
        const info = await enrichToken(entry.chainId!, entry.tokenAddress!);
        return {
          chainId: entry.chainId!,
          tokenAddress: entry.tokenAddress!,
          symbol: info.symbol ?? "",
          name: info.name ?? "",
          priceUsd: info.priceUsd ?? 0,
          marketCap: info.marketCap ?? 0,
          fdv: info.fdv ?? 0,
          liquidityUsd: info.liquidityUsd ?? 0,
          volumeH24: info.volumeH24 ?? 0,
          volumeH1: info.volumeH1 ?? 0,
          priceChangeH24: info.priceChangeH24 ?? 0,
          priceChangeH1: info.priceChangeH1 ?? 0,
          dexId: info.dexId ?? "",
          pairCreatedAt: info.pairCreatedAt,
          boostAmount: entry.amount ?? 0,
          totalBoost: entry.totalAmount ?? 0,
          description: entry.description,
        } satisfies TrendToken;
      }));
      tokens.push(...enriched);
    }
    tokens.sort((a, b) => b.boostAmount - a.boostAmount || b.marketCap - a.marketCap);
  } catch {
    tokens = [];
  }

  const listings = [...binance, ...upbit, ...cmc]
    .sort((a, b) => Date.parse(b.dateIso) - Date.parse(a.dateIso));
  const payload = { dex: tokens, listings, timestamp: new Date().toISOString() };
  cache = { at: now, data: payload };
  return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=60" } });
}
