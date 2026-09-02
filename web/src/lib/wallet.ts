import { createWalletClient, custom, type EIP1193Provider, type WalletClient } from "viem";
import { botTestnet } from "./chain";

/** EIP-6963 announcement. Wallets broadcast these instead of racing for
 *  window.ethereum, which is what makes multiple extensions usable at once. */
export interface WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}
export interface DiscoveredWallet {
  info: WalletInfo;
  provider: EIP1193Provider;
}

type AnnounceEvent = CustomEvent<unknown>;

function isProvider(value: unknown): value is EIP1193Provider {
  return Boolean(value && typeof value === "object" && typeof (value as { request?: unknown }).request === "function");
}

function announcedWallet(value: unknown): DiscoveredWallet | null {
  if (!value || typeof value !== "object") return null;
  const detail = value as { info?: Partial<WalletInfo>; provider?: unknown };
  const info = detail.info;
  if (
    typeof info?.uuid !== "string" ||
    typeof info.name !== "string" ||
    typeof info.rdns !== "string" ||
    !isProvider(detail.provider)
  ) return null;
  return {
    info: {
      uuid: info.uuid,
      name: info.name,
      icon: info.icon ?? "",
      rdns: info.rdns,
    },
    provider: detail.provider,
  };
}

/**
 * In-app wallet browsers (MetaMask Mobile, Trust, Coinbase Wallet) inject a
 * provider directly and often predate EIP-6963. Detected by capability rather
 * than by user-agent string, per RESEARCH.txt PART 10.
 */
export function isInjectedWalletBrowser(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as { ethereum?: unknown }).ethereum) && /Mobi|Android/i.test(navigator.userAgent);
}

/** Collects announcements for a moment, then adds legacy injected providers
 * that did not announce through EIP-6963. */
export function discoverWallets(onChange: (wallets: DiscoveredWallet[]) => void): () => void {
  const found = new Map<string, DiscoveredWallet>();

  const emit = () => onChange([...found.values()]);

  const onAnnounce = (event: Event) => {
    const wallet = announcedWallet((event as AnnounceEvent).detail);
    if (!wallet || found.has(wallet.info.uuid) || [...found.values()].some((item) => item.provider === wallet.provider)) return;
    found.set(wallet.info.uuid, wallet);
    emit();
  };

  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  // Legacy fallback. Runs after announcements have had a tick to arrive so a
  // wallet that supports both does not appear twice.
  const timer = window.setTimeout(() => {
    const ethereum = (window as { ethereum?: unknown }).ethereum;
    const legacyProviders = ethereum && typeof ethereum === "object" && Array.isArray((ethereum as { providers?: unknown }).providers)
      ? (ethereum as { providers: unknown[] }).providers
      : [ethereum];
    let changed = false;
    legacyProviders.forEach((candidate, index) => {
      if (!isProvider(candidate) || [...found.values()].some((item) => item.provider === candidate)) return;
      found.set(`injected-${index}`, {
        info: { uuid: `injected-${index}`, name: legacyProviders.length > 1 ? `Browser Wallet ${index + 1}` : "Browser Wallet", icon: "", rdns: "injected" },
        provider: candidate,
      });
      changed = true;
    });
    if (changed) emit();
  }, 300);

  return () => {
    window.removeEventListener("eip6963:announceProvider", onAnnounce);
    window.clearTimeout(timer);
  };
}

export function walletClientFor(provider: EIP1193Provider, account: `0x${string}`): WalletClient {
  return createWalletClient({ account, chain: botTestnet, transport: custom(provider) });
}

const CHAIN_ID_HEX = `0x${botTestnet.id.toString(16)}`;

/**
 * Moves the wallet to BOT testnet, adding the network first if it is unknown.
 * 4902 is "unrecognised chain"; some wallets nest the code inside `data`.
 */
export async function ensureChain(provider: EIP1193Provider): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (err) {
    const error = err as {
      code?: number | string;
      data?: { code?: number | string; originalError?: { code?: number | string } };
    };
    const codes = [error?.code, error?.data?.code, error?.data?.originalError?.code].map(Number);
    if (!codes.includes(4902)) throw err;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CHAIN_ID_HEX,
          chainName: botTestnet.name,
          nativeCurrency: botTestnet.nativeCurrency,
          rpcUrls: botTestnet.rpcUrls.default.http,
          blockExplorerUrls: [botTestnet.blockExplorers.default.url],
        },
      ],
    } as Parameters<EIP1193Provider["request"]>[0]);

    // Adding a chain does not select it in several wallet implementations.
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  }
}
