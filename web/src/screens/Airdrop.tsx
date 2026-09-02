import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useWallet } from "../wallet/WalletContext";
import { useChainClock } from "../hooks/useChainClock";
import { useTx } from "../hooks/useTx";
import { Amount, Button, Card, Pill } from "../components/ui";
import { TxFeedback } from "../components/TxFeedback";
import { Icon } from "../components/Icon";
import { ConnectPrompt, WrongNetwork } from "../components/Connect";
import { AIRDROP_ADDRESS, publicClient } from "../lib/chain";
import { merklevestedairdropAbi } from "../lib/abi";
import { vestedAmount } from "../lib/vesting";

interface Claim {
  index: string;
  account: Address;
  amount: string;
  proof: `0x${string}`[];
}
interface ProofsFile {
  merkleRoot: `0x${string}`;
  totalAllocated: string;
  recipientCount: number;
  claims: Record<string, Claim>;
}

interface Schedule {
  start: bigint; cliff: bigint; end: bigint; funded: boolean; claimed: bigint;
}

export function AirdropScreen() {
  const { account, walletClient, onRightChain } = useWallet();
  const now = useChainClock();
  const tx = useTx();
  const [proofs, setProofs] = useState<ProofsFile | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetch("proofs.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then(setProofs)
      .catch(() => setLoadError(true));
  }, []);

  const claim = account && proofs ? proofs.claims[account.toLowerCase()] : undefined;

  useEffect(() => {
    if (!AIRDROP_ADDRESS || !claim) return;
    let cancelled = false;
    (async () => {
      try {
        const read = (functionName: "start" | "cliff" | "end" | "funded" | "claimedAmount", args: unknown[] = []) =>
          publicClient.readContract({
            address: AIRDROP_ADDRESS as Address, abi: merklevestedairdropAbi,
            functionName, args: args as never,
          });
        const [start, cliff, end, funded, claimed] = await Promise.all([
          read("start"), read("cliff"), read("end"), read("funded"),
          read("claimedAmount", [BigInt(claim.index)]),
        ]);
        if (cancelled) return;
        setSchedule({
          start: BigInt(start as bigint), cliff: BigInt(cliff as bigint), end: BigInt(end as bigint),
          funded: Boolean(funded), claimed: BigInt(claimed as bigint),
        });
      } catch {
        if (!cancelled) setSchedule(null);
      }
    })();
    return () => { cancelled = true; };
  }, [claim, tx.status]);

  if (!AIRDROP_ADDRESS) {
    return (
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <Icon name="clock" className="mt-0.5 h-5 w-5 shrink-0 text-ink-400" />
          <div>
            <p className="text-sm text-ink-100">No distribution is live yet</p>
            <p className="mt-2 text-xs text-ink-400">
              The airdrop contract has not been deployed. Its recipient list is fixed at deployment
              and cannot be changed afterwards, so it is only deployed once the final list exists.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (loadError) {
    return <Card className="p-6 text-sm text-clay-400">Could not load the eligibility list.</Card>;
  }
  if (!proofs) return <Card className="p-8 text-center text-sm text-ink-400">Loading</Card>;
  if (!account) return <ConnectPrompt message="Connect a wallet to check eligibility." />;
  if (!onRightChain) return <WrongNetwork />;

  // Absent from the list is a normal outcome, not an error. RESEARCH.txt PART 8.
  if (!claim) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-ink-100">Not eligible</p>
        <p className="mt-2 text-xs text-ink-400">
          This address is not in the distribution list of {proofs.recipientCount} recipients.
        </p>
      </Card>
    );
  }

  const allocation = BigInt(claim.amount);
  const vested = schedule ? vestedAmount(allocation, schedule.start, schedule.cliff, schedule.end, now) : 0n;
  const claimed = schedule?.claimed ?? 0n;
  const claimable = vested > claimed ? vested - claimed : 0n;
  const locked = allocation - vested;

  const doClaim = async () => {
    if (!walletClient || !account || !AIRDROP_ADDRESS) return;
    await tx.run(() =>
      walletClient.writeContract({
        address: AIRDROP_ADDRESS as Address,
        abi: merklevestedairdropAbi,
        functionName: "claim",
        args: [BigInt(claim.index), claim.account, BigInt(claim.amount), claim.proof],
        account,
        chain: null,
      }),
    );
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-400">Your allocation</span>
          <Pill tone="accent">Eligible</Pill>
        </div>
        <div className="text-3xl font-semibold text-ink-50">
          <Amount value={allocation} precision={4} />
        </div>

        <dl className="mt-5 grid grid-cols-3 gap-3 text-xs">
          <div>
            <dt className="text-ink-400">Claimable</dt>
            <dd className="mt-0.5 text-moss-300"><Amount value={claimable} precision={4} /></dd>
          </div>
          <div>
            <dt className="text-ink-400">Claimed</dt>
            <dd className="mt-0.5 text-ink-100"><Amount value={claimed} precision={4} /></dd>
          </div>
          <div>
            <dt className="text-ink-400">Still locked</dt>
            <dd className="mt-0.5 text-ink-100"><Amount value={locked} precision={4} /></dd>
          </div>
        </dl>
      </Card>

      <Card className="space-y-3 p-5">
        <Button
          className="w-full"
          onClick={doClaim}
          disabled={claimable === 0n || !schedule?.funded || tx.status === "signing" || tx.status === "pending"}
        >
          Claim
        </Button>
        {schedule && !schedule.funded && (
          <p className="text-xs text-ink-400">
            The distribution is deployed but not yet funded, so claims are not open.
          </p>
        )}
        <p className="text-xs text-ink-400">
          Tokens always go to the address in the proof, never to whoever sends the transaction.
        </p>
        <TxFeedback tx={tx} />
      </Card>
    </div>
  );
}
