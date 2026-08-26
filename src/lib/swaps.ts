import { encodeFunctionData, parseAbi } from "viem";
import type { ChainId } from "./dex-config";
import type { ExecutionChainId } from "./wallet";

export const TESTNET = {
  chainId: "sepolia" as const,
  numericChainId: 11155111,
  router: "0xE592427A0AEce92De3Edee1F18E0157C05861564" as const,
  quoter: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6" as const,
  weth: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" as const,
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as const,
  wethDecimals: 18,
  usdcDecimals: 6,
} as const;

const V3_QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) returns (uint256 amountOut)",
]);

const V3_ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut)",
]);

const BROWSER_HEADERS: Record<string, string> = {
  accept: "*/*",
  "content-type": "application/json",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
};

const REQUEST_TIMEOUT_MS = 12_000;

export const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export interface RawSwapTx {
  to: string;
  data: string;
  value?: string;
}

/**
 * Walks an API response and finds the first object that looks like an
 * Ethereum transaction request (an address in `to` plus hex calldata in
 * `data`). Keeps us resilient to response-shape drift between providers.
 */
function findSwapTx(node: unknown, depth = 0): RawSwapTx | null {
  if (depth > 6 || node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findSwapTx(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = node as Record<string, unknown>;
  const to = record.to;
  const data = record.data;
  if (typeof to === "string" && /^0x[0-9a-fA-F]{40}$/.test(to) && typeof data === "string" && data.startsWith("0x")) {
    return {
      to,
      data,
      value: typeof record.value === "string" ? record.value : undefined,
    };
  }
  for (const value of Object.values(record)) {
    const found = findSwapTx(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
void errorDetail;

/** Uniswap Labs gateway — builds the executable swap transaction. */
export async function fetchUniswapSwapTx(params: {
  numericChainId: number;
  tokenIn: string;
  tokenOut: string;
  amountRaw: bigint;
  recipient: string;
  slippagePct: number;
}): Promise<RawSwapTx> {
  const response = await fetch("https://entry-gateway.backend-prod.api.uniswap.org/swap", {
    method: "POST",
    headers: { ...BROWSER_HEADERS, "x-api-key": "JoyCGj29tT4pymvhaGciK4r1aIPvqW6W53xT1fwo", "x-request-source": "uniswap-web", origin: "https://app.uniswap.org", referer: "https://app.uniswap.org/" },
    body: JSON.stringify({
      amount: params.amountRaw.toString(),
      type: "EXACT_INPUT",
      tokenIn: params.tokenIn,
      tokenInChainId: params.numericChainId,
      tokenOut: params.tokenOut,
      tokenOutChainId: params.numericChainId,
      swapper: params.recipient,
      recipient: params.recipient,
      slippageTolerance: String(params.slippagePct),
      generatePermitAsTransaction: false,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Uniswap swap API ${response.status}: ${text.slice(0, 300)}`);
  const tx = findSwapTx(JSON.parse(text));
  if (!tx) throw new Error("Uniswap swap API returned no transaction payload");
  return tx;
}

/** Sushi aggregator — builds the executable swap transaction. */
export async function fetchSushiSwapTx(params: {
  numericChainId: number;
  tokenIn: string;
  tokenOut: string;
  amountRaw: bigint;
  recipient: string;
  slippagePct: number;
}): Promise<RawSwapTx> {
  const response = await fetch(`https://api.sushi.com/swap/v7/${params.numericChainId}`, {
    method: "POST",
    headers: { ...BROWSER_HEADERS, origin: "https://www.sushi.com", referer: "https://www.sushi.com/" },
    body: JSON.stringify({
      tokenIn: params.tokenIn.toLowerCase(),
      tokenOut: params.tokenOut.toLowerCase(),
      amount: params.amountRaw.toString(),
      maxSlippage: params.slippagePct / 100,
      to: params.recipient,
      fromAddress: params.recipient,
      referrer: "sushi",
      fee: "0.0035",
      feeBy: "output",
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Sushi swap API ${response.status}: ${text.slice(0, 300)}`);
  const tx = findSwapTx(JSON.parse(text));
  if (!tx) throw new Error("Sushi swap API returned no transaction payload");
  return tx;
}

export async function quoteTestnetSwap(
  publicClient: { readContract: (args: unknown) => Promise<unknown> },
  amountIn: bigint,
  tokenIn: string,
  tokenOut: string,
): Promise<{ fee: number; amountOut: bigint } | null> {
  const fees = [500, 3000, 100, 10000];
  for (const fee of fees) {
    try {
      const amountOut = (await publicClient.readContract({
        address: TESTNET.quoter,
        abi: V3_QUOTER_ABI,
        functionName: "quoteExactInputSingle",
        args: [tokenIn as `0x${string}`, tokenOut as `0x${string}`, fee, amountIn, BigInt(0)],
      } as never)) as bigint;
      if (amountOut > BigInt(0)) return { fee, amountOut };
    } catch {}
  }
  return null;
}

export function buildTestnetSwapTx(params: {
  tokenIn: string;
  tokenOut: string;
  fee: number;
  recipient: string;
  amountIn: bigint;
  amountOutMinimum: bigint;
}): RawSwapTx {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  return {
    to: TESTNET.router,
    data: encodeFunctionData({
      abi: V3_ROUTER_ABI,
      functionName: "exactInputSingle",
      args: [{
        tokenIn: params.tokenIn as `0x${string}`,
        tokenOut: params.tokenOut as `0x${string}`,
        fee: params.fee,
        recipient: params.recipient as `0x${string}`,
        deadline,
        amountIn: params.amountIn,
        amountOutMinimum: params.amountOutMinimum,
        sqrtPriceLimitX96: BigInt(0),
      }],
    }),
    value: "0x0",
  };
}

export function buildApprovalTx(tokenAddress: string, spender: string, amountRaw: bigint): RawSwapTx {
  return {
    to: tokenAddress,
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [spender as `0x${string}`, amountRaw] }),
    value: "0x0",
  };
}

/** Deep links so the user can always finish the swap manually on the DEX site. */
export function dexDeepLink(chainId: ExecutionChainId, dexLabel: string, tokenIn: string, tokenOut: string): string | null {
  const input = `token0=${tokenIn}`;
  const output = `&token1=${tokenOut}`;
  switch (dexLabel.toLowerCase()) {
    case "uniswap quote api": {
      const slug: Record<ExecutionChainId, string> = { ethereum: "ethereum", arbitrum: "arbitrum", polygon: "polygon", base: "base", optimism: "optimism", bsc: "bnb", sepolia: "sepolia" };
      return `https://app.uniswap.org/swap?chain=${slug[chainId]}&currency0=${tokenIn}&currency1=${tokenOut}`;
    }
    case "sushi aggregator":
      return `https://www.sushi.com/${chainId === "bsc" ? "bnb" : chainId}/swap?${input}${output}`;
    default:
      return null;
  }
}
