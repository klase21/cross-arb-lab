import { formatUnits } from "viem";
import { CHAIN_DEXES } from "./dex-config";
import type { ChainId } from "./dex-config";
import { getSushiQuote, getUniswapWebQuote } from "./web-quotes";
import type { WebQuote } from "./web-quotes";
import type { ChainQuoteResult, DexQuote } from "./types";

// Reference trade size recorded on each quote row (metadata only — actual
// quotes sell one whole base unit).
const AMOUNT_USD_LABEL = 100;

// Maps aggregator dex labels produced by scanChainPair to their web-quote API.
type WebQuoteFn = (chainId: ChainId, tokenIn: string, tokenOut: string, amountRaw: bigint, outDecimals: number) => Promise<WebQuote | null>;

function getWebQuoteFn(dexName: string): WebQuoteFn | null {
  switch (dexName.toLowerCase()) {
    case "sushi aggregator": return getSushiQuote;
    case "uniswap quote api": return getUniswapWebQuote;
    default: return null;
  }
}

export async function scanChainPair(chainId: ChainId, baseSymbol: string, quoteSymbol: string): Promise<ChainQuoteResult> {
  const chainDexes = CHAIN_DEXES.find(c => c.chain === chainId);
  if (!chainDexes) return { chainId, pair: "", quotes: [] };
  const base = chainDexes.tokens[baseSymbol];
  const quote = chainDexes.tokens[quoteSymbol];
  if (!base || !quote) return { chainId, pair: `${baseSymbol}/${quoteSymbol}`, quotes: [] };

  const pairKey = `${baseSymbol}/${quoteSymbol}`;
  // Sell exactly one whole base unit into the quote asset — same direction and
  // size as entering "1" on a DEX swap interface (Uniswap/Sushi UIs).
  const amountInRaw = BigInt(10) ** BigInt(base.decimals);

  // Prices come exclusively from the DEX web-quote APIs (the same endpoints the
  // Uniswap / Sushi interfaces call); raw RPC pool quoting is no longer used.
  const webQuotes = await Promise.all([
    getSushiQuote(chainId, base.address, quote.address, amountInRaw, quote.decimals),
    getUniswapWebQuote(chainId, base.address, quote.address, amountInRaw, quote.decimals),
  ]);

  const quotes: DexQuote[] = [];
  for (const webQuote of webQuotes) {
    if (!webQuote) continue;
    const price = Number(formatUnits(webQuote.amountOut, webQuote.outDecimals));
    if (price > 0) {
      quotes.push({ dex: webQuote.dexLabel, price, liquidityUsd: AMOUNT_USD_LABEL, feeTier: 0 });
    }
  }

  return { chainId, pair: pairKey, quotes };
}

const SCAN_CONCURRENCY = Number(process.env.SCAN_CONCURRENCY ?? 8);

async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;
  async function worker() {
    while (true) {
      const current = index++;
      if (current >= tasks.length) return;
      results[current] = await tasks[current]();
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function scanAllChains(): Promise<Map<string, ChainQuoteResult[]>> {
  const results = new Map<string, ChainQuoteResult[]>();

  const tasks: (() => Promise<void>)[] = [];
  for (const chainDexes of CHAIN_DEXES) {
    for (const { base: baseSym, quote: quoteSym } of chainDexes.pairs) {
      const pairKey = `${baseSym}/${quoteSym}`;
      if (!results.has(pairKey)) results.set(pairKey, []);
      tasks.push(async () => {
        const result = await scanChainPair(chainDexes.chain, baseSym, quoteSym);
        if (result.quotes.length > 0) {
          const existing = results.get(pairKey)!;
          existing.push(result);
        }
      });
    }
  }
  await runWithConcurrency(tasks, SCAN_CONCURRENCY);
  return results;
}

export interface RoundTripInput {
  pairKey: string;
  buyChainId: ChainId;
  buyDexName: string;
  sellChainId: ChainId;
  sellDexName: string;
}

export async function calculateRoundTrip(input: RoundTripInput): Promise<{ midQuote: number; finalBase: number } | null> {
  const cdBuy = CHAIN_DEXES.find(x => x.chain === input.buyChainId);
  if (!cdBuy) return null;
  const [baseSymbol, quoteSymbol] = input.pairKey.split("/");
  const baseTok = cdBuy.tokens[baseSymbol];
  const quoteTok = cdBuy.tokens[quoteSymbol];
  if (!baseTok || !quoteTok) return null;

  const buyWeb = getWebQuoteFn(input.buyDexName);
  const sellWeb = getWebQuoteFn(input.sellDexName);
  if (!buyWeb || !sellWeb) return null;

  const cdSell = CHAIN_DEXES.find(x => x.chain === input.sellChainId);
  const sellBaseTok = cdSell?.tokens[baseSymbol];
  const sellQuoteTok = cdSell?.tokens[quoteSymbol];
  if (!sellBaseTok || !sellQuoteTok) return null;

  const oneUnitRaw = BigInt(10) ** BigInt(baseTok.decimals);
  const leg1 = await buyWeb(input.buyChainId, baseTok.address, quoteTok.address, oneUnitRaw, quoteTok.decimals);
  if (!leg1 || leg1.amountOut <= BigInt(0)) return null;
  const leg2 = await sellWeb(input.sellChainId, sellQuoteTok.address, sellBaseTok.address, leg1.amountOut, sellBaseTok.decimals);
  if (!leg2 || leg2.amountOut <= BigInt(0)) return null;

  return {
    midQuote: Number(formatUnits(leg1.amountOut, quoteTok.decimals)),
    finalBase: Number(formatUnits(leg2.amountOut, sellBaseTok.decimals)),
  };
}

export interface SpotPrice {
  chainId: ChainId;
  pair: string;
  dex: string;
  baseToQuotePrice: number; // how many quote tokens you get for 1 base token
  quoteToBasePrice: number; // how many base tokens you get back for the midQuote
}

export async function getSpotPrices(
  chainId: ChainId,
  dexName: string,
  baseSymbol: string,
  quoteSymbol: string,
): Promise<SpotPrice | null> {
  const cd = CHAIN_DEXES.find(x => x.chain === chainId);
  if (!cd) return null;
  const baseTok = cd.tokens[baseSymbol];
  const quoteTok = cd.tokens[quoteSymbol];
  if (!baseTok || !quoteTok) return null;

  const web = getWebQuoteFn(dexName);
  if (!web) return null;

  const oneUnitRaw = BigInt(10) ** BigInt(baseTok.decimals);
  const leg1 = await web(chainId, baseTok.address, quoteTok.address, oneUnitRaw, quoteTok.decimals);
  if (!leg1 || leg1.amountOut <= BigInt(0)) return null;
  const baseToQuotePrice = Number(formatUnits(leg1.amountOut, quoteTok.decimals));

  const leg2 = await web(chainId, quoteTok.address, baseTok.address, leg1.amountOut, baseTok.decimals);
  if (!leg2 || leg2.amountOut <= BigInt(0)) return null;

  return {
    chainId,
    pair: `${baseSymbol}/${quoteSymbol}`,
    dex: dexName,
    baseToQuotePrice,
    quoteToBasePrice: Number(formatUnits(leg2.amountOut, baseTok.decimals)),
  };
}
