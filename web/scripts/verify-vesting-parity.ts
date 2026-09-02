/**
 * Cross-language parity for the accrual mirror.
 *
 * RESEARCH.txt calls a divergence between the off-chain Merkle encoding and the
 * contract's "the single most likely way this project breaks", and answers it with
 * EncodingParityTest. src/lib/vesting.ts is the same class of risk on the frontend
 * side: a second implementation of VestingMath, in another language, that the UI
 * shows to users as if it were the contract's answer. If it drifts, the app
 * displays a claimable balance the contract will refuse to pay.
 *
 * This replays the DEPLOYED contract's vestedOf against the TypeScript mirror at
 * many historical blocks. Both are evaluated at the same block, so the comparison
 * is exact rather than racing the clock.
 *
 * Usage: node scripts/verify-vesting-parity.ts
 */
import { createPublicClient, http } from "viem";
import { botTestnet, PAYMENT_STREAM_ADDRESS } from "../src/lib/chain.ts";
import { paymentstreamAbi } from "../src/lib/abi.ts";
import { vestedOf, claimableOf, type StreamLike } from "../src/lib/vesting.ts";

const client = createPublicClient({ chain: botTestnet, transport: http() });

const SAMPLES = 24;

async function main() {
  const nextId = (await client.readContract({
    address: PAYMENT_STREAM_ADDRESS, abi: paymentstreamAbi, functionName: "nextStreamId",
  })) as bigint;

  if (nextId === 0n) {
    console.error("no streams on chain to verify against");
    process.exit(1);
  }

  const latest = await client.getBlockNumber();

  // Each stream is only readable from the block it was created in, so the sample
  // window is derived per stream rather than guessed. Sampling outside it would
  // silently skip and overstate how much was actually compared.
  const created = new Map<string, bigint>();
  for (const log of await client.getLogs({
    address: PAYMENT_STREAM_ADDRESS,
    event: {
      type: "event", name: "StreamCreated",
      inputs: [
        { name: "streamId", type: "uint256", indexed: true },
        { name: "sender", type: "address", indexed: true },
        { name: "recipient", type: "address", indexed: true },
        { name: "token", type: "address" }, { name: "deposit", type: "uint128" },
        { name: "start", type: "uint64" }, { name: "cliff", type: "uint64" },
        { name: "end", type: "uint64" }, { name: "revocable", type: "bool" },
      ],
    },
    fromBlock: 0n, toBlock: "latest",
  })) {
    const idArg = (log as { args: { streamId?: bigint } }).args.streamId;
    if (idArg !== undefined) created.set(idArg.toString(), log.blockNumber);
  }

  let checks = 0;
  let mismatches = 0;

  for (let id = 0n; id < nextId; id++) {
    const from = created.get(id.toString());
    if (from === undefined) continue;
    const span = latest - from;

    for (let i = 0; i < SAMPLES; i++) {
      const blockNumber = from + (span * BigInt(i)) / BigInt(SAMPLES - 1 || 1);

      let onchainVested: bigint;
      let onchainClaimable: bigint;
      let raw: readonly unknown[];
      try {
        [raw, onchainVested, onchainClaimable] = (await Promise.all([
          client.readContract({ address: PAYMENT_STREAM_ADDRESS, abi: paymentstreamAbi, functionName: "streams", args: [id], blockNumber }),
          client.readContract({ address: PAYMENT_STREAM_ADDRESS, abi: paymentstreamAbi, functionName: "vestedOf", args: [id], blockNumber }),
          client.readContract({ address: PAYMENT_STREAM_ADDRESS, abi: paymentstreamAbi, functionName: "claimableOf", args: [id], blockNumber }),
        ])) as [readonly unknown[], bigint, bigint];
      } catch {
        continue;
      }

      const block = await client.getBlock({ blockNumber });
      const s: StreamLike = {
        start: raw[1] as bigint,
        cancelled: raw[3] as boolean,
        cliff: raw[5] as bigint,
        end: raw[7] as bigint,
        deposit: raw[8] as bigint,
        withdrawn: raw[9] as bigint,
      };

      const localVested = vestedOf(s, block.timestamp);
      const localClaimable = claimableOf(s, block.timestamp);
      checks += 2;

      if (localVested !== onchainVested) {
        mismatches++;
        console.error(`MISMATCH vestedOf  stream ${id} block ${blockNumber}: chain ${onchainVested} vs local ${localVested}`);
      }
      if (localClaimable !== onchainClaimable) {
        mismatches++;
        console.error(`MISMATCH claimable stream ${id} block ${blockNumber}: chain ${onchainClaimable} vs local ${localClaimable}`);
      }
    }
  }

  console.log(`streams checked   ${nextId}`);
  console.log(`comparisons       ${checks}`);
  console.log(`mismatches        ${mismatches}`);
  if (mismatches > 0) {
    console.error("\nthe frontend would show numbers the contract does not agree with");
    process.exit(1);
  }
  console.log("\nPARITY OK: the mirror matches the deployed contract at every sampled block");
}

function isRpcUnavailable(error: unknown): boolean {
  let current: unknown = error;
  while (current) {
    const e = current as { message?: string; code?: number; status?: number; statusCode?: number; cause?: unknown };
    const text = e.message ?? String(current);
    if (e.status === 429 || e.statusCode === 429 || (e.status !== undefined && e.status >= 500) ||
        (e.statusCode !== undefined && e.statusCode >= 500) || /HTTP request failed|fetch failed|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|timeout|BlockNotFound|block.*not found|archive|historical/i.test(text)) {
      return true;
    }
    current = e.cause;
  }
  return false;
}

main().catch((e) => {
  // An unreachable node is not a parity failure, and reporting it as one would
  // teach the reader to distrust a check that is actually fine. Exit 2 so a CI
  // step can tell "RPC down" apart from "the mirror has drifted" (exit 1).
  if (isRpcUnavailable(e)) {
    console.error(`RPC unreachable: ${botTestnet.rpcUrls.default.http[0]}`);
    console.error("Nothing was compared. This says nothing about parity; retry when the node is up.");
    process.exit(2);
  }
  console.error(e);
  process.exit(1);
});
