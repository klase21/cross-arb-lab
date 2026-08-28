# Cross Arb Lab

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Real-time **Kimchi premium tracker** and **cross-chain / cross-exchange arbitrage scanner** for the Korean market. Polls Upbit orderbooks against Binance/Gate/CMC global prices, fetches live Uniswap & Sushi web-quotes across 6 EVM chains, and surfaces net-profitable opportunities with 5-axis risk scoring — all with KRW/USD display and KO/EN toggle.

> Not financial advice. No auto-trading, no private keys. Read-only scanner; execution is manual via your own wallets and exchange accounts.

## Live Demo

[https://cross-arb-lab.vercel.app](https://cross-arb-lab.vercel.app)

> Hosted demo runs with live Upbit / Binance / CMC and DEX web-quote APIs. No login required. Personal settings (thresholds, Telegram) stay in your browser.

## Highlights

- **Kimchi Premium Tracker** — every Upbit KRW pair vs global Ask (Binance bookTicker → Gate fallback → CMC alias), CMC cross-check (≤5% verified), 24h volume, 1h sparkline + Z-Score bands, 1M KRW round-trip P&L with break-even gap.
- **Withdraw Arb (Upbit → DEX)** — buy on Upbit KRW, withdraw, sell on-chain. Uses the exact Uniswap gateway & Sushi aggregator endpoints the web frontends use. Bridge/gas/withdrawal baked into net spread + ROI, with Upbit round-trip scenario.
- **Inventory Arb (CEX → CEX)** — pre-funded on both CEXes (Upbit/Bithumb/Binance/Bybit/OKX), instant hedge with no on-chain move. Dual-currency profit (KRW/USD) and re-balance calculator.
- **Listing Sniper** — watches Binance-listed vs Upbit-missing coins + Upbit market additions. New KRW listing detection (7-day window) with browser/Telegram alert in the premium peak window (first 1–3h).
- **Price Compare (DEX)** — same DEX (Sushi Aggregator / Uniswap Quote API) quoted on ≥2 chains, widest spread first.
- **Trending Tokens** — Dexscreener boosts + Binance/Upbit/CMC new listings merged into one ranked feed. Left list → right large Dexscreener embed (68vh), chart-dominant layout.
- **5-Axis Risk** — liquidity 30 / execution 25 / exchange 20 / token 15 / volatility 10, grade A–F, per-card breakdown bars and detail-page assessment. Execution axis uses wallet-status, gas, bridge and timing simulation.
- **Bilingual & Bi-currency** — KO/EN toggle (tabs, headers, tooltips, Settings) independent of KRW/USD display currency (header toggle + Settings). Coin names use Upbit `korean_name`/`english_name` per `lang`.
- **Recent-Arbs History** — in-memory 24h TTL store records every scan’s opportunities, deduplicated by pair+chains+direction with `seenCount`, exposed at `/api/recent-arbs`.

## Supported chains & venues

| Chain | ChainId | DEX venues (type) | Quote source |
|---|---|---|---|
| Ethereum | 1 | Uniswap V3 | Uniswap gateway + Sushi aggregator |
| Arbitrum | 42161 | Uniswap V3, Camelot, SushiSwap | gateway + Sushi |
| Polygon | 137 | Uniswap V3, QuickSwap, SushiSwap | gateway + Sushi |
| Base | 8453 | Uniswap V3 (v2 quoter), BaseSwap | gateway + Sushi |
| Optimism | 10 | Uniswap V3, SushiSwap | gateway + Sushi |
| BNB Chain | 56 | PancakeSwap V3 (v2) + V2, BiSwap | gateway + Sushi (V3 via Sushi) |

Pairs are chain-native (e.g. `WETH/USDC` on Ethereum, `WBNB/USDT` on BSC, `WPOL/USDC` on Polygon). Spot price is always “sell 1 base for quote” via the same aggregator the UI shows.

CEXes: Upbit (KRW orderbook + wallet status + withdraw fees), Bithumb (`/public/ticker/ALL_KRW`), Binance (`/api/v3/ticker/bookTicker` + `/ticker/price`), Bybit (`/v5/market/tickers`), OKX (`/api/v5/market/tickers`), Gate (`/api/v4/spot/tickers`) as Binance fallback, CMC + CoinGecko as reference.

## Data sources & quoting

- **Orderbooks before last-price** — Upbit `orderbook` top bid/ask and Binance `bookTicker` ask/bid, premium = `(Upbit Bid / FX − Binance Ask)/Binance Ask`.
- **FX** — live USD/KRW from `open.er-api.com` → `frankfurter.dev` fallback, 30-min in-memory cache, sync accessor for cost math.
- **CMC verification** — listing (5k, market-cap sorted) + per-coin market-pairs (24h cache, batched) for symbol-collision correction and `binanceOnCmc` flag, Gate as Alpha fallback.
- **DEX quotes** — exclusively the web-quote APIs: Sushi `api.sushi.com/quote/v7/{chainId}` and Uniswap `entry-gateway.backend-prod.api.uniswap.org/quote` (and `/swap` for execution). No raw RPC pool quoting.
- **Concurrency** — `SCAN_CONCURRENCY` (default 8) worker pool for `scanAllChains`, avoids burst rate-limits.

## Architecture

- **Next.js 16 App Router + React 19 + TypeScript 5 + Tailwind 4 + viem 2**
- **Server routes** (`/api/scan`, `/api/kimchi`, `/api/cex-prices`, `/api/chain-prices`, `/api/hybrid-scan`, `/api/dexscreener`, `/api/trending`, `/api/listing-sniper`, `/api/recent-arbs`, `/api/upbit/wallet-status`) — all `force-dynamic`, layered caches (CMC 10m/24h, wallet 60s, dexscreener 60s, trending 2m, fx 30m, sniper 5m).
- **Lib layer** — `dex-config` (chains/tokens/pairs), `price-scanner` (web-quotes), `arbitrage-engine` (net spread, USD derivation, Upbit directions, stable rows), `calculator-config` (single source for fees/gas/bridge), `risk-scorer` (5-axis), `timing-simulator`, `fx`, `wallet`/`swaps` (injected EIP-1193, Sepolia testnet), `i18n` (KO/EN), `use-currency` (KRW/USD independent), `recent-arbs-store`.
- **UI** — tab container (`/?tab=...`) with hidden calculator/simulator tabs still reachable via direct URL; Settings (`max-w-2xl mx-auto`) holds language + display currency + polling interval + alerts (+ Telegram) + thresholds.
- **No DB, no auth, no telemetry.** Personal state is `localStorage` (favorites, history, settings, sniper alert dedupe) and ignored.

See `AGENTS.md` for the Next.js 16 breaking-change note.

## Safety boundaries

- Read-only scanner; no private keys, no auto-trading, no scheduler.
- Upbit/Binance terms and robots policies remain the user’s responsibility; collection is manual polling of public endpoints, no login automation or bypass.
- Wallet status is informational; execution requires the user to verify the withdraw network — wrong network = permanent loss.
- Risk grades and P&L are estimates; slippage, gas and withdrawal fees vary.

## Screenshots

> Screenshots use live market data; no fixture. Replace `docs/images/*.png` with your own capture.

- `docs/images/kimchi-premium.png` — Kimchi premium table with CMC check, sparkline/Z-Score and risk.
- `docs/images/withdraw-arb.png` — Withdraw arb cards with inventory toggle and risk breakdown.
- `docs/images/opportunity-detail.png` — Upbit round-trip scenario + Dexscreener embed + GMGN safety link.
- `docs/images/trending.png` — Trending unified ranking + large chart (left list → right 68vh iframe).

## Requirements

- Windows 10/11 or macOS/Linux
- PowerShell 5.1 / 7 or bash
- Node.js 20.9+ and npm 10+
- No Playwright, no Docker required

## Quick start

```powershell
git clone https://github.com/klase21/cross-arb-lab.git
Set-Location cross-arb-lab
Copy-Item .env.example .env
npm ci
npm run dev
```

Open `http://localhost:3000` — the header shows 5 tabs: **김치 프리미엄 | 출금 차익 | 보유 차익 | 시세 비교 | 트렌딩 | 설정** (KO) / **Kimchi Premium | Withdraw Arb | Inventory Arb | Price Compare | Trending | Settings** (EN). Calculator/Simulator remain reachable at `/?tab=calculator` and `/?tab=simulator`.

Manual npm setup:

```powershell
npm ci
Copy-Item .env.example .env
npm run typecheck
npm run build
npm run start
```

Environment (optional, all have public fallbacks):

```ini
UNISWAP_API_KEY=JoyCGj29tT4pymvhaGciK4r1aIPvqW6W53xT1fwo
NEXT_PUBLIC_UNISWAP_API_KEY=JoyCGj29tT4pymvhaGciK4r1aIPvqW6W53xT1fwo
SCAN_CONCURRENCY=8
ETHEREUM_RPC_URL=https://ethereum-rpc.publicnode.com
ARBITRUM_RPC_URL=https://arbitrum-one-rpc.publicnode.com
POLYGON_RPC_URL=https://polygon-bor-rpc.publicnode.com
BASE_RPC_URL=https://base-rpc.publicnode.com
OPTIMISM_RPC_URL=https://optimism-rpc.publicnode.com
BSC_RPC_URL=https://bsc-rpc.publicnode.com
```

## Validation

```powershell
npm run typecheck
npm run lint
npm run build
```

`pre-commit` hook runs `tsc --noEmit` and blocks broken commits. `npm run verify` does `typecheck && build`.

## License and contributing

Licensed under the [MIT License](./LICENSE). Issues and PRs are welcome — please run `npm run verify` before pushing.

## Acknowledgements

- Upbit, Binance, Bithumb, Bybit, OKX, Gate, CoinMarketCap, CoinGecko, Dexscreener, Sushi, Uniswap Labs for public market data.
- NearbyJobsMap for README structure inspiration.
