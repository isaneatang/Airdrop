import { useEffect, useRef, useState } from "react";
import { publicClient } from "../lib/chain";

/**
 * Chain time, interpolated locally between block reads.
 *
 * RESEARCH.txt 9.2: anchor to the last block timestamp plus locally ELAPSED time,
 * never to Date.now() directly. A browser clock running ahead of the chain would
 * otherwise render a claimable balance the contract will refuse to pay.
 * performance.now() is monotonic, so this survives the user's clock being wrong,
 * changing, or jumping across a daylight-saving boundary.
 */
export function useChainClock(resyncMs = 30_000): bigint {
  const anchor = useRef<{ chain: bigint; local: number } | null>(null);
  const [now, setNow] = useState<bigint>(() => BigInt(Math.floor(Date.now() / 1000)));

  useEffect(() => {
    let alive = true;

    const resync = async () => {
      try {
        const block = await publicClient.getBlock({ blockTag: "latest" });
        if (!alive) return;
        anchor.current = { chain: block.timestamp, local: performance.now() };
      } catch {
        // Keep ticking off the previous anchor rather than freezing the UI.
      }
    };

    void resync();
    const sync = window.setInterval(resync, resyncMs);
    const tick = window.setInterval(() => {
      if (!alive) return;
      const a = anchor.current;
      if (!a) return;
      const elapsed = BigInt(Math.floor((performance.now() - a.local) / 1000));
      setNow(a.chain + elapsed);
    }, 1000);

    // A backgrounded tab stops firing timers, so the anchor is stale on return.
    const onVisible = () => {
      if (document.visibilityState === "visible") void resync();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      window.clearInterval(sync);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [resyncMs]);

  return now;
}
