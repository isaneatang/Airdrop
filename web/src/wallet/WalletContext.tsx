import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { EIP1193Provider, WalletClient } from "viem";
import { botTestnet } from "../lib/chain";
import { discoverWallets, ensureChain, walletClientFor, type DiscoveredWallet } from "../lib/wallet";

interface WalletState {
  wallets: DiscoveredWallet[];
  account: `0x${string}` | null;
  chainId: number | null;
  connecting: boolean;
  error: string | null;
  walletClient: WalletClient | null;
  onRightChain: boolean;
  connect: (w: DiscoveredWallet) => Promise<void>;
  disconnect: () => void;
  switchChain: () => Promise<void>;
}

const Ctx = createContext<WalletState | null>(null);

const LAST_WALLET_KEY = "vd.lastWallet";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [provider, setProvider] = useState<EIP1193Provider | null>(null);
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const explicitlyDisconnected = useRef(false);

  useEffect(() => discoverWallets(setWallets), []);

  useEffect(() => {
    const onReownWallet = (event: Event) => {
      const detail = (event as CustomEvent<{ provider?: EIP1193Provider | null; address?: string | null }>).detail;
      if (!detail.provider || !detail.address) {
        setProvider(null);
        setAccount(null);
        setChainId(null);
        return;
      }
      setProvider(detail.provider);
      setAccount(detail.address as `0x${string}`);
      void detail.provider.request({ method: "eth_chainId" }).then((id) => setChainId(Number(id)));
    };
    window.addEventListener("vd:reown-wallet", onReownWallet);
    return () => window.removeEventListener("vd:reown-wallet", onReownWallet);
  }, []);

  const attach = useCallback((p: EIP1193Provider) => {
    const onAccounts = (accounts: unknown) => {
      const list = accounts as string[];
      setAccount(list.length ? (list[0] as `0x${string}`) : null);
      if (!list.length) setProvider(null);
    };
    const onChain = (id: unknown) => setChainId(Number(id));
    p.on?.("accountsChanged", onAccounts);
    p.on?.("chainChanged", onChain);
    return () => {
      p.removeListener?.("accountsChanged", onAccounts);
      p.removeListener?.("chainChanged", onChain);
    };
  }, []);

  useEffect(() => {
    if (!provider) return;
    return attach(provider);
  }, [provider, attach]);

  const connect = useCallback(async (w: DiscoveredWallet) => {
    explicitlyDisconnected.current = false;
    setConnecting(true);
    setError(null);
    try {
      const accounts = (await w.provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts?.length) throw new Error("No account returned");
      await ensureChain(w.provider);
      const id = (await w.provider.request({ method: "eth_chainId" })) as string;
      setProvider(w.provider);
      setAccount(accounts[0] as `0x${string}`);
      setChainId(Number(id));
      try {
        localStorage.setItem(LAST_WALLET_KEY, w.info.rdns);
      } catch {
        // Private mode and locked-down WebViews throw here. Reconnecting by hand
        // next visit is a smaller cost than failing the connection outright.
      }
    } catch (err) {
      const e = err as { code?: number; message?: string };
      setError(e.code === 4001 ? "Connection rejected" : (e.message ?? "Could not connect"));
    } finally {
      setConnecting(false);
    }
  }, []);

  // Reconnect silently if this wallet is already authorised. eth_accounts does
  // not prompt, so a user who never connected sees nothing.
  useEffect(() => {
    if (provider || wallets.length === 0 || explicitlyDisconnected.current) return;
    let cancelled = false;
    (async () => {
      let remembered: string | null = null;
      try {
        remembered = localStorage.getItem(LAST_WALLET_KEY);
      } catch {
        remembered = null;
      }
      const candidate = wallets.find((w) => w.info.rdns === remembered) ?? (wallets.length === 1 ? wallets[0] : undefined);
      if (!candidate) return;
      try {
        const accounts = (await candidate.provider.request({ method: "eth_accounts" })) as string[];
        if (cancelled || explicitlyDisconnected.current || !accounts?.length) return;
        const id = (await candidate.provider.request({ method: "eth_chainId" })) as string;
        if (cancelled || explicitlyDisconnected.current) return;
        setProvider(candidate.provider);
        setAccount(accounts[0] as `0x${string}`);
        setChainId(Number(id));
      } catch {
        // A wallet that refuses eth_accounts is simply not auto-connected.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallets, provider]);

  const disconnect = useCallback(() => {
    explicitlyDisconnected.current = true;
    setProvider(null);
    setAccount(null);
    setChainId(null);
    try {
      localStorage.removeItem(LAST_WALLET_KEY);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
  }, []);

  const switchChain = useCallback(async () => {
    if (!provider) return;
    setError(null);
    try {
      await ensureChain(provider);
      const id = (await provider.request({ method: "eth_chainId" })) as string;
      setChainId(Number(id));
    } catch (err) {
      setError((err as { message?: string }).message ?? "Could not switch network");
    }
  }, [provider]);

  const walletClient = useMemo(
    () => (provider && account ? walletClientFor(provider, account) : null),
    [provider, account],
  );

  const value = useMemo<WalletState>(
    () => ({
      wallets,
      account,
      chainId,
      connecting,
      error,
      walletClient,
      onRightChain: chainId === botTestnet.id,
      connect,
      disconnect,
      switchChain,
    }),
    [wallets, account, chainId, connecting, error, walletClient, connect, disconnect, switchChain],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
