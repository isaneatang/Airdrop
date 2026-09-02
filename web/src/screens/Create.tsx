import { useEffect, useMemo, useState } from "react";
import { isAddress, parseUnits, type Address } from "viem";
import { useWallet } from "../wallet/WalletContext";
import { useChainClock } from "../hooks/useChainClock";
import { useTx } from "../hooks/useTx";
import { Button, Card, Field, Input, Amount } from "../components/ui";
import { Select, Sheet } from "../components/Sheet";
import { TxFeedback } from "../components/TxFeedback";
import { ConnectPrompt, WrongNetwork } from "../components/Connect";
import { publicClient, PAYMENT_STREAM_ADDRESS } from "../lib/chain";
import { paymentstreamAbi } from "../lib/abi";
import { erc20Abi, type TokenMeta } from "../lib/erc20";
import { fetchToken } from "../lib/streams";
import { vestedAmount } from "../lib/vesting";
import { fetchCuratedTokens } from "../lib/tokenList";

const HOUR = 3600n;
const DAY = 86_400n;

// The contract enforces a one-hour floor (VestingMath.MIN_DURATION). Offering
// anything shorter would be offering a transaction that reverts.
const DURATIONS = [
  { value: "3600", label: "1 hour", hint: "Shortest the contract allows" },
  { value: "86400", label: "1 day" },
  { value: "604800", label: "7 days" },
  { value: "2592000", label: "30 days" },
  { value: "7776000", label: "90 days" },
  { value: "31536000", label: "1 year" },
];

const CLIFFS = [
  { value: "0", label: "No cliff", hint: "Accrues from the first second" },
  { value: "86400", label: "1 day" },
  { value: "604800", label: "7 days" },
  { value: "2592000", label: "30 days" },
  { value: "7776000", label: "90 days" },
];

