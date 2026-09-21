// Shared network helpers: match Upbit net_type against Gate chain names so
// both venues' transfer paths can be compared on the same canonical id.

const NET_ALIASES: Record<string, string> = {
  eth: "eth", ethereum: "eth",
  btc: "btc", bitcoin: "btc",
  bsc: "bsc", bnb: "bsc",
  matic: "matic", polygon: "matic",
  trx: "trx", tron: "trx",
  arb: "arb", arbitrum: "arb",
  op: "op", optimism: "op",
  avax: "avax", avalanche: "avax", avalanchec: "avax",
  sol: "sol", solana: "sol",
  ada: "ada", cardano: "ada",
  xrp: "xrp", ripple: "xrp",
  doge: "doge", dogecoin: "doge",
  ltc: "ltc", litecoin: "ltc",
  dot: "dot", polkadot: "dot",
  atom: "atom", cosmos: "atom",
  kaia: "kaia", klay: "kaia", klaytn: "kaia",
  apt: "apt", aptos: "apt",
  sui: "sui", sei: "sei",
  inj: "inj", injective: "inj",
  tia: "tia", celestia: "tia",
  base: "base", blast: "blast",
  linea: "linea", scroll: "scroll", zksync: "zksync",
  mnt: "mnt", mantle: "mnt",
  near: "near", hbar: "hbar", hedera: "hbar",
  algo: "algo", algorand: "algo",
  xlm: "xlm", stellar: "xlm",
  ftm: "ftm", fantom: "ftm",
  one: "one", harmony: "one",
  fil: "fil", filecoin: "fil",
  ar: "ar", arweave: "ar",
  etc: "etc", bch: "bch",
  xtz: "xtz", tezos: "xtz",
  eos: "eos", neo: "neo",
};

export function normNet(raw: string): string {
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  return NET_ALIASES[key] ?? key;
}

export interface UpbitNetState {
  net: string;
  depositOk: boolean;
  withdrawOk: boolean;
}

export interface GateChainState {
  name: string;
  depositOk: boolean;
  withdrawOk: boolean;
}

/** True when at least one network is open on both sides (direct transfer possible). */
export function hasDirectTransfer(
  upbit: UpbitNetState[],
  gate: GateChainState[],
): boolean {
  const gateById = new Map<string, GateChainState>();
  for (const c of gate) {
    const id = normNet(c.name);
    if (!gateById.has(id)) gateById.set(id, c);
  }
  return upbit.some(u => {
    if (!u.depositOk || !u.withdrawOk) return false;
    const g = gateById.get(normNet(u.net));
    return !!g && g.depositOk && g.withdrawOk;
  });
}
