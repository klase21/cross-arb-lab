export type ChainId = "ethereum" | "arbitrum" | "polygon" | "base" | "optimism" | "bsc";

export interface ChainConfig {
  id: ChainId;
  name: string;
  rpcUrl: string;
  chainId: number;
  nativeToken: string;
}

export interface DexConfig {
  name: string;
  routerAddress: string;
  quoterAddress?: string;
  quoterVersion?: "v1" | "v2";
  type: "uniswap-v3" | "uniswap-v2";
  feeTiers: number[];
}

export interface TokenInfo {
  address: string;
  decimals: number;
}

export interface ChainDexes {
  chain: ChainId;
  dexes: DexConfig[];
  tokens: Record<string, TokenInfo>;
  pairs: { base: string; quote: string }[];
}

export const CHAINS: Record<ChainId, ChainConfig> = {
  ethereum: {
    id: "ethereum",
    name: "Ethereum",
    rpcUrl: process.env.ETHEREUM_RPC_URL ?? "https://ethereum-rpc.publicnode.com",
    chainId: 1,
    nativeToken: "ETH",
  },
  arbitrum: {
    id: "arbitrum",
    name: "Arbitrum",
    rpcUrl: process.env.ARBITRUM_RPC_URL ?? "https://arbitrum-one-rpc.publicnode.com",
    chainId: 42161,
    nativeToken: "ETH",
  },
  polygon: {
    id: "polygon",
    name: "Polygon",
    rpcUrl: process.env.POLYGON_RPC_URL ?? "https://polygon-bor-rpc.publicnode.com",
    chainId: 137,
    nativeToken: "POL",
  },
  base: {
    id: "base",
    name: "Base",
    rpcUrl: process.env.BASE_RPC_URL ?? "https://base-rpc.publicnode.com",
    chainId: 8453,
    nativeToken: "ETH",
  },
  optimism: {
    id: "optimism",
    name: "Optimism",
    rpcUrl: process.env.OPTIMISM_RPC_URL ?? "https://optimism-rpc.publicnode.com",
    chainId: 10,
    nativeToken: "ETH",
  },
  bsc: {
    id: "bsc",
    name: "BNB Chain",
    rpcUrl: process.env.BSC_RPC_URL ?? "https://bsc-rpc.publicnode.com",
    chainId: 56,
    nativeToken: "BNB",
  },
};

