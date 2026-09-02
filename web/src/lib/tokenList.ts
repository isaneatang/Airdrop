import { isAddress, type Address } from "viem";
import { fetchToken } from "./streams";
import type { TokenMeta } from "./erc20";

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/** Curated tokens configured by deployment. RPC cannot enumerate ERC-20 holdings. */
export async function fetchCuratedTokens(): Promise<TokenMeta[]> {
  const addresses = (env.VITE_TOKEN_LIST ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is Address => isAddress(value));
  const results = await Promise.all(addresses.map((address) => fetchToken(address)));
  return results.filter((token, index, all) =>
    all.findIndex((item) => item.address.toLowerCase() === token.address.toLowerCase()) === index,
  );
}
