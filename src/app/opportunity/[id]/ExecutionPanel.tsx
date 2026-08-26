"use client";

import { useEffect, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { CHAIN_DEXES, type ChainId } from "@/lib/dex-config";
import { getSushiQuote, getUniswapWebQuote } from "@/lib/web-quotes";
import {
  chainMeta, connectInjected, ensureChain, getConnectedAddress, getInjectedProvider,
  publicClientFor, walletClientFor,
} from "@/lib/wallet";
import type { ExecutionChainId } from "@/lib/wallet";
import {
  buildApprovalTx, buildTestnetSwapTx, dexDeepLink, ERC20_ABI, fetchSushiSwapTx, fetchUniswapSwapTx,
  quoteTestnetSwap, TESTNET,
} from "@/lib/swaps";

interface ExecutionPanelProps {
  baseSymbol: string;
  quoteSymbol: string;
  chainId: ChainId;
  dexLabel: string;
}

type BusyStep = "connect" | "chain" | "approve" | "swap" | null;

const EXPLORERS: Record<ExecutionChainId, string> = {
  ethereum: "https://etherscan.io",
  arbitrum: "https://arbiscan.io",
  polygon: "https://polygonscan.com",
  base: "https://basescan.org",
  optimism: "https://optimistic.etherscan.io",
  bsc: "https://bscscan.com",
  sepolia: "https://sepolia.etherscan.io",
};

export default function ExecutionPanel({ baseSymbol, quoteSymbol, chainId, dexLabel }: ExecutionPanelProps) {
  const [testnet, setTestnet] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [amount, setAmount] = useState("1");
  const [quoteOut, setQuoteOut] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyStep>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    setHasWallet(Boolean(getInjectedProvider()));
    getConnectedAddress().then(found => { if (found) setAddress(found); });
  }, []);

  const appendLog = (line: string) => setLog(previous => [...previous, line]);

  const chainIdEff: ExecutionChainId = testnet ? "sepolia" : chainId;
  const chainDexes = CHAIN_DEXES.find(item => item.chain === chainId);
  const baseTokenMain = chainDexes?.tokens[baseSymbol];
  const quoteTokenMain = chainDexes?.tokens[quoteSymbol];
  const testnetBase = { address: TESTNET.weth, decimals: TESTNET.wethDecimals, symbol: "WETH" };
  const testnetQuote = { address: TESTNET.usdc, decimals: TESTNET.usdcDecimals, symbol: "USDC" };
  const baseToken = testnet ? testnetBase : baseTokenMain;
  const quoteToken = testnet ? testnetQuote : quoteTokenMain;
  const chainLabel = testnet ? TESTNET.chainId : chainId;
  const displayBase = testnet ? "WETH" : baseSymbol;
  const displayQuote = testnet ? "USDC" : quoteSymbol;
  const displayChainName = chainMeta(chainIdEff).name;
  const displayDex = testnet ? "Sepolia V3 Router" : dexLabel;
  const numericChainId = chainMeta(chainIdEff).numericId;
  const amountRaw = (() => {
    try {
      return parseUnits(amount || "0", baseToken?.decimals ?? 18);
    } catch {
      return BigInt(0);
    }
  })();

  async function handleConnect() {
    setError(null);
    setBusy("connect");
    try {
      const accounts = await connectInjected();
      setAddress(accounts[0]);
      appendLog(`Wallet connected: ${accounts[0].slice(0, 6)}…${accounts[0].slice(-4)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function handleSwitchChain() {
    setError(null);
    setBusy("chain");
    try {
      await ensureChain(chainIdEff);
      appendLog(`Network switched to ${chainMeta(chainIdEff).name}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function refreshQuote() {
    setError(null);
    setQuoteOut(null);
    if (!amountRaw || !baseToken || !quoteToken) return;
    try {
      if (testnet) {
        const publicClient = publicClientFor("sepolia");
        const result = await quoteTestnetSwap(publicClient as never, amountRaw, baseToken.address, quoteToken.address);
        if (result) {
          setQuoteOut(formatUnits(result.amountOut, quoteToken.decimals));
          appendLog(`Testnet quote: fee ${(result.fee / 10000).toFixed(2)}%`);
        } else {
          appendLog("Testnet: no pool found for this pair at any fee tier.");
        }
      } else {
        const result = dexLabel.toLowerCase() === "sushi aggregator"
          ? await getSushiQuote(chainId, baseToken.address, quoteToken.address, amountRaw, quoteToken.decimals)
          : await getUniswapWebQuote(chainId, baseToken.address, quoteToken.address, amountRaw, quoteToken.decimals);
        if (result) {
          setQuoteOut(formatUnits(result.amountOut, result.outDecimals));
        } else {
          appendLog("Quote API returned no route right now.");
        }
      }
    } catch (cause) {
      appendLog(`Quote failed: ${cause instanceof Error ? cause.message.slice(0, 160) : String(cause)}`);
    }
  }

  async function handleApproveAndSwap() {
    setError(null);
    setTxHash(null);
    if (!baseToken || !quoteToken) { setError("Unknown tokens for this pair."); return; }
    if (!amountRaw || amountRaw <= BigInt(0)) { setError("Enter an amount greater than zero."); return; }

    const connected = address ?? await getConnectedAddress();
    if (!connected) { setError("Connect your wallet first."); return; }
    const wallet = walletClientFor(chainIdEff);
    const publicClient = publicClientFor(chainIdEff);

    try {
      if (testnet) {
        // Testnet path: direct V3 router, spender known upfront
        setBusy("approve");
        const quote = await quoteTestnetSwap(publicClient as never, amountRaw, baseToken.address, quoteToken.address);
        if (!quote) throw new Error("Testnet: no pool found for WETH/USDC. Try a smaller amount or check Sepolia pool liquidity.");
        const minOut = (quote.amountOut * BigInt(95)) / BigInt(100);
        appendLog(`Testnet quote: 1 WETH ≈ ${formatUnits(quote.amountOut, quoteToken.decimals)} USDC (fee ${(quote.fee / 10000).toFixed(2)}%, min ${(Number(minOut) / 1e6).toFixed(2)} with 5% slippage)`);

        const allowance = await publicClient.readContract({
          address: baseToken.address as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [connected as `0x${string}`, TESTNET.router as `0x${string}`],
        }) as bigint;

        if (allowance < amountRaw) {
          appendLog(`Approving ${displayBase} to router…`);
          const approvalTx = buildApprovalTx(baseToken.address, TESTNET.router, amountRaw);
          const approveHash = await wallet.sendTransaction({
            account: connected as `0x${string}`,
            to: approvalTx.to as `0x${string}`,
            data: approvalTx.data as `0x${string}`,
          });
          appendLog(`Approval sent: ${approveHash}`);
          const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
          if (approveReceipt.status !== "success") throw new Error("Approval transaction failed on-chain.");
          appendLog("Approval confirmed.");
        } else {
          appendLog("Sufficient allowance already granted.");
        }

        setBusy("swap");
        appendLog("Simulating swap (eth_call)…");
        const swapTx = buildTestnetSwapTx({
          tokenIn: baseToken.address,
          tokenOut: quoteToken.address,
          fee: quote.fee,
          recipient: connected,
          amountIn: amountRaw,
          amountOutMinimum: minOut,
        });
        await publicClient.call({
          account: connected as `0x${string}`,
          to: swapTx.to as `0x${string}`,
          data: swapTx.data as `0x${string}`,
          value: swapTx.value ? BigInt(swapTx.value) : BigInt(0),
        });
        appendLog("Simulation passed. Sending transaction…");

        const hash = await wallet.sendTransaction({
          account: connected as `0x${string}`,
          to: swapTx.to as `0x${string}`,
          data: swapTx.data as `0x${string}`,
          value: swapTx.value ? BigInt(swapTx.value) : BigInt(0),
        });
        setTxHash(hash);
        appendLog(`Swap sent: ${hash}`);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status === "success") {
          appendLog(`Swap confirmed!`);
        } else {
          throw new Error("Swap transaction reverted on-chain.");
        }
        return;
      }

      // Mainnet aggregator path
      setBusy("approve");
      appendLog(`Requesting swap transaction from ${dexLabel}…`);
      let swapTx;
      try {
        swapTx = dexLabel.toLowerCase() === "sushi aggregator"
          ? await fetchSushiSwapTx({ numericChainId, tokenIn: baseToken.address, tokenOut: quoteToken.address, amountRaw, recipient: connected, slippagePct: 0.5 })
          : await fetchUniswapSwapTx({ numericChainId, tokenIn: baseToken.address, tokenOut: quoteToken.address, amountRaw, recipient: connected, slippagePct: 0.5 });
        appendLog(`Router: ${swapTx.to}`);
      } catch (cause) {
        throw new Error(`${cause instanceof Error ? cause.message : String(cause)} — you can still execute manually via the DEX link below.`);
      }

      const allowance = await publicClient.readContract({
        address: baseToken.address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [connected as `0x${string}`, swapTx.to as `0x${string}`],
      }) as bigint;

      if (allowance < amountRaw) {
        appendLog(`Approving ${displayBase}…`);
        const approvalTx = buildApprovalTx(baseToken.address, swapTx.to, amountRaw);
        const approveHash = await wallet.sendTransaction({
          account: connected as `0x${string}`,
          to: approvalTx.to as `0x${string}`,
          data: approvalTx.data as `0x${string}`,
        });
        appendLog(`Approval sent: ${approveHash}`);
        const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
        if (approveReceipt.status !== "success") throw new Error("Approval transaction failed on-chain.");
        appendLog("Approval confirmed.");
      } else {
        appendLog("Sufficient allowance already granted.");
      }

      setBusy("swap");
      appendLog("Simulating swap (eth_call)…");
      await publicClient.call({
        account: connected as `0x${string}`,
        to: swapTx.to as `0x${string}`,
        data: swapTx.data as `0x${string}`,
        value: swapTx.value ? BigInt(swapTx.value) : BigInt(0),
      });
      appendLog("Simulation passed. Sending transaction…");

      const hash = await wallet.sendTransaction({
        account: connected as `0x${string}`,
        to: swapTx.to as `0x${string}`,
        data: swapTx.data as `0x${string}`,
        value: swapTx.value ? BigInt(swapTx.value) : BigInt(0),
      });
      setTxHash(hash);
      appendLog(`Swap sent: ${hash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "success") {
        appendLog(`Swap confirmed! Received ~${quoteOut ?? "?"} ${displayQuote}.`);
      } else {
        throw new Error("Swap transaction reverted on-chain.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  const deepLink = baseToken && quoteToken ? dexDeepLink(chainIdEff, dexLabel, baseToken.address, quoteToken.address) : null;

  return (
    <div className="rounded-xl border border-cyan-900/60 bg-gradient-to-b from-cyan-950/10 to-zinc-900/40 p-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h2 className="text-base font-semibold">Live Execution</h2>
        <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
          <button onClick={() => { setTestnet(value => !value); setQuoteOut(null); setError(null); setTxHash(null); setLog([]); }} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${testnet ? "bg-cyan-600" : "bg-zinc-700"}`}>
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${testnet ? "translate-x-[18px]" : "translate-x-1"}`} />
          </button>
          Testnet (Sepolia)
        </label>
      </div>
      <p className="text-xs text-zinc-500 mb-4">
        {testnet
          ? `Testnet: WETH → USDC on Sepolia via V3 SwapRouter (${TESTNET.router.slice(0, 6)}…). No real funds — safe to test the full flow.`
          : `Swap ${baseSymbol} → ${quoteSymbol} on ${chainMeta(chainIdEff).name} via ${dexLabel}. Upbit buy & withdrawal are manual — this panel automates the on-chain leg only.`}
      </p>

      {testnet && (
        <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/20 p-3 text-xs text-zinc-400 mb-4">
          <p className="font-medium text-cyan-300 mb-1">Sepolia faucets</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>ETH: <a href="https://sepoliafaucet.com" target="_blank" rel="noreferrer" className="text-cyan-400 underline">sepoliafaucet.com</a> or Alchemy faucet</li>
            <li>USDC: <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="text-cyan-400 underline">faucet.circle.com</a> (select Sepolia, USDC)</li>
            <li>WETH: wrap Sepolia ETH on <a href="https://app.uniswap.org/swap?chain=sepolia&currency0=NATIVE&currency1=0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" target="_blank" rel="noreferrer" className="text-cyan-400 underline">Uniswap Sepolia</a></li>
          </ul>
        </div>
      )}

      {!testnet && (
        <ol className="text-sm text-zinc-400 space-y-1 mb-5 list-decimal list-inside">
          <li>Buy {baseSymbol} on Upbit (KRW market)</li>
          <li>Withdraw to your wallet on <strong>{displayChainName}</strong></li>
          <li>Execute the swap below once funds arrive</li>
        </ol>
      )}

      {!hasWallet ? (
        <p className="text-sm text-red-400">No browser wallet detected. Install MetaMask or open this page in a wallet-enabled browser.</p>
      ) : !address ? (
        <button onClick={handleConnect} disabled={busy !== null} className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-sm font-medium text-white">
          {busy === "connect" ? "Connecting…" : "Connect Wallet"}
        </button>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap mb-4">
            <span className="text-sm text-emerald-400 font-mono">{address.slice(0, 6)}…{address.slice(-4)}</span>
            <button onClick={handleSwitchChain} disabled={busy !== null} className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-cyan-500 text-xs text-zinc-300 disabled:opacity-50">
              Switch to {testnet ? "Sepolia" : chainMeta(chainIdEff).name}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 items-end mb-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5">Amount ({displayBase})</label>
              <input
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={event => setAmount(event.target.value)}
                className="w-full md:w-56 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-cyan-500"
              />
            </div>
            <button onClick={refreshQuote} disabled={busy !== null} className="px-3 py-2 rounded-lg border border-zinc-700 hover:border-cyan-500 text-sm text-zinc-300 disabled:opacity-50">Get Quote</button>
            <button onClick={handleApproveAndSwap} disabled={busy !== null || !Number(amount)} className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-sm font-medium text-white">
              {busy === "approve" ? "Preparing…" : busy === "swap" ? "Swapping…" : "Approve & Swap"}
            </button>
          </div>

          {quoteOut && (
            <p className="text-sm mb-4">
              Expected output: <strong className="text-emerald-400">{Number(quoteOut).toLocaleString("en-US", { maximumFractionDigits: 6 })} {displayQuote}</strong> (slippage limit 5%)
            </p>
          )}

          {txHash && (
            <p className="text-xs text-zinc-400 mb-3 break-all">
              Tx: <a href={`${EXPLORERS[chainIdEff]}/tx/${txHash}`} target="_blank" rel="noreferrer" className="text-cyan-400 underline">{txHash}</a>
            </p>
          )}

          {deepLink && !testnet && (
            <p className="text-xs text-zinc-500 mb-3">
              Manual fallback: <a href={deepLink} target="_blank" rel="noreferrer" className="text-cyan-400 underline">open this pair on the DEX site</a>
            </p>
          )}

          {log.length > 0 && (
            <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-3 text-xs font-mono space-y-1 max-h-48 overflow-y-auto">
              {log.map((line, index) => <p key={index} className="text-zinc-400">{line}</p>)}
            </div>
          )}
        </>
      )}

      {error && <div className="mt-4 rounded-lg border border-red-900/70 bg-red-950/30 px-4 py-3 text-sm text-red-300 break-all">{error}</div>}
    </div>
  );
}
