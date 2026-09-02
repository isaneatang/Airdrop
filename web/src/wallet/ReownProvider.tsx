import { useEffect } from "react";
import { AppKitProvider, useAppKit, useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { botTestnet } from "../lib/chain";

const projectId = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_REOWN_PROJECT_ID ?? "").trim();
const queryClient = new QueryClient();

const adapter = projectId
  ? new WagmiAdapter({ projectId, networks: [botTestnet] })
  : null;

export function ReownProvider({ children }: { children: React.ReactNode }) {
  if (!adapter || !projectId) return children;
  return (
    <AppKitProvider
      adapters={[adapter]}
      networks={[botTestnet]}
      projectId={projectId}
      metadata={{
        name: "Vested Distribution",
        description: "Non-custodial token distribution on BOT Chain",
        url: window.location.origin,
        icons: [`${window.location.origin}/favicon.svg`],
      }}
      features={{ analytics: false }}
    >
      <QueryClientProvider client={queryClient}>
        <ReownBridge />
        {children}
      </QueryClientProvider>
    </AppKitProvider>
  );
}

/** Bridges AppKit's provider into the app's existing EIP-1193 wallet context. */
function ReownBridge() {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount({ namespace: "eip155" });
  const { walletProvider } = useAppKitProvider<unknown>("eip155");

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("vd:reown-wallet", {
      detail: { provider: isConnected ? walletProvider : null, address: isConnected ? address : null },
    }));
  }, [address, isConnected, walletProvider]);

  useEffect(() => {
    const onOpen = () => void open({ view: "Connect" });
    window.addEventListener("vd:open-reown", onOpen);
    return () => window.removeEventListener("vd:open-reown", onOpen);
  }, [open]);

  return null;
}

export function reownEnabled(): boolean {
  return Boolean(projectId && adapter);
}
