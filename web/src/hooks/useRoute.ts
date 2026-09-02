import { useEffect, useState } from "react";

export type Route =
  | { name: "streams" }
  | { name: "stream"; id: bigint }
  | { name: "create" }
  | { name: "airdrop" }
  | { name: "account" };

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (path[0] === "create") return { name: "create" };
  if (path[0] === "airdrop") return { name: "airdrop" };
  if (path[0] === "account") return { name: "account" };
  if (path[0] === "streams" && path[1] !== undefined && /^\d+$/.test(path[1])) {
    return { name: "stream", id: BigInt(path[1]) };
  }
  return { name: "streams" };
}

/** Hash routing rather than history: the app is a static bundle, and hash routes
 *  need no server rewrite rules wherever it ends up hosted. */
export function useRoute(): [Route, (to: string) => void] {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return [route, (to: string) => { window.location.hash = to; }];
}