export const CHAIN_DEXES: ChainDexes[] = [
  {
    chain: "ethereum",
    dexes: [
      {
        name: "Uniswap V3",
        quoterAddress: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
        routerAddress: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        type: "uniswap-v3",
        feeTiers: [100, 500, 3000, 10000],
      },
    ],
    tokens: {
      USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
      USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
      WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
      WBTC: { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8 },
      DAI: { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 },
      LINK: { address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18 },
      UNI: { address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18 },
      AAVE: { address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", decimals: 18 },
      CRV: { address: "0xD533a949740bb3306d119CC777fa900bA034cd52", decimals: 18 },
      MKR: { address: "0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2", decimals: 18 },
      PEPE: { address: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", decimals: 18 },
      SHIB: { address: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", decimals: 18 },
    },
    pairs: [
      { base: "WETH", quote: "USDC" },
      { base: "WETH", quote: "USDT" },
      { base: "WETH", quote: "DAI" },
      { base: "WBTC", quote: "USDC" },
      { base: "WBTC", quote: "WETH" },
      { base: "LINK", quote: "WETH" },
      { base: "UNI", quote: "WETH" },
      { base: "AAVE", quote: "WETH" },
      { base: "CRV", quote: "WETH" },
      { base: "MKR", quote: "WETH" },
      { base: "PEPE", quote: "WETH" },
      { base: "SHIB", quote: "WETH" },
      { base: "USDC", quote: "USDT" },
      { base: "USDC", quote: "DAI" },
      { base: "LINK", quote: "USDC" },
      { base: "UNI", quote: "USDC" },
      { base: "AAVE", quote: "USDC" },
      { base: "CRV", quote: "USDC" },
      { base: "PEPE", quote: "USDC" },
      { base: "SHIB", quote: "USDC" },
    ],
  },
  {
    chain: "arbitrum",
    dexes: [
      {
        name: "Uniswap V3 (Arb)",
        quoterAddress: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
        routerAddress: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        type: "uniswap-v3",
        feeTiers: [100, 500, 3000, 10000],
      },
      {
        name: "Camelot",
        routerAddress: "0xc873fEcbd354f5A56E00E710B90EF4201db2448d",
        type: "uniswap-v2",
        feeTiers: [2500],
      },
      {
        name: "SushiSwap (Arb)",
        routerAddress: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
        type: "uniswap-v2",
        feeTiers: [3000],
      },
    ],
    tokens: {
      USDC: { address: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", decimals: 6 },
      USDC_NATIVE: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
      WETH: { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
      WBTC: { address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8 },
      ARB: { address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18 },
      GMX: { address: "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a", decimals: 18 },
      MAGIC: { address: "0x539bdE0d7Dbd336b79148AA742883198BBF60342", decimals: 18 },
      LINK: { address: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", decimals: 18 },
      UNI: { address: "0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0", decimals: 18 },
      PENDLE: { address: "0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8", decimals: 18 },
      GRT: { address: "0x9623063377AD1B27544C965cCd7342f7EA7e88C7", decimals: 18 },
    },
    pairs: [
      { base: "WETH", quote: "USDC" },
      { base: "WETH", quote: "USDC_NATIVE" },
      { base: "WBTC", quote: "USDC" },
      { base: "ARB", quote: "WETH" },
      { base: "GMX", quote: "WETH" },
      { base: "MAGIC", quote: "WETH" },
      { base: "LINK", quote: "WETH" },
      { base: "UNI", quote: "WETH" },
      { base: "PENDLE", quote: "WETH" },
      { base: "GRT", quote: "WETH" },
      { base: "ARB", quote: "USDC_NATIVE" },
      { base: "GMX", quote: "USDC_NATIVE" },
      { base: "USDC", quote: "USDC_NATIVE" },
    ],
  },
  {
    chain: "polygon",
    dexes: [
      {
        name: "Uniswap V3 (Polygon)",
        quoterAddress: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
        routerAddress: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        type: "uniswap-v3",
        feeTiers: [100, 500, 3000, 10000],
      },
      {
        name: "QuickSwap",
        routerAddress: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff",
        type: "uniswap-v2",
        feeTiers: [3000],
      },
      {
        name: "SushiSwap (Polygon)",
        routerAddress: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
        type: "uniswap-v2",
        feeTiers: [3000],
      },
    ],
    tokens: {
      USDC: { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
      USDC_BRIDGED: { address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", decimals: 6 },
      WETH: { address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18 },
      WPOL: { address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", decimals: 18 },
      WBTC: { address: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", decimals: 8 },
      AAVE: { address: "0xD6DF932A45C0f255f85145f286eA0b292B21C90B", decimals: 18 },
      LINK: { address: "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39", decimals: 18 },
      UNI: { address: "0xb33EaAd8d922B1083446DC23f610c2567fB5180f", decimals: 18 },
      CRV: { address: "0x172370d5Cd63279eFa6d502DAB29171933a610AF", decimals: 18 },
      GHST: { address: "0x385Eeac5cB85A38A9a07A70c73e0a3271CfB54A7", decimals: 18 },
    },
    pairs: [
      { base: "WETH", quote: "USDC" },
      { base: "WETH", quote: "WPOL" },
      { base: "WBTC", quote: "USDC" },
      { base: "AAVE", quote: "WETH" },
      { base: "LINK", quote: "WETH" },
      { base: "UNI", quote: "WETH" },
      { base: "CRV", quote: "WETH" },
      { base: "GHST", quote: "WETH" },
      { base: "LINK", quote: "USDC" },
      { base: "AAVE", quote: "USDC" },
      { base: "USDC", quote: "USDC_BRIDGED" },
      { base: "WPOL", quote: "USDC" },
    ],
  },
  {
    chain: "base",
    dexes: [
      {
        name: "Uniswap V3 (Base)",
        quoterAddress: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
        quoterVersion: "v2",
        routerAddress: "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
        type: "uniswap-v3",
        feeTiers: [100, 500, 3000, 10000],
      },
      {
        name: "BaseSwap",
        routerAddress: "0x327Df1E6de05895d2ab08513aaDD9313Fe505d86",
        type: "uniswap-v2",
        feeTiers: [2500],
      },
    ],
    tokens: {
      USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
      WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
      DEGEN: { address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", decimals: 18 },
      AERO: { address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
      BRETT: { address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", decimals: 18 },
      VIRTUAL: { address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", decimals: 18 },
      TOSHI: { address: "0xAC1Bbd6f7e8a0833e51D6B3FbB36a54eb8E9d6A6", decimals: 18 },
      DAI: { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
    },
    pairs: [
      { base: "WETH", quote: "USDC" },
      { base: "WETH", quote: "DAI" },
      { base: "DEGEN", quote: "WETH" },
      { base: "AERO", quote: "WETH" },
      { base: "BRETT", quote: "WETH" },
      { base: "VIRTUAL", quote: "WETH" },
      { base: "TOSHI", quote: "WETH" },
      { base: "AERO", quote: "USDC" },
    ],
  },
  {
    chain: "optimism",
    dexes: [
      {
        name: "Uniswap V3 (Opt)",
        quoterAddress: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
        routerAddress: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        type: "uniswap-v3",
        feeTiers: [100, 500, 3000, 10000],
      },
      {
        name: "SushiSwap (Opt)",
        routerAddress: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
        type: "uniswap-v2",
        feeTiers: [3000],
      },
    ],
    tokens: {
      USDC: { address: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607", decimals: 6 },
      USDC_NATIVE: { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
      WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
      OP: { address: "0x4200000000000000000000000000000000000042", decimals: 18 },
      VELO: { address: "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db", decimals: 18 },
      LINK: { address: "0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6", decimals: 18 },
      SNX: { address: "0x8700dAec35aF8Ff88c16BdF0418774CB3D7599B4", decimals: 18 },
    },
    pairs: [
      { base: "WETH", quote: "USDC" },
      { base: "OP", quote: "WETH" },
      { base: "VELO", quote: "WETH" },
      { base: "LINK", quote: "WETH" },
      { base: "SNX", quote: "WETH" },
      { base: "OP", quote: "USDC" },
      { base: "USDC", quote: "USDC_NATIVE" },
    ],
  },
  {
    chain: "bsc",
    dexes: [
      {
        name: "PancakeSwap V3",
        quoterAddress: "0x78D78E420Da98ad378D7799BE8f4AF69033EB077",
        quoterVersion: "v2",
        routerAddress: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
        type: "uniswap-v3",
        feeTiers: [100, 500, 2500, 10000],
      },
      {
        name: "PancakeSwap V2",
        routerAddress: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
        type: "uniswap-v2",
        feeTiers: [2500],
      },
      {
        name: "BiSwap",
        routerAddress: "0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8",
        type: "uniswap-v2",
        feeTiers: [2000],
      },
    ],
    tokens: {
      USDT: { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
      BUSD: { address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", decimals: 18 },
      WBNB: { address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18 },
      CAKE: { address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", decimals: 18 },
      ETH_BSC: { address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18 },
      BTC_BSC: { address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", decimals: 18 },
      LINK: { address: "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD", decimals: 18 },
      UNI: { address: "0xBf5140A22578168FD562DCcF235E5D43A02ce9B1", decimals: 18 },
      ADA: { address: "0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47", decimals: 18 },
      XRP: { address: "0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE", decimals: 18 },
      DOGE: { address: "0xbA2aE424d960c26247Dd6c32edC70B295c744C43", decimals: 8 },
    },
    pairs: [
      { base: "WBNB", quote: "USDT" },
      { base: "WBNB", quote: "BUSD" },
      { base: "CAKE", quote: "WBNB" },
      { base: "ETH_BSC", quote: "USDT" },
      { base: "BTC_BSC", quote: "USDT" },
      { base: "USDT", quote: "BUSD" },
      { base: "LINK", quote: "USDT" },
      { base: "UNI", quote: "USDT" },
      { base: "ADA", quote: "USDT" },
      { base: "XRP", quote: "USDT" },
      { base: "DOGE", quote: "USDT" },
      { base: "ETH_BSC", quote: "WBNB" },
    ],
  },
];
