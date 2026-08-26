import { CHAINS, type ChainId } from "./dex-config";

// Browser-like headers so the public DEX web APIs treat us like their own frontend.
const BROWSER_HEADERS: Record<string, string> = {
  accept: "*/*",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
};

const REQUEST_TIMEOUT_MS = 8_000;

export interface WebQuote {
  dexLabel: string;
  amountOut: bigint;
  outDecimals: number;
}

/**
 * Sushi aggregator quote (api.sushi.com/quote/v7/{chainId}).
 * Returns the best aggregated route output for selling `amountRaw` of tokenIn.
 */
export async function getSushiQuote(
  chainId: ChainId,
  tokenIn: string,
  tokenOut: string,
  amountRaw: bigint,
  outDecimals: number,
): Promise<WebQuote | null> {
  const numericChainId = CHAINS[chainId].chainId;
  const params = new URLSearchParams({
    referrer: "sushi",
    tokenIn: tokenIn.toLowerCase(),
    tokenOut: tokenOut.toLowerCase(),
    amount: amountRaw.toString(),
    maxSlippage: "0.005",
    fee: "0.0035",
    feeBy: "output",
  });
  try {
    const response = await fetch(`https://api.sushi.com/quote/v7/${numericChainId}?${params}`, {
      headers: { ...BROWSER_HEADERS, origin: "https://www.sushi.com", referer: "https://www.sushi.com/" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = await response.json() as { status?: string; assumedAmountOut?: string };
    if (data.status !== "Success" || !data.assumedAmountOut) return null;
    const amountOut = BigInt(data.assumedAmountOut);
    if (amountOut <= BigInt(0)) return null;
    return { dexLabel: "Sushi Aggregator", amountOut, outDecimals };
  } catch {
    return null;
  }
}

// Public interface key shipped with app.uniswap.org's own web client.
// Override via UNISWAP_API_KEY or NEXT_PUBLIC_UNISWAP_API_KEY env var.
const UNISWAP_API_KEY = process.env.UNISWAP_API_KEY ?? process.env.NEXT_PUBLIC_UNISWAP_API_KEY ?? "JoyCGj29tT4pymvhaGciK4r1aIPvqW6W53xT1fwo";
const UNISWAP_SWAPPER = "0x7f2b81F37dFe7b92863bE79bBF59cdbe90417CF2";

interface UniswapQuoteResponse {
  routing?: string;
  quote?: {
    output?: { amount?: string };
    orderInfo?: { outputs?: { startAmount?: string }[] };
  };
  errorCode?: string;
  detail?: string;
}

/**
 * Uniswap Labs gateway quote (entry-gateway.backend-prod.api.uniswap.org/quote).
 * Same endpoint the Uniswap web app calls; supports CLASSIC and DUTCH_V2 routing.
 */
export async function getUniswapWebQuote(
  chainId: ChainId,
  tokenIn: string,
  tokenOut: string,
  amountRaw: bigint,
  outDecimals: number,
): Promise<WebQuote | null> {
  const numericChainId = CHAINS[chainId].chainId;
  try {
    const response = await fetch("https://entry-gateway.backend-prod.api.uniswap.org/quote", {
      method: "POST",
      headers: {
        ...BROWSER_HEADERS,
        "content-type": "application/json",
        "x-api-key": UNISWAP_API_KEY,
        "x-request-source": "uniswap-web",
        origin: "https://app.uniswap.org",
        referer: "https://app.uniswap.org/",
      },
      body: JSON.stringify({
        amount: amountRaw.toString(),
        type: "EXACT_INPUT",
        tokenIn,
        tokenInChainId: numericChainId,
        tokenOut,
        tokenOutChainId: numericChainId,
        swapper: UNISWAP_SWAPPER,
        generatePermitAsTransaction: false,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = await response.json() as UniswapQuoteResponse;
    let amountString: string | undefined;
    if (data.routing === "CLASSIC") {
      amountString = data.quote?.output?.amount;
    } else if (data.routing === "DUTCH_V2") {
      amountString = data.quote?.orderInfo?.outputs?.[0]?.startAmount;
    }
    if (!amountString) return null;
    const amountOut = BigInt(amountString);
    if (amountOut <= BigInt(0)) return null;
    return { dexLabel: "Uniswap Quote API", amountOut, outDecimals };
  } catch {
    return null;
  }
}
