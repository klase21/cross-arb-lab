import { createWalletClient, createPublicClient, custom, http } from "viem";
import { mainnet, arbitrum, polygon, base, optimism, bsc, sepolia } from "viem/chains";
import { CHAINS, type ChainId } from "./dex-config";

/** Chains the executor can operate on — mainnet chains plus the Sepolia testnet. */
export type ExecutionChainId = ChainId | "sepolia";

export function getViemChain(chainId: ExecutionChainId) {
  switch (chainId) {
    case "ethereum": return mainnet;
    case "arbitrum": return arbitrum;
    case "polygon": return polygon;
    case "base": return base;
    case "optimism": return optimism;
    case "bsc": return bsc;
    case "sepolia": return sepolia;
    default: return mainnet;
  }
}

export function chainMeta(chainId: ExecutionChainId): { name: string; numericId: number } {
  if (chainId === "sepolia") return { name: "Sepolia", numericId: 11155111 };
  const config = CHAINS[chainId];
  return { name: config.name, numericId: config.chainId };
}

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function getInjectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

export function hasInjectedWallet(): boolean {
  return getInjectedProvider() !== null;
}

export async function connectInjected(): Promise<string[]> {
  const provider = getInjectedProvider();
  if (!provider) throw new Error("No injected wallet found. Install MetaMask or another browser wallet.");
  const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
  return accounts;
}

export async function getConnectedAddress(): Promise<string | null> {
  const provider = getInjectedProvider();
  if (!provider) return null;
  try {
    const accounts = await provider.request({ method: "eth_accounts" }) as string[];
    return accounts[0] ?? null;
  } catch {
    return null;
  }
}

/** Current hex chain id of the injected wallet (e.g. "0x89" for Polygon). */
export async function getWalletChainHex(): Promise<string | null> {
  const provider = getInjectedProvider();
  if (!provider) return null;
  try {
    return await provider.request({ method: "eth_chainId" }) as string;
  } catch {
    return null;
  }
}

const CHAIN_ID_HEX: Record<ExecutionChainId, string> = {
  ethereum: "0x1",
  arbitrum: "0xa4b1",
  polygon: "0x89",
  base: "0x2105",
  optimism: "0xa",
  bsc: "0x38",
  sepolia: "0xaa36a7",
};

/** Switch the injected wallet to the given chain, adding it if unknown. */
export async function ensureChain(chainId: ExecutionChainId): Promise<void> {
  const provider = getInjectedProvider();
  if (!provider) throw new Error("No injected wallet found.");
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX[chainId] }],
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 4902 || code === -32603) {
      const viemChain = getViemChain(chainId);
      const meta = chainMeta(chainId);
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CHAIN_ID_HEX[chainId],
          chainName: meta.name,
          nativeCurrency: viemChain.nativeCurrency,
          rpcUrls: chainId === "sepolia" ? ["https://ethereum-sepolia-rpc.publicnode.com"] : [CHAINS[chainId as ChainId].rpcUrl],
          blockExplorers: viemChain.blockExplorers ? [viemChain.blockExplorers.default.url] : undefined,
        }],
      });
      return;
    }
    throw error;
  }
}

export function walletClientFor(chainId: ExecutionChainId) {
  const provider = getInjectedProvider();
  if (!provider) throw new Error("No injected wallet found.");
  return createWalletClient({ chain: getViemChain(chainId), transport: custom(provider) });
}

export function publicClientFor(chainId: ExecutionChainId) {
  const viemChain = getViemChain(chainId);
  const rpcUrl = chainId === "sepolia" ? "https://ethereum-sepolia-rpc.publicnode.com" : CHAINS[chainId as ChainId].rpcUrl;
  return createPublicClient({ chain: viemChain, transport: http(rpcUrl) });
}

export function subscribeWalletEvents(handlers: {
  onAccountsChanged?: (accounts: string[]) => void;
  onChainChanged?: (chainHex: string) => void;
}): () => void {
  const provider = getInjectedProvider();
  if (!provider?.on || !provider.removeListener) return () => {};
  const accountsHandler = (accounts: string[]) => handlers.onAccountsChanged?.(accounts);
  const chainHandler = (chainHex: string) => handlers.onChainChanged?.(chainHex);
  provider.on("accountsChanged", accountsHandler as never);
  provider.on("chainChanged", chainHandler as never);
  return () => {
    provider.removeListener!("accountsChanged", accountsHandler as never);
    provider.removeListener!("chainChanged", chainHandler as never);
  };
}
