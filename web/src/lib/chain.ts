import { defineChain, createPublicClient, http } from "viem";

/** Vite injects import.meta.env in the browser bundle; node running these modules
 *  directly (the parity script) has no such object. Reading through this keeps one
 *  config usable from both. */
const env: Record<string, string | undefined> =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/**
 * BOT Chain testnet. Values confirmed against the live node rather than copied
 * from documentation: eth_chainId returns 0x3c8 (968) and the explorer at
 * scan.bohr.life reports the same, which is how a mainnet URL was caught earlier.
 */
export const botTestnet = defineChain({
  id: 968,
  name: "BOT Chain Testnet",
  nativeCurrency: { name: "tBOT", symbol: "tBOT", decimals: 18 },
  rpcUrls: { default: { http: [env.VITE_RPC_URL ?? "https://rpc.bohr.life"] } },
  blockExplorers: {
    default: { name: "Bohr Scan", url: "https://scan.bohr.life" },
  },
  testnet: true,
});

export const PAYMENT_STREAM_ADDRESS = (env.VITE_PAYMENT_STREAM ??
  "0x2345c73cEdcE23a2959b7259eD3A6d13580ad97e") as `0x${string}`;

/**
 * The block the stream contract was deployed at, used to anchor log scans.
 * Written by script/Deploy.s.sol as a LOWER bound on the real deployment block,
 * which is the safe direction: scanning slightly early can never miss an event.
 */
export const DEPLOY_BLOCK = BigInt(env.VITE_DEPLOY_BLOCK ?? "21975079");

/** Airdrop is not deployed yet; the claim screen degrades to a notice. */
export const AIRDROP_ADDRESS = (env.VITE_AIRDROP ?? "") as `0x${string}` | "";

export const publicClient = createPublicClient({
  chain: botTestnet,
  transport: http(undefined, { batch: true }),
});

export const explorerTx = (hash: string) => `${botTestnet.blockExplorers.default.url}/tx/${hash}`;
export const explorerAddress = (a: string) =>
  `${botTestnet.blockExplorers.default.url}/address/${a}`;
