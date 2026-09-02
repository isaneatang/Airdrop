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

  const totalDeposited = streams.reduce((sum, stream) => sum + stream.deposit, 0n);
  const totalClaimable = streams.reduce((sum, stream) => sum + claimableOf(stream, now), 0n);

  if (!account) return <ConnectPrompt message="Connect a wallet to see streams you send or receive." />;

  return (
    <div className="space-y-6">
      <section className="dashboard-hero">
        <div className="relative z-10 max-w-2xl">
          <p className="eyebrow text-moss-300">Open distribution rails</p>
          <h2 className="mt-3 max-w-xl text-4xl font-semibold leading-[1.05] tracking-[-0.04em] text-ink-50 sm:text-5xl">
            Money that moves at the speed of the agreement.
          </h2>
          <p className="mt-4 max-w-lg text-sm leading-6 text-ink-300 sm:text-base">
            Create token streams, track what is unlocking, and claim distributions on BOT Chain without a custodian in the middle.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="#/create" className="hero-action">Create a stream <Icon name="arrow" className="h-4 w-4" /></a>
            <a href="#/airdrop" className="hero-link">Explore airdrops <Icon name="arrow" className="h-4 w-4" /></a>
          </div>
        </div>
        <div className="hero-signal" aria-hidden>
          <span className="signal-ring signal-ring-one" />
          <span className="signal-ring signal-ring-two" />
          <span className="signal-core"><Icon name="streams" className="h-7 w-7" /></span>
          <span className="signal-line signal-line-one" /><span className="signal-line signal-line-two" />
        </div>
      </section>

      <section className="metric-grid" aria-label="Your distribution overview">
        <div className="metric-card"><span className="metric-label">Active positions</span><strong>{streams.length}</strong><span className="metric-foot">streams in your orbit</span></div>
        <div className="metric-card metric-highlight"><span className="metric-label">Total committed</span><strong><Amount value={totalDeposited} precision={2} /></strong><span className="metric-foot">across incoming and outgoing</span></div>
        <div className="metric-card"><span className="metric-label">Available now</span><strong><Amount value={totalClaimable} precision={2} /></strong><span className="metric-foot">ready to withdraw</span></div>
      </section>
      {/* Segmented control, built from buttons. Not a dropdown, so it sidesteps
          the wallet-browser select problem by construction. */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Your portfolio</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink-50">Distribution activity</h2>
        </div>
        <span className="hidden text-xs text-ink-500 sm:block">Live from chain state</span>
      </div>
      <div role="tablist" className="flex max-w-sm gap-1 rounded-xl border border-ink-700 bg-ink-850 p-1">
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
