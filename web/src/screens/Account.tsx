import { useEffect, useState } from "react";
import { useWallet } from "../wallet/WalletContext";
import { Amount, Button, Card, Pill, shortAddress } from "../components/ui";
import { ConnectPrompt } from "../components/Connect";
import { Icon } from "../components/Icon";
import { botTestnet, explorerAddress, publicClient, PAYMENT_STREAM_ADDRESS } from "../lib/chain";

export function AccountScreen() {
  const { account, chainId, onRightChain, disconnect, switchChain } = useWallet();
  const [balance, setBalance] = useState<bigint | null>(null);

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    publicClient
      .getBalance({ address: account })
      .then((b) => { if (!cancelled) setBalance(b); })
      .catch(() => { if (!cancelled) setBalance(null); });
    return () => { cancelled = true; };
  }, [account, chainId]);

  if (!account) return <ConnectPrompt message="Connect a wallet to see your account." />;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-ink-400">Connected</p>
            <a
              href={explorerAddress(account)}
              target="_blank"
              rel="noreferrer"
              className="tnum mt-0.5 inline-flex items-center gap-1 text-sm text-ink-100 hover:text-moss-300"
            >
              {shortAddress(account)}
              <Icon name="external" className="h-3 w-3 text-ink-500" />
            </a>
          </div>
          <Button variant="secondary" onClick={disconnect}>Disconnect</Button>
        </div>

        {balance !== null && (
          <dl className="mt-4 text-xs">
            <dt className="text-ink-400">BOT Chain testnet balance</dt>
            <dd className="mt-0.5 text-ink-100">
              <Amount value={balance} precision={4} symbol={botTestnet.nativeCurrency.symbol} />
            </dd>
          </dl>
        )}
      </Card>

      <Card className="divide-y divide-ink-700">
        <div className="flex items-center justify-between px-5 py-3">
          <span className="text-xs text-ink-400">Network</span>
          <span className="flex items-center gap-2">
            <Pill tone={onRightChain ? "accent" : "warn"}>
              {onRightChain ? botTestnet.name : `Chain ${chainId ?? "unknown"}`}
            </Pill>
            {!onRightChain && (
              <button onClick={switchChain} className="text-xs text-moss-400 hover:text-moss-300">
                Switch
              </button>
            )}
          </span>
        </div>
        <div className="flex items-center justify-between px-5 py-3">
          <span className="text-xs text-ink-400">Stream contract</span>
          <a
            href={explorerAddress(PAYMENT_STREAM_ADDRESS)}
            target="_blank"
            rel="noreferrer"
            className="tnum inline-flex items-center gap-1 text-sm text-ink-100 hover:text-moss-300"
          >
            {shortAddress(PAYMENT_STREAM_ADDRESS)}
            <Icon name="external" className="h-3 w-3 text-ink-500" />
          </a>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">How this works</h3>
        <ul className="mt-3 space-y-2 text-xs text-ink-300">
          <li className="flex gap-2">
            <Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-moss-500" />
            The contract holds the tokens and releases them on a schedule. It has no owner, no pause
            and no upgrade path.
          </li>
          <li className="flex gap-2">
            <Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-moss-500" />
            Withdrawals always pay the recipient recorded on the stream, whoever sends the
            transaction.
          </li>
          <li className="flex gap-2">
            <Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-moss-500" />
            A revocable stream can be cancelled by its sender. The recipient keeps everything
            accrued up to that moment.
          </li>
        </ul>
      </Card>
    </div>
  );
}
