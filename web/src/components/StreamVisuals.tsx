import { motion } from "framer-motion";
import { Amount } from "./ui";
import { claimableOf, phaseOf, progressOf, vestedOf, type StreamLike } from "../lib/vesting";

/**
 * The claimable balance, ticking.
 *
 * Values come from the same mirror of VestingMath the contract uses, driven by
 * interpolated chain time (see useChainClock) rather than the browser clock, and
 * clamped in claimableOf so the figure can never exceed what the contract will
 * actually pay. Display only; every constraint is enforced on chain.
 */
export function LiveCounter({
  stream,
  now,
  symbol,
  decimals,
}: {
  stream: StreamLike;
  now: bigint;
  symbol: string;
  decimals: number;
}) {
  const claimable = claimableOf(stream, now);
  const streaming = phaseOf(stream, now) === "streaming";

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-400">
          Claimable now
        </span>
        {streaming && (
          // Functional motion, not decoration: it marks that the number above is
          // live rather than a stale read.
          <motion.span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-moss-500"
            animate={{ opacity: [1, 0.25, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </div>
      <div className="text-3xl font-semibold text-ink-50 sm:text-4xl">
        <Amount value={claimable} decimals={decimals} symbol={symbol} precision={8} />
      </div>
    </div>
  );
}

const PHASE_LABEL: Record<string, string> = {
  scheduled: "Not started",
  cliff: "Before cliff",
  streaming: "Streaming",
  complete: "Fully vested",
  cancelled: "Cancelled",
};

export function VestingBar({
  stream,
  now,
  symbol,
  decimals,
}: {
  stream: StreamLike;
  now: bigint;
  symbol: string;
  decimals: number;
}) {
  const vested = vestedOf(stream, now);
  const progress = progressOf(stream, now);
  const vestedPct = stream.deposit === 0n ? 0 : Number((vested * 10_000n) / stream.deposit) / 100;
  const withdrawnPct =
    stream.deposit === 0n ? 0 : Number((stream.withdrawn * 10_000n) / stream.deposit) / 100;
  const cliffPct =
    stream.end === stream.start
      ? 0
      : Number(((stream.cliff - stream.start) * 10_000n) / (stream.end - stream.start)) / 100;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-400">
          {PHASE_LABEL[phaseOf(stream, now)]}
        </span>
        <span className="tnum text-xs text-ink-400">{(progress * 100).toFixed(1)}% elapsed</span>
      </div>

      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-ink-800">
        {/* Vested: everything accrued so far, withdrawn or not. */}
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-moss-600"
          animate={{ width: `${vestedPct}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
        {/* Withdrawn: the part already delivered, drawn darker inside the vested
            region so the gap between them reads as "available to withdraw". */}
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-moss-300"
          animate={{ width: `${withdrawnPct}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
        {cliffPct > 0 && cliffPct < 100 && (
          <span
            aria-hidden
            className="absolute inset-y-0 w-px bg-ink-950/70"
            style={{ left: `${cliffPct}%` }}
          />
        )}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-3 text-xs">
        <div>
          <dt className="text-ink-400">Withdrawn</dt>
          <dd className="mt-0.5 text-ink-100">
            <Amount value={stream.withdrawn} decimals={decimals} precision={4} symbol={symbol} />
          </dd>
        </div>
        <div>
          <dt className="text-ink-400">Vested</dt>
          <dd className="mt-0.5 text-ink-100">
            <Amount value={vested} decimals={decimals} precision={4} symbol={symbol} />
          </dd>
        </div>
        <div>
          <dt className="text-ink-400">Total</dt>
          <dd className="mt-0.5 text-ink-100">
            <Amount value={stream.deposit} decimals={decimals} precision={4} symbol={symbol} />
          </dd>
        </div>
      </dl>
    </div>
  );
}
