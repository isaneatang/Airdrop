/**
 * Client-side mirror of src/libraries/VestingMath.sol.
 *
 * DISPLAY ONLY. The contract is the source of truth; this exists so a balance can
 * tick between reads. It mirrors the Solidity guard order exactly, including the
 * terminal-exactness branch, so the number on screen is the number the contract
 * would return for the same timestamp. Any divergence here shows up as a withdraw
 * that reverts, which is the client-versus-chain gap RESEARCH.txt 9.1 warns about.
 */
export function vestedAmount(
  total: bigint,
  start: bigint,
  cliff: bigint,
  end: bigint,
  timestamp: bigint,
): bigint {
  // Guard order is load-bearing and matches the library. Returning `total`
  // directly at the terminus is what releases the dust integer division truncates.
  if (timestamp >= end) return total;
  if (timestamp <= start) return 0n;
  if (timestamp < cliff) return 0n;
  return (total * (timestamp - start)) / (end - start);
}

export interface StreamLike {
  deposit: bigint;
  withdrawn: bigint;
  start: bigint;
  cliff: bigint;
  end: bigint;
  cancelled: boolean;
}

/** Mirrors PaymentStream.vestedOf, cancelled branch included. */
export function vestedOf(s: StreamLike, now: bigint): bigint {
  if (s.cancelled) return s.deposit;
  return vestedAmount(s.deposit, s.start, s.cliff, s.end, now);
}

/**
 * Mirrors PaymentStream.claimableOf, then clamps.
 *
 * The clamp is not belt-and-braces. If the local clock has drifted ahead of chain
 * time the raw figure can exceed what the contract will pay, and a user clicking
 * withdraw on that number gets a revert. Never show more than deposit - withdrawn.
 */
export function claimableOf(s: StreamLike, now: bigint): bigint {
  if (s.cancelled) return 0n;
  const raw = vestedOf(s, now) - s.withdrawn;
  const ceiling = s.deposit - s.withdrawn;
  if (raw <= 0n) return 0n;
  return raw > ceiling ? ceiling : raw;
}

export type StreamPhase = "scheduled" | "cliff" | "streaming" | "complete" | "cancelled";

export function phaseOf(s: StreamLike, now: bigint): StreamPhase {
  if (s.cancelled) return "cancelled";
  if (now >= s.end) return "complete";
  if (now < s.start) return "scheduled";
  if (now < s.cliff) return "cliff";
  return "streaming";
}

/** Fraction of the schedule elapsed, 0..1, for the vesting bar. */
export function progressOf(s: StreamLike, now: bigint): number {
  if (s.cancelled || s.deposit === 0n) return 1;
  if (now >= s.end) return 1;
  if (now <= s.start) return 0;
  return Number(((now - s.start) * 10_000n) / (s.end - s.start)) / 10_000;
}
