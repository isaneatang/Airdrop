#!/usr/bin/env node
/**
 * Builds the airdrop Merkle tree from recipients.csv.
 *
 * Leaf encoding MUST match MerkleVestedAirdrop.claim exactly:
 *   keccak256(bytes.concat(keccak256(abi.encode(uint256 index, address account, uint128 amount))))
 * StandardMerkleTree implements precisely this double hash over abi.encode, with
 * sorted-pair internal nodes, which is what OpenZeppelin's MerkleProof verifies.
 * A divergence here is the single most likely way this project breaks, so the script
 * refuses to emit anything it has not replayed against its own root.
 *
 * Usage: node tooling/build-tree.mjs <recipients.csv> <out-dir>
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { keccak256 } from "ethereum-cryptography/keccak";

const LEAF_TYPES = ["uint256", "address", "uint128"];
const UINT128_MAX = (1n << 128n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function parseCsv(path) {
  const text = readFileSync(path, "utf8").trim();
  if (!text) fail(`${path} is empty`);

  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  // Tolerate an optional header row.
  if (/[a-z]/i.test(lines[0].split(",")[0])) lines.shift();

  return lines.map((line, row) => {
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length !== 3) fail(`line ${row + 1}: expected "index,address,amount", got "${line}"`);
    const [index, account, amount] = parts;
    if (!/^\d+$/.test(index)) fail(`line ${row + 1}: index "${index}" is not an integer`);
    if (!/^0x[0-9a-fA-F]{40}$/.test(account)) fail(`line ${row + 1}: "${account}" is not an address`);
    if (!/^\d+$/.test(amount)) fail(`line ${row + 1}: amount "${amount}" is not an integer`);
    const parsedIndex = BigInt(index);
    const parsedAmount = BigInt(amount);
    if (parsedIndex > UINT256_MAX) fail(`line ${row + 1}: index exceeds uint256`);
    return { index: parsedIndex, account, amount: parsedAmount };
  });
}

function validate(rows) {
  if (rows.length === 0) fail("no recipients");

  const seenIndex = new Set();
  const seenAccount = new Set();

  for (const { index, account, amount } of rows) {
    // Duplicate INDEX is the dangerous one: claimedAmount is keyed by index alone, so
    // two leaves sharing an index cross-contaminate each other's accounting. A
    // duplicate address is merely a bookkeeping mistake, but is rejected too.
    if (seenIndex.has(index)) fail(`duplicate index ${index}`);
    seenIndex.add(index);

    const key = account.toLowerCase();
    if (seenAccount.has(key)) fail(`duplicate address ${account}`);
    seenAccount.add(key);

    if (account === `0x${"0".repeat(40)}`) fail("zero address in recipient list");
    if (amount === 0n) fail(`zero amount for ${account}`);
    // VestingMath takes uint128; a larger allocation is unclaimable.
    if (amount > UINT128_MAX) fail(`amount for ${account} exceeds uint128`);
  }

  // Indices must be exactly 0..n-1 so they cannot silently drift from row order.
  const sorted = [...seenIndex].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== BigInt(i)) fail(`indices must be contiguous from 0; missing ${i}`);
  }
}

function main() {
  const [csvPath, outDir] = process.argv.slice(2);
  if (!csvPath || !outDir) fail("usage: build-tree.mjs <recipients.csv> <out-dir>");

  const rows = parseCsv(csvPath);
  validate(rows);

  const values = rows.map((r) => [r.index.toString(), r.account, r.amount.toString()]);
  const tree = StandardMerkleTree.of(values, LEAF_TYPES);
  const totalAllocated = rows.reduce((acc, r) => {
    if (acc > UINT256_MAX - r.amount) fail("total allocation exceeds uint256");
    return acc + r.amount;
  }, 0n);
  const sourceHash = `0x${Buffer.from(keccak256(readFileSync(csvPath))).toString("hex")}`;

  // Round-trip: replay EVERY proof against the root before emitting anything.
  const claims = {};
  for (const [i, value] of tree.entries()) {
    const proof = tree.getProof(i);
    if (!StandardMerkleTree.verify(tree.root, LEAF_TYPES, value, proof)) {
      fail(`round-trip failed for ${value[1]} at index ${value[0]}`);
    }
    claims[value[1].toLowerCase()] = { index: value[0], account: value[1], amount: value[2], proof };
  }
  if (Object.keys(claims).length !== rows.length) fail("claim count does not match recipient count");

  mkdirSync(outDir, { recursive: true });

  // Deploy arguments are derived from the SAME pass that built the root, so
  // totalAllocated can never be hand-typed out of agreement with the tree.
  const deployArgs = {
    merkleRoot: tree.root,
    totalAllocated: totalAllocated.toString(),
    recipientCount: rows.length,
    leafTypes: LEAF_TYPES,
    sourcePath: csvPath,
    sourceHash,
  };

  writeFileSync(`${outDir}/proofs.json`, JSON.stringify({ ...deployArgs, claims }, null, 2));
  writeFileSync(`${outDir}/deploy-args.json`, JSON.stringify(deployArgs, null, 2));
  writeFileSync(`${outDir}/tree.json`, JSON.stringify(tree.dump(), null, 2));

  console.log(`root            ${tree.root}`);
  console.log(`totalAllocated  ${totalAllocated}`);
  console.log(`recipients      ${rows.length}`);
  console.log(`round-trip      all ${rows.length} proofs verified against the root`);
  console.log(`written         ${outDir}/{proofs,deploy-args,tree}.json`);
}

main();
