import { parseAbiItem, type Address } from "viem";
import { publicClient, PAYMENT_STREAM_ADDRESS, DEPLOY_BLOCK } from "./chain";
import { paymentstreamAbi } from "./abi";
import { erc20Abi, type TokenMeta } from "./erc20";
import type { StreamLike } from "./vesting";

export interface Stream extends StreamLike {
  id: bigint;
  sender: Address;
  recipient: Address;
  token: Address;
  revocable: boolean;
}

const STREAM_CREATED = parseAbiItem(
  "event StreamCreated(uint256 indexed streamId, address indexed sender, address indexed recipient, address token, uint128 deposit, uint64 start, uint64 cliff, uint64 end, bool revocable)",
);

const LOG_CHUNK_SIZE = 100_000n;

/**
 * Finds every stream an account is party to.
 *
 * RESEARCH.txt 4.4 deliberately kept streams non-enumerable on chain rather than
 * paying an SSTORE per side on every create to serve this query, and flagged RPC
 * getLogs limits as the resulting risk. Measured against this node: an
 * address-filtered scan across 20M blocks returns in about 1.5s, so the whole
 * history is one call per side and no indexer is needed. The range is still
 * anchored at the deployment block rather than 0, because that is free.
 */
export async function fetchStreamIds(account: Address): Promise<bigint[]> {
  const latest = await publicClient.getBlockNumber();
  const fetchLogs = async (args: { sender?: Address; recipient?: Address }) => {
    const requests = [];
    for (let from = DEPLOY_BLOCK; from <= latest; from += LOG_CHUNK_SIZE) {
      const to = from + LOG_CHUNK_SIZE - 1n < latest ? from + LOG_CHUNK_SIZE - 1n : latest;
      requests.push(publicClient.getLogs({
        address: PAYMENT_STREAM_ADDRESS,
        event: STREAM_CREATED,
        args,
        fromBlock: from,
        toBlock: to,
      }));
    }
    const chunks = await Promise.all(requests);
    return chunks.flat();
  };

  const [outgoing, incoming] = await Promise.all([
    fetchLogs({ sender: account }),
    fetchLogs({ recipient: account }),
  ]);

  const ids = new Set<bigint>();
  for (const log of [...outgoing, ...incoming]) {
    if (log.args.streamId !== undefined) ids.add(log.args.streamId);
  }
  return [...ids].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // newest first
}

/**
 * Reads live state for each id.
 *
 * The log carries the deposit at creation, but withdrawn and cancelled move
 * afterwards, so the struct is re-read rather than reconstructed from events.
 * The transport batches these into one HTTP request.
 */
export async function fetchStreams(ids: bigint[]): Promise<Stream[]> {
  const rows = await Promise.all(
    ids.map(async (id) => {
      const s = (await publicClient.readContract({
        address: PAYMENT_STREAM_ADDRESS,
        abi: paymentstreamAbi,
        functionName: "streams",
        args: [id],
      })) as readonly [Address, bigint, boolean, boolean, Address, bigint, Address, bigint, bigint, bigint];

      const [sender, start, revocable, cancelled, recipient, cliff, token, end, deposit, withdrawn] = s;
      return { id, sender, start, revocable, cancelled, recipient, cliff, token, end, deposit, withdrawn };
    }),
  );
  return rows;
}

const tokenCache = new Map<string, TokenMeta>();

export async function fetchToken(address: Address): Promise<TokenMeta> {
  const key = address.toLowerCase();
  const hit = tokenCache.get(key);
  if (hit) return hit;

  const read = <T>(functionName: "symbol" | "decimals" | "name") =>
    publicClient.readContract({ address, abi: erc20Abi, functionName }) as Promise<T>;

  // A token missing optional metadata should show an address, not break the page.
  const [symbol, decimals, name] = await Promise.all([
    read<string>("symbol").catch(() => "TOKEN"),
    read<number>("decimals").catch(() => 18),
    read<string>("name").catch(() => "Unknown token"),
  ]);

  const meta: TokenMeta = { address, symbol, decimals: Number(decimals), name };
  tokenCache.set(key, meta);
  return meta;
}
