import { explorerTx } from "../lib/chain";
import type { TxState } from "../hooks/useTx";
import { Icon } from "./Icon";

export function TxFeedback({ tx }: { tx: TxState }) {
  if (tx.status === "idle") return null;

  if (tx.status === "error") {
    return (
      <p className="flex items-start gap-2 text-xs text-clay-400">
        <Icon name="warning" className="mt-px h-4 w-4 shrink-0" />
        <span>{tx.error}</span>
      </p>
    );
  }

  const label =
    tx.status === "signing" ? "Confirm in your wallet" : tx.status === "pending" ? "Submitting" : "Done";

  return (
    <p className="flex items-center gap-2 text-xs text-ink-400">
      {tx.status === "success" ? (
        <Icon name="check" className="h-4 w-4 text-moss-400" />
      ) : (
        <Icon name="clock" className="h-4 w-4" />
      )}
      <span>{label}</span>
      {tx.hash && (
        <a
          href={explorerTx(tx.hash)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-moss-400 hover:text-moss-300"
        >
          View <Icon name="external" className="h-3 w-3" />
        </a>
      )}
    </p>
  );
}
