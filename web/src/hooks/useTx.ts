import { useCallback, useState } from "react";
import { BaseError, ContractFunctionRevertedError, type Hash } from "viem";
import { publicClient } from "../lib/chain";

export type TxStatus = "idle" | "signing" | "pending" | "success" | "error";

export interface TxState {
  status: TxStatus;
  hash: Hash | null;
  error: string | null;
  run: (send: () => Promise<Hash>) => Promise<boolean>;
  reset: () => void;
}

/**
 * Turns a contract revert into the error the contract actually named.
 *
 * Every guard in these contracts is a custom error chosen to say what went wrong.
 * Surfacing "execution reverted" would throw that away, and the user would be
 * left guessing at a constraint the contract stated precisely.
 */
function describe(err: unknown): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name) return HUMAN[name] ?? name;
    }
    if (err.shortMessage?.includes("User rejected") || (err as { code?: number }).code === 4001) {
      return "Rejected in wallet";
    }
    return err.shortMessage || err.message;
  }
  const e = err as { code?: number; message?: string };
  if (e?.code === 4001) return "Rejected in wallet";
  return e?.message ?? "Transaction failed";
}

const HUMAN: Record<string, string> = {
  NotSender: "Only the sender can cancel this stream",
  NotRevocable: "This stream was created as non-revocable",
  AlreadyCancelled: "This stream is already cancelled",
  StreamIsCancelled: "This stream is cancelled and fully settled",
  ExceedsClaimable: "That is more than has vested so far",
  NothingToWithdraw: "Nothing has vested yet",
  NoStream: "No such stream",
  ZeroAmount: "Amount must be greater than zero",
  ZeroAddress: "Address cannot be empty",
  SelfStream: "You cannot stream to your own address",
  AmountTooLarge: "This token credited more than was sent, which is unsupported",
  InvalidSchedule: "The schedule is not usable. End must be at least an hour after start",
  NothingToClaim: "Nothing to claim yet",
  InvalidProof: "This address is not in the distribution",
  NotFunded: "The distribution is not funded yet",
};

export function useTx(): TxState {
  const [status, setStatus] = useState<TxStatus>("idle");
  const [hash, setHash] = useState<Hash | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus("idle");
    setHash(null);
    setError(null);
  }, []);

  const run = useCallback(async (send: () => Promise<Hash>) => {
    setStatus("signing");
    setError(null);
    setHash(null);
    try {
      const h = await send();
      setHash(h);
      setStatus("pending");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: h });
      if (receipt.status !== "success") {
        setStatus("error");
        setError("Transaction reverted on chain");
        return false;
      }
      setStatus("success");
      return true;
    } catch (err) {
      setStatus("error");
      setError(describe(err));
      return false;
    }
  }, []);

  return { status, hash, error, run, reset };
}