export function CreateScreen() {
  const { account, walletClient, onRightChain } = useWallet();
  const now = useChainClock();
  const tx = useTx();

  const [tokenAddress, setTokenAddress] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [duration, setDuration] = useState("2592000");
  const [cliff, setCliff] = useState("0");
  const [revocable, setRevocable] = useState(true);
  const [token, setToken] = useState<TokenMeta | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [curatedTokens, setCuratedTokens] = useState<TokenMeta[]>([]);
  const [curatedBalances, setCuratedBalances] = useState<Record<string, bigint>>({});
  const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
  const [customToken, setCustomToken] = useState(false);
  const [tokenSearch, setTokenSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchCuratedTokens().then(async (items) => {
      if (cancelled) return;
      setCuratedTokens(items);
      const balances = await Promise.all(items.map(async (item) => {
        try {
          const value = await publicClient.readContract({ address: item.address, abi: erc20Abi, functionName: "balanceOf", args: [account as Address] });
          return [item.address.toLowerCase(), value as bigint] as const;
        } catch {
          return [item.address.toLowerCase(), 0n] as const;
        }
      }));
      if (!cancelled) setCuratedBalances(Object.fromEntries(balances));
    });
    return () => { cancelled = true; };
  }, [account]);

  useEffect(() => {
    if (!tokenPickerOpen) setTokenSearch("");
  }, [tokenPickerOpen]);

  // Resolve token metadata as soon as the address looks real.
  useEffect(() => {
    if (!isAddress(tokenAddress)) {
      setToken(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const meta = await fetchToken(tokenAddress as Address);
        if (!cancelled) setToken(meta);
      } catch {
        if (!cancelled) setToken(null);
      }
    })();
    return () => { cancelled = true; };
  }, [tokenAddress]);

  // Balance and allowance drive which step of the approve flow is shown.
  useEffect(() => {
    if (!token || !account) { setBalance(null); setAllowance(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const [b, a] = await Promise.all([
          publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
          publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: "allowance", args: [account, PAYMENT_STREAM_ADDRESS] }),
        ]);
        if (cancelled) return;
        setBalance(b as bigint);
        setAllowance(a as bigint);
      } catch {
        if (!cancelled) { setBalance(null); setAllowance(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [token, account, tx.status]);

  const parsed = useMemo(() => {
    if (!token || !amount) return null;
    try {
      const v = parseUnits(amount, token.decimals);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }, [amount, token]);

  const durationSec = BigInt(duration);
  const cliffSec = BigInt(cliff);

  const errors = {
    recipient:
      recipient && !isAddress(recipient)
        ? "Not a valid address"
        : recipient && account && recipient.toLowerCase() === account.toLowerCase()
          ? "You cannot stream to your own address"
          : undefined,
    token: tokenAddress && !isAddress(tokenAddress) ? "Not a valid address" : undefined,
    amount:
      amount && !parsed
        ? "Enter an amount greater than zero"
        : parsed && balance !== null && parsed > balance
          ? "More than your balance"
          : undefined,
    cliff: cliffSec > durationSec ? "Cliff cannot be longer than the duration" : undefined,
  };

  const ready =
    Boolean(parsed && token && isAddress(recipient) && !Object.values(errors).some(Boolean) &&
    account && recipient.toLowerCase() !== account.toLowerCase() && durationSec >= HOUR);

  const needsApproval = Boolean(parsed && allowance !== null && allowance < parsed);
  const ownedTokens = curatedTokens.filter((item) => (curatedBalances[item.address.toLowerCase()] ?? 0n) > 0n);
  const visibleTokens = (ownedTokens.length ? ownedTokens : curatedTokens).filter((item) => {
    const query = tokenSearch.toLowerCase();
    return !query || item.name.toLowerCase().includes(query) || item.symbol.toLowerCase().includes(query) || item.address.toLowerCase().includes(query);
  });

  const approve = async () => {
    if (!walletClient || !account || !token || !parsed) return;
    // 9.5: USDT-style tokens revert when moving a non-zero allowance to another
    // non-zero value. Reset to zero first whenever an allowance is already set.
    if (allowance && allowance > 0n) {
      const cleared = await tx.run(() =>
        walletClient.writeContract({
          address: token.address, abi: erc20Abi, functionName: "approve",
          args: [PAYMENT_STREAM_ADDRESS, 0n], account, chain: null,
        }),
      );
      if (!cleared) return;
    }
    await tx.run(() =>
      walletClient.writeContract({
        address: token.address, abi: erc20Abi, functionName: "approve",
        args: [PAYMENT_STREAM_ADDRESS, parsed], account, chain: null,
      }),
    );
  };

  const create = async () => {
    if (!walletClient || !account || !token || !parsed) return;
    const start = now;
    const ok = await tx.run(() =>
      walletClient.writeContract({
        address: PAYMENT_STREAM_ADDRESS,
        abi: paymentstreamAbi,
        functionName: "create",
        args: [
          recipient as Address, token.address, parsed,
          start, start + cliffSec, start + durationSec, revocable,
        ],
        account,
        chain: null,
      }),
    );
    if (ok) {
      setAmount("");
      window.location.hash = "#/streams";
    }
  };

  if (!account) return <ConnectPrompt message="Connect a wallet to open a stream." />;
  if (!onRightChain) return <WrongNetwork />;

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-ink-300">Token</span>
            <button type="button" className="text-[11px] text-moss-300 hover:text-moss-200" onClick={() => setCustomToken((value) => !value)}>
              {customToken ? "Choose listed token" : "Use custom token"}
            </button>
          </div>
          {customToken || curatedTokens.length === 0 ? (
            <Field label="Token address" error={errors.token} hint={token ? `${token.name} (${token.symbol})` : "Add a token contract not in the curated list"}>
              <Input value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value.trim())} placeholder="0x..." spellCheck={false} autoComplete="off" />
            </Field>
          ) : (
            <>
              <button type="button" onClick={() => setTokenPickerOpen(true)} className="flex w-full items-center justify-between rounded-xl border border-ink-600 bg-ink-900 px-4 py-3 text-left hover:border-moss-400">
                <span><span className="block text-xs text-ink-400">Choose token</span><span className="block text-sm text-ink-100">{token ? `${token.symbol} · ${token.name}` : "Select a token"}</span></span>
                <span className="text-xs text-moss-300">{token ? "Change" : "Open list"}</span>
              </button>
              <Sheet open={tokenPickerOpen} onClose={() => setTokenPickerOpen(false)} title="Choose a token">
                <div className="space-y-3">
                  <Input value={tokenSearch} onChange={(event) => setTokenSearch(event.target.value)} placeholder="Search listed tokens" autoComplete="off" />
                  {visibleTokens.map((item) => (
                    <button key={item.address} type="button" onClick={() => { setTokenAddress(item.address); setTokenPickerOpen(false); }} className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-ink-100 hover:bg-ink-800">
                      <span><span className="block text-sm">{item.symbol} · {item.name}</span><span className="block text-xs text-moss-300"><Amount value={curatedBalances[item.address.toLowerCase()] ?? 0n} decimals={item.decimals} precision={4} /></span></span>
                      <span className="text-xs text-moss-300">Select</span>
                    </button>
                  ))}
                  {visibleTokens.length === 0 && <p className="px-4 py-3 text-sm text-ink-400">No listed token matches that search.</p>}
                </div>
              </Sheet>
            </>
          )}
        </div>

        <Field label="Recipient" error={errors.recipient}>
          <Input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value.trim())}
            placeholder="0x..."
            spellCheck={false}
            autoComplete="off"
          />
        </Field>

        <Field
          label="Amount"
          error={errors.amount}
           hint={balance !== null && token ? <>Balance <Amount value={balance} decimals={token.decimals} precision={token.decimals} symbol={token.symbol} /></> : undefined}
        >
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="0.0"
            inputMode="decimal"
          />
        </Field>

        <Select label="Duration" value={duration} options={DURATIONS} onChange={setDuration} />
        <Select label="Cliff" value={cliff} options={CLIFFS} onChange={setCliff} />
        {errors.cliff && <p className="text-xs text-clay-400">{errors.cliff}</p>}

        <button
          type="button"
          onClick={() => setRevocable((r) => !r)}
          aria-pressed={revocable}
          aria-label={`Revocable stream: ${revocable ? "enabled" : "disabled"}`}
          className="flex w-full items-start gap-3 rounded-xl border border-ink-600 bg-ink-900 p-4 text-left transition-colors hover:border-ink-500"
        >
          <span
            className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${revocable ? "bg-moss-600" : "bg-ink-700"}`}
          >
            <span className={`h-4 w-4 rounded-full bg-ink-50 transition-transform ${revocable ? "translate-x-4" : ""}`} />
          </span>
          <span>
            <span className="block text-sm text-ink-100">Revocable</span>
            <span className="block text-xs text-ink-400">
              {revocable
                ? "You can cancel later. The recipient keeps everything accrued and you are refunded the rest."
                : "Fixed at creation. Nobody can cancel this stream, including you."}
            </span>
          </span>
        </button>
      </Card>

      {parsed !== null && token !== null && (
        <SchedulePreview
          total={parsed}
          durationSec={durationSec}
          cliffSec={cliffSec}
          decimals={token.decimals}
          symbol={token.symbol}
        />
      )}

      <Card className="space-y-3 p-5">
        {needsApproval ? (
          <Button className="w-full" onClick={approve} disabled={!ready || tx.status === "signing" || tx.status === "pending"}>
            Approve {token?.symbol}
          </Button>
        ) : (
          <Button className="w-full" onClick={create} disabled={!ready || tx.status === "signing" || tx.status === "pending"}>
            Create stream
          </Button>
        )}
        {needsApproval && (
          <p className="text-xs text-ink-400">
            One approval first, then the stream itself. Two transactions.
          </p>
        )}
        <TxFeedback tx={tx} />
      </Card>
    </div>
  );
}

/** Shows what the schedule will actually do, computed with the same mirror of
 *  VestingMath the contract uses, so the preview cannot promise a shape the
 *  contract would not produce. */
function SchedulePreview({
  total, durationSec, cliffSec, decimals, symbol,
}: {
  total: bigint; durationSec: bigint; cliffSec: bigint; decimals: number; symbol: string;
}) {
  const start = 0n;
  const marks = [
    { label: "After 1 day", at: DAY },
    { label: "At the cliff", at: cliffSec },
    { label: "Halfway", at: durationSec / 2n },
    { label: "At the end", at: durationSec },
  ].filter((m, i, arr) => (m.at > 0n || i === 3) && arr.findIndex((x) => x.at === m.at) === i && m.at <= durationSec);

  return (
    <Card className="p-5">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-400">Schedule preview</h3>
      <dl className="space-y-2">
        {marks.map((m) => (
          <div key={m.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-sm text-ink-300">{m.label}</dt>
            <dd className="text-sm text-ink-100">
              <Amount
                value={vestedAmount(total, start, cliffSec, durationSec, m.at)}
                decimals={decimals}
                precision={4}
                symbol={symbol}
              />
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
