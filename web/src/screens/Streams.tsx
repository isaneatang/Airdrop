import { useMemo, useState } from "react";
import { useWallet } from "../wallet/WalletContext";
import { useStreams } from "../hooks/useStreams";
import { useChainClock } from "../hooks/useChainClock";
import { Amount, Card, Pill, shortAddress } from "../components/ui";
import { ConnectPrompt } from "../components/Connect";
import { Icon } from "../components/Icon";
import { claimableOf, phaseOf, progressOf } from "../lib/vesting";
import type { Stream } from "../lib/streams";
import type { TokenMeta } from "../lib/erc20";

type Tab = "incoming" | "outgoing";

const PHASE_TONE = {
  streaming: "accent",
  complete: "accent",
  cliff: "neutral",
  scheduled: "neutral",
  cancelled: "muted",
} as const;

const PHASE_TEXT = {
  streaming: "Streaming",
  complete: "Fully vested",
  cliff: "Before cliff",
  scheduled: "Not started",
  cancelled: "Cancelled",
} as const;

export function StreamsScreen() {
  const { account } = useWallet();
  const { streams, tokens, loading, error } = useStreams(account);
  const now = useChainClock();
  const [tab, setTab] = useState<Tab>("incoming");

  const filtered = useMemo(() => {
    if (!account) return [];
    const key = account.toLowerCase();
    return streams.filter((s) =>
      tab === "incoming" ? s.recipient.toLowerCase() === key : s.sender.toLowerCase() === key,
    );
  }, [streams, account, tab]);

  if (!account) return <ConnectPrompt message="Connect a wallet to see streams you send or receive." />;

  return (
    <div className="space-y-4">
      {/* Segmented control, built from buttons. Not a dropdown, so it sidesteps
          the wallet-browser select problem by construction. */}
      <div role="tablist" className="flex gap-1 rounded-xl border border-ink-700 bg-ink-850 p-1">
        {(["incoming", "outgoing"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            aria-controls="stream-panel"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm capitalize transition-colors ${
              tab === t ? "bg-ink-800 text-ink-50" : "text-ink-400 hover:text-ink-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div id="stream-panel" role="tabpanel" aria-live="polite">
      {loading && <Card className="p-8 text-center text-sm text-ink-400">Loading streams</Card>}

      {error && (
        <Card className="p-4">
          <p className="text-sm text-clay-400">{error}</p>
        </Card>
      )}

      {!loading && !error && filtered.length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-sm text-ink-300">
            {tab === "incoming" ? "No streams pay into this address yet." : "You have not opened any streams."}
          </p>
          {tab === "outgoing" && (
            <a href="#/create" className="mt-3 inline-block text-sm text-moss-400 hover:text-moss-300">
              Create one
            </a>
          )}
        </Card>
      )}

      <ul className="space-y-3">
        {filtered.map((s) => (
          <li key={String(s.id)}>
            <StreamRow stream={s} token={tokens[s.token.toLowerCase()]} now={now} tab={tab} />
          </li>
        ))}
      </ul>
      </div>
    </div>
  );
}

function StreamRow({
  stream,
  token,
  now,
  tab,
}: {
  stream: Stream;
  token?: TokenMeta;
  now: bigint;
  tab: Tab;
}) {
  const decimals = token?.decimals ?? 18;
  const symbol = token?.symbol ?? "";
  const phase = phaseOf(stream, now);
  const claimable = claimableOf(stream, now);
  const counterparty = tab === "incoming" ? stream.sender : stream.recipient;

  return (
    <a href={`#/streams/${stream.id}`} className="block">
      <Card className="p-4 transition-colors hover:border-ink-600">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink-100">
                <Amount value={stream.deposit} decimals={decimals} precision={2} symbol={symbol} />
              </span>
              <Pill tone={PHASE_TONE[phase]}>{PHASE_TEXT[phase]}</Pill>
            </div>
            <p className="mt-1 truncate text-xs text-ink-400">
              {tab === "incoming" ? "from" : "to"}{" "}
              <span className="tnum">{shortAddress(counterparty)}</span>
            </p>
          </div>
          <Icon name="chevron" className="h-4 w-4 shrink-0 -rotate-90 text-ink-500" />
        </div>

        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-800">
          <div
            className="h-full rounded-full bg-moss-600"
            style={{ width: `${progressOf(stream, now) * 100}%` }}
          />
        </div>

        {claimable > 0n && (
          <p className="mt-2 text-xs text-moss-400">
            <Amount value={claimable} decimals={decimals} precision={6} symbol={symbol} /> claimable
          </p>
        )}
      </Card>
    </a>
  );
}
