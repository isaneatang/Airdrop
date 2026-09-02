import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { fetchStreamIds, fetchStreams, fetchToken, type Stream } from "../lib/streams";
import type { TokenMeta } from "../lib/erc20";

export interface StreamsState {
  streams: Stream[];
  tokens: Record<string, TokenMeta>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useStreams(account: Address | null): StreamsState {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [tokens, setTokens] = useState<Record<string, TokenMeta>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!account) {
      setStreams([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const ids = await fetchStreamIds(account);
        const rows = await fetchStreams(ids);
        if (cancelled) return;
        setStreams(rows);

        const metas = await Promise.all([...new Set(rows.map((r) => r.token))].map(fetchToken));
        if (cancelled) return;
        setTokens(Object.fromEntries(metas.map((m) => [m.address.toLowerCase(), m])));
      } catch (err) {
        if (!cancelled) setError((err as Error).message ?? "Could not load streams");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [account, nonce]);

  return { streams, tokens, loading, error, refresh };
}
