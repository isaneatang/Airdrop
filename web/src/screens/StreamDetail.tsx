import { useEffect, useState } from "react";
import { useWallet } from "../wallet/WalletContext";
import { useChainClock } from "../hooks/useChainClock";
import { useTx } from "../hooks/useTx";
import { Amount, Button, Card, shortAddress } from "../components/ui";
import { LiveCounter, VestingBar } from "../components/StreamVisuals";
import { TxFeedback } from "../components/TxFeedback";
import { Icon } from "../components/Icon";
import { ConnectPrompt, WrongNetwork } from "../components/Connect";
import { fetchStreams, fetchToken, type Stream } from "../lib/streams";
import { explorerAddress, PAYMENT_STREAM_ADDRESS } from "../lib/chain";
import { paymentstreamAbi } from "../lib/abi";
import { claimableOf } from "../lib/vesting";
import type { TokenMeta } from "../lib/erc20";

export function StreamDetailScreen({ id }: { id: bigint }) {
  const { account, walletClient, onRightChain } = useWallet();
  const now = useChainClock();
  const [stream, setStream] = useState<Stream | null>(null);
  const [token, setToken] = useState<TokenMeta | null>(null);
  const [missing, setMissing] = useState(false);
  const [nonce, setNonce] = useState(0);
  const tx = useTx();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s] = await fetchStreams([id]);
        if (cancelled) return;
        // A never-created stream reads back with a zero sender; the contract
        // reverts NoStream on its own getters, so this is the read-path signal.
        if (!s || s.sender === "0x0000000000000000000000000000000000000000") {
          setMissing(true);
          return;
        }
        setStream(s);
        const meta = await fetchToken(s.token);
        if (!cancelled) setToken(meta);
      } catch {
        if (!cancelled) setMissing(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, nonce]);

  if (missing) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-ink-300">No stream with id {String(id)}.</p>
        <a href="#/streams" className="mt-3 inline-block text-sm text-moss-400">Back to streams</a>
      </Card>
    );
  }

  if (!stream) return <Card className="p-8 text-center text-sm text-ink-400">Loading stream</Card>;

  const decimals = token?.decimals ?? 18;
  const symbol = token?.symbol ?? "";
  const claimable = claimableOf(stream, now);
  const isRecipient = account?.toLowerCase() === stream.recipient.toLowerCase();
  const isSender = account?.toLowerCase() === stream.sender.toLowerCase();

  const refresh = () => setNonce((n) => n + 1);

  const withdraw = async () => {
    if (!walletClient || !account) return;
    const ok = await tx.run(() =>
      walletClient.writeContract({
        address: PAYMENT_STREAM_ADDRESS,
        abi: paymentstreamAbi,
        functionName: "withdrawMax",
        args: [stream.id],
        account,
        chain: null,
      }),
    );
    if (ok) refresh();
  };

  const cancel = async () => {
    if (!walletClient || !account) return;
    const ok = await tx.run(() =>
      walletClient.writeContract({
        address: PAYMENT_STREAM_ADDRESS,
        abi: paymentstreamAbi,
        functionName: "cancel",
        args: [stream.id],
        account,
        chain: null,
      }),
    );
    if (ok) refresh();
  };

  return (
    <div className="space-y-4">
      <a href="#/streams" className="inline-flex items-center gap-1 text-sm text-ink-400 hover:text-ink-200">
        <Icon name="chevron" className="h-4 w-4 rotate-90" /> Streams
      </a>

      <Card className="p-5">
        <LiveCounter stream={stream} now={now} symbol={symbol} decimals={decimals} />
        <div className="mt-5">
          <VestingBar stream={stream} now={now} symbol={symbol} decimals={decimals} />
        </div>
      </Card>

      {account && !onRightChain && <WrongNetwork />}

      {account && onRightChain && (
        <Card className="space-y-3 p-5">
          {/* Buttons are disabled for clarity only. Every one of these constraints
              is enforced in the contract, which is the thing that decides.
              RESEARCH.txt 9.1. */}
          <Button
            className="w-full"
            onClick={withdraw}
            disabled={claimable === 0n || stream.cancelled || tx.status === "signing" || tx.status === "pending"}
          >
            Withdraw {claimable > 0n && <Amount value={claimable} decimals={decimals} precision={4} symbol={symbol} />}
          </Button>

          {isSender && stream.revocable && !stream.cancelled && (
            <Button
              variant="danger"
              className="w-full"
              onClick={cancel}
              disabled={tx.status === "signing" || tx.status === "pending"}
            >
              Cancel stream
            </Button>
          )}

          {!isRecipient && !stream.cancelled && claimable > 0n && (
            <p className="text-xs text-ink-400">
              Anyone may trigger a withdrawal. The tokens always go to the recipient.
            </p>
          )}

          <TxFeedback tx={tx} />
        </Card>
      )}

      {!account && <ConnectPrompt message="Connect a wallet to withdraw or cancel." />}

      <Card className="divide-y divide-ink-700">
        <Row label="Stream id" value={String(stream.id)} />
        <Row label="Sender" value={shortAddress(stream.sender)} href={explorerAddress(stream.sender)} />
        <Row label="Recipient" value={shortAddress(stream.recipient)} href={explorerAddress(stream.recipient)} />
        <Row label="Token" value={token ? `${token.name} (${token.symbol})` : shortAddress(stream.token)} href={explorerAddress(stream.token)} />
        <Row label="Start" value={formatTs(stream.start)} />
        <Row label="Cliff" value={stream.cliff === stream.start ? "None" : formatTs(stream.cliff)} />
        <Row label="End" value={formatTs(stream.end)} />
        <Row
          label="Revocable"
          value={stream.revocable ? "Yes, by the sender" : "No, fixed at creation"}
        />
      </Card>

      {stream.cancelled && (
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <Icon name="lock" className="mt-0.5 h-5 w-5 shrink-0 text-ink-400" />
            <p className="text-xs text-ink-300">
              This stream was cancelled and settled in full at that moment. The recipient was paid
              everything that had accrued and the sender was refunded the rest, so nothing remains
              to withdraw.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <span className="text-xs text-ink-400">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-ink-100 hover:text-moss-300"
        >
          <span className="tnum">{value}</span>
          <Icon name="external" className="h-3 w-3 text-ink-500" />
        </a>
      ) : (
        <span className="tnum text-sm text-ink-100">{value}</span>
      )}
    </div>
  );
}

function formatTs(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
