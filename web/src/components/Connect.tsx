import { useState } from "react";
import { useWallet } from "../wallet/WalletContext";
import { Sheet } from "./Sheet";
import { Button, Card, shortAddress } from "./ui";
import { Icon } from "./Icon";
import { botTestnet } from "../lib/chain";
import { reownEnabled } from "../wallet/ReownProvider";

export function ConnectButton() {
  const { account, wallets, connect, connecting, onRightChain } = useWallet();
  const [open, setOpen] = useState(false);

  if (account) {
    return (
      <a
        href="#/account"
        className="inline-flex items-center gap-2 rounded-xl border border-ink-600 px-3 py-2 text-sm text-ink-100 transition-colors hover:border-ink-500"
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${onRightChain ? "bg-moss-500" : "bg-clay-500"}`}
          aria-hidden
        />
        <span className="tnum">{shortAddress(account)}</span>
      </a>
    );
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={connecting}>
        <Icon name="wallet" className="h-4 w-4" />
        {connecting ? "Connecting" : "Connect wallet"}
      </Button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Connect a wallet">
        {wallets.length === 0 ? (
          <p className="py-2 text-sm text-ink-300">
            No wallet detected in this browser. Open this page inside your wallet app, or install a
            browser wallet extension.
          </p>
        ) : (
          <ul className="space-y-1">
            {wallets.map((w) => (
              <li key={w.info.uuid}>
                <button
                  onClick={async () => {
                    await connect(w);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-ink-100 transition-colors hover:bg-ink-800"
                >
                  {w.info.icon ? (
                    <img src={w.info.icon} alt="" className="h-7 w-7 rounded-lg" />
                  ) : (
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink-800 text-ink-400">
                      <Icon name="wallet" className="h-4 w-4" />
                    </span>
                  )}
                  {w.info.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {reownEnabled() && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("vd:open-reown"))}
            className="mt-3 w-full rounded-xl border border-moss-600 px-4 py-3 text-sm text-moss-300 hover:bg-moss-700/20"
          >
            Connect with WalletConnect
          </button>
        )}
      </Sheet>
    </>
  );
}

/** Shown instead of any action UI when the wallet is on the wrong network. The
 *  buttons underneath stay disabled, but the contract is the thing that would
 *  actually reject the call. */
export function WrongNetwork() {
  const { switchChain } = useWallet();
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Icon name="warning" className="mt-0.5 h-5 w-5 shrink-0 text-clay-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-100">Wrong network</p>
          <p className="mt-1 text-xs text-ink-400">
            This app runs on {botTestnet.name}, chain {botTestnet.id}.
          </p>
          <Button variant="secondary" className="mt-3 w-full sm:w-auto" onClick={switchChain}>
            Switch network
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function ConnectPrompt({ message }: { message: string }) {
  return (
    <Card className="p-8 text-center">
      <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-ink-800 text-ink-400">
        <Icon name="wallet" className="h-5 w-5" />
      </span>
      <p className="mb-4 text-sm text-ink-300">{message}</p>
      <div className="flex justify-center">
        <ConnectButton />
      </div>
    </Card>
  );
}
