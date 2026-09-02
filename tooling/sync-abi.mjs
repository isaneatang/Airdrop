#!/usr/bin/env node
/**
 * Copies the ABIs out of the forge artifacts into the frontend.
 *
 * The app's types come from the ABI rather than from a hand-written interface, so
 * a contract change that is not re-synced becomes a TypeScript error instead of a
 * runtime failure in front of a user. RESEARCH.txt C-8 removed IVestingSchedule
 * for the same reason: one source of truth, not two.
 *
 * Usage: node tooling/sync-abi.mjs   (run from the repo root, after `forge build`)
 */
import { readFileSync, writeFileSync } from "node:fs";

const CONTRACTS = ["PaymentStream", "MerkleVestedAirdrop"];
const OUT = "web/src/lib/abi.ts";

const parts = [
  "// Generated from forge artifacts. Regenerate with tooling/sync-abi.mjs\n",
  "// after any change to src/*.sol, so the app can never drift from the chain.\n\n",
];

for (const name of CONTRACTS) {
  const artifact = JSON.parse(readFileSync(`out/${name}.sol/${name}.json`, "utf8"));
  const abi = artifact.abi.filter((e) => ["function", "event", "error"].includes(e.type));
  const key = name[0].toLowerCase() + name.slice(1);
  parts.push(`export const ${key.toLowerCase()}Abi = ${JSON.stringify(abi, null, 2)} as const;\n\n`);
}

writeFileSync(OUT, parts.join(""));
console.log(`wrote ${OUT} from ${CONTRACTS.length} artifacts`);
