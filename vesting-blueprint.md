# Vested Distribution Protocol — Build Blueprint

**Target:** BOT Chain (Testnet 968 → Mainnet 677)
**Scope:** Two contracts, one shared library, one frontend.
**Thesis:** Chain as witness, not custodian. The contract holds funds and enforces a schedule. It never claims title, never takes custody in the legal sense, and never trusts an off-chain actor to decide who gets paid.

---

## 1. What this is

A distribution primitive BOT Chain currently lacks. Two products sharing one accrual engine:

| | **PaymentStream** | **MerkleVestedAirdrop** |
|---|---|---|
| Shape | 1 sender → 1 recipient | 1 funder → N recipients |
| Gas cost to funder | O(1) per stream | O(1) total, regardless of N |
| Recipient list | Not applicable | Merkle root (32 bytes on-chain) |
| Revocable | **Yes** — configurable, immutable at creation | **No** — hard-coded, by design |
| Use case | Salary, contractor, subscription | Token launch, community distribution |

### Why revocability differs

This asymmetry is the design, not an inconsistency.

**Stream: revocable.** Payment streams fund ongoing work. If delivery stops in week two, the payer must recover the unstreamed remainder. Cancellation splits at the current timestamp: accrued goes to the recipient, remainder returns to the sender. Neither side loses what they earned or hasn't spent.

**Airdrop: non-revocable, hard-coded.** If the issuer can claw back, recipients hold a promise rather than an entitlement — which is strictly worse than a manual transfer, because you have added gas and a claim flow to something that still requires trusting the issuer. The credible commitment *is* the product. Making it a toggle does not give users a choice; it lets every issuer pick the weaker version and destroys the guarantee for everyone downstream.

Put this in the README. It demonstrates reasoning rather than a settings page.

---

## 2. Architecture

```
contracts/
├── libraries/
│   └── VestingMath.sol        — pure functions, no state, no external calls
├── PaymentStream.sol          — 1:1 streaming, optionally revocable
├── MerkleVestedAirdrop.sol    — 1:N claim-gated vesting, non-revocable
└── interfaces/
    └── IVestingSchedule.sol   — shared view interface for the frontend
```

`VestingMath` is the single point of failure for both contracts. Test it in isolation, exhaustively, before anything else is written.

---

## 3. VestingMath — the shared engine

```solidity
library VestingMath {
    /// @notice Amount vested at `timestamp` for a linear schedule with cliff.
    /// @dev Pure. Monotonic non-decreasing in timestamp. Never exceeds total.
    function vestedAmount(
        uint256 total,
        uint64  start,
        uint64  cliff,
        uint64  end,
        uint64  timestamp
    ) internal pure returns (uint256) {
        if (timestamp < cliff)  return 0;
        if (timestamp >= end)   return total;      // exact, no rounding at terminus
        unchecked {
            // end > start guaranteed by constructor validation
            return (total * (timestamp - start)) / (end - start);
        }
    }
}
```

### Invariants this must satisfy (property-test these)

1. **Monotonicity:** `t1 <= t2` ⟹ `vested(t1) <= vested(t2)`. A recipient's entitlement can never decrease.
2. **Bounded:** `0 <= vested(t) <= total` for all `t`.
3. **Terminal exactness:** `vested(t) == total` for all `t >= end`. This is why the `>= end` branch returns `total` directly instead of computing it — integer division would leave dust and the final withdrawal would revert or strand funds.
4. **Cliff:** `vested(t) == 0` for all `t < cliff`.
5. **No overflow:** `total * (timestamp - start)` must not overflow uint256. With `total <= type(uint128).max` and duration `<= type(uint64).max`, the product fits. **Enforce `total <= type(uint128).max` at creation** — this is what makes `unchecked` safe here.

### The rounding rule

Integer division truncates, so per-withdrawal amounts round *down*. This is correct: it can never over-pay. The truncated dust accumulates and is released by the terminal-exactness branch at `end`. Never compute the final payout as a fraction.

---

## 4. PaymentStream.sol

### State

```solidity
struct Stream {
    address sender;
    address recipient;
    address token;
    uint128 deposit;         // total committed
    uint128 withdrawn;       // cumulative withdrawn by recipient
    uint64  start;
    uint64  cliff;           // == start if no cliff
    uint64  end;
    bool    revocable;       // immutable after creation
    bool    cancelled;
}

mapping(uint256 => Stream) public streams;
uint256 public nextStreamId;   // monotonic counter — never reuse IDs
```

Use a monotonic counter for IDs, never a hash of parameters. Hash-derived IDs collide when the same sender creates two identical streams, and the second silently overwrites the first.

### Functions

**`create(recipient, token, amount, start, cliff, end, revocable) → streamId`**

Validation, all reverting:
- `recipient != address(0)` and `recipient != msg.sender`
- `amount > 0` and `amount <= type(uint128).max`
- `end > start`
- `cliff >= start` and `cliff <= end`
- `start >= block.timestamp` (or allow backdating explicitly — decide and document)

Then: pull tokens via `safeTransferFrom`, **measuring the actual balance delta** (see §6), store the stream, emit `StreamCreated`.

**`withdraw(streamId, amount)`**

- Caller must be recipient. (Or allow anyone to trigger — funds always go to the stored recipient, so this is safe and enables gasless UX via a relayer. Decide and document.)
- `claimable = vestedAmount(...) - withdrawn`
- `amount <= claimable`, or pass `0` to mean "withdraw everything claimable"
- **Effects before interactions:** increment `withdrawn`, then transfer.
- Emit `Withdrawn`.

**`cancel(streamId)`**

- Only sender. Only if `revocable`. Only if not already cancelled.
- Compute `recipientOwed = vestedAmount(now) - withdrawn`
- Compute `senderRefund = deposit - vestedAmount(now)`
- **Assert `recipientOwed + senderRefund + withdrawn == deposit`** — this equality is the accounting invariant. Encode it as an on-chain check, not just a test.
- Mark cancelled, set `end = block.timestamp` so future accrual is frozen, then transfer both legs.
- Emit `StreamCancelled` with both amounts.

Cancellation is where the bugs live. Every path — cancel before cliff, cancel after partial withdrawal, cancel after full vest, double cancel, withdraw after cancel — needs an explicit test.

---

## 5. MerkleVestedAirdrop.sol

### State

```solidity
bytes32 public immutable merkleRoot;
address public immutable token;
uint256 public immutable totalAllocated;
uint64  public immutable start;
uint64  public immutable cliff;
uint64  public immutable end;

mapping(uint256 => uint256) private claimedBitMap;  // index → claimed bits
mapping(uint256 => uint256) public claimedAmount;   // index → cumulative claimed
```

All schedule parameters `immutable`. No owner. No pause. No upgrade path. Nothing to compromise.

### Leaf encoding — read this carefully

```solidity
bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))));
```

**The double hash is not optional.** With a single hash, a 64-byte leaf preimage is indistinguishable from an internal node, and an attacker can present an internal node as a leaf to forge a claim. Double-hashing makes leaves a different domain from internal nodes. This is the OpenZeppelin / Uniswap standard. Use `abi.encode`, not `abi.encodePacked` — packed encoding of dynamic types allows ambiguous preimages.

### `claim(index, account, amount, merkleProof)`

1. Verify `MerkleProof.verify(proof, merkleRoot, leaf)` — revert `InvalidProof` otherwise.
2. `vested = VestingMath.vestedAmount(amount, start, cliff, end, block.timestamp)`
3. `payout = vested - claimedAmount[index]`
4. `payout > 0` or revert `NothingToClaim`.
5. `claimedAmount[index] += payout` **before** transfer.
6. `safeTransfer(account, payout)` — always to `account` from the proof, **never to `msg.sender`**.
7. Emit `Claimed(index, account, payout)`.

Point 6 is important: paying `account` rather than the caller means anyone can trigger a claim on someone's behalf without being able to steal it. That is a feature (gasless claims via relayer), not a hole.

Because vesting means repeat claims, `claimedAmount` is the real accounting — the bitmap is only useful if you also want an O(1) "has this index ever claimed" view for the UI.

### Funding

Constructor does not pull funds. Deploy, then transfer tokens in, then call `activate()` which checks `balanceOf(this) >= totalAllocated` and sets a `funded` flag. Claims revert until funded. This avoids a two-step approve/transferFrom dance in the constructor and makes underfunding loudly visible instead of silently breaking the last claimant.

**No `sweep()`, no `recoverTokens()`, no owner.** Any escape hatch reintroduces the trust you removed. If someone sends the wrong token to the contract, it is stuck. Accept that.

---

## 6. Security specification

### Token compatibility — the biggest practical risk

| Hazard | Consequence | Mitigation |
|---|---|---|
| **Fee-on-transfer** | Deposit or payout moves less than the scheduled amount. | Unsupported. `PaymentStream.create` and every payout require an exact balance delta and revert otherwise. |
| **Rebasing / elastic supply** | Accounting silently diverges from balance. | **Reject at the design level.** Document as unsupported. No safe mitigation exists for a fixed-schedule contract. |
| **Non-standard return values** (USDT et al.) | Transfer appears to fail or succeed incorrectly. | `SafeERC20` from OpenZeppelin. Never use raw `transfer`/`transferFrom`. |
| **Return bomb** (hostile token returns megabytes) | Gas exhaustion on the caller — the finding from your DMH review. | `SafeERC20` bounds returndata copying. Do not hand-roll low-level calls. |
| **Blocklist tokens** (USDC) | Recipient is blocklisted; their funds are permanently stuck. | Unfixable at contract level. Document it. Do not add an admin bypass "to help" — that is a backdoor. |
| **ERC-777 / callback tokens** | Reentrancy via transfer hook. | CEI ordering + `ReentrancyGuard`. Both, not either. |

### Reentrancy

Every state-mutating external function: `nonReentrant` modifier **and** strict checks-effects-interactions. The modifier is a backstop for a mistake in ordering; correct ordering is the actual defense. Cancellation performs two transfers, so complete *all* state updates before *either* transfer.

### Front-running

- **Claims:** not front-runnable. Payout always goes to the address in the proof, so a copied transaction pays the rightful owner and the attacker only pays gas.
- **Stream creation:** no benefit to front-running.
- **Cancellation:** a recipient watching the mempool can front-run `cancel()` with a `withdraw()`. This is harmless — they receive only what was already vested, which cancellation would have paid them anyway. Verify this holds in your accounting.

Contrast this with DMH v1, where the claim secret was itself the authorization and was therefore stealable in the mempool. Here, authorization is bound to an address the attacker does not control. Same lesson, structurally applied.

### Timestamp dependence

Validators can nudge `block.timestamp` by seconds. Over a vesting period measured in days or months, this moves the payout by a negligible amount. Acceptable. **But:** do not build sub-minute streams, and reject `end - start` below some floor (say, one hour) so the attack surface never becomes material.

### Griefing surface

- Anyone can call `claim` for someone else → funds still go to the rightful account. Safe.
- Anyone can call `withdraw` for a stream (if you allow it) → funds go to the stored recipient. Safe.
- Spam stream creation → costs the spammer gas, bloats no shared state. Acceptable.
- Dust streams → set a minimum deposit to keep the UI clean.

### Explicitly out of scope — say so in the README

- Rebasing tokens
- Tokens with a blocklist that can trap recipient funds
- On-chain enforcement of any off-chain agreement the schedule represents
- Recovery of tokens mistakenly sent to the contract

---

## 7. Test matrix

Do not write the frontend until this passes.

**VestingMath (property tests, fuzzed):**
- Monotonic across random timestamp pairs
- Never exceeds total, never below zero
- Exact at `end` and at every point past it
- Zero before cliff, non-zero immediately after
- No overflow at `total == type(uint128).max` with maximum duration

**PaymentStream:**
- Withdraw before cliff → reverts
- Withdraw exact claimable → succeeds; one wei more → reverts
- Repeated partial withdrawals sum exactly to deposit at `end`
- Cancel before cliff → full refund to sender, zero to recipient
- Cancel mid-stream after partial withdrawal → three-way accounting sums to deposit
- Cancel after full vest → zero refund, recipient still gets remainder
- Double cancel → reverts
- Withdraw after cancel → only the frozen accrued amount
- Non-revocable stream: cancel → reverts
- Non-sender calls cancel → reverts
- Fee-on-transfer token: creation and payout both revert on a short balance delta
- Reentrant token attempting recursive withdraw → reverts

**MerkleVestedAirdrop:**
- Valid proof claims correctly at multiple points in the schedule
- Invalid proof → reverts
- Proof for a different amount than the leaf → reverts
- Internal node presented as leaf → reverts (this validates the double-hash)
- Claim twice at same timestamp → second reverts with `NothingToClaim`
- Claim, advance time, claim again → cumulative equals vested
- Sum of all recipients' full claims == `totalAllocated`, no dust stranded
- Claim before funded → reverts
- Third party claims on behalf → tokens land with `account`

---

## 8. Off-chain tooling (airdrop)

Node script:
1. Read `recipients.csv` → `(index, address, amount)`
2. Validate: no duplicate addresses, no zero addresses, no zero amounts, sum matches intended total
3. Build tree with the same double-hash leaf encoding as the contract
4. Emit `proofs.json` keyed by address, plus the root and the total
5. **Verify round-trip:** replay every proof against the root in the script before deploying

Host `proofs.json` on Vercel as a static file. The frontend looks up the connected address and submits. If the address is absent, show "not eligible" — do not error.

**A mismatch between the script's leaf encoding and the contract's is the single most likely way this project breaks.** Write a test that generates a tree in the script and verifies a proof against the deployed contract before you trust either.

---

## 9. Frontend

Stack: React + Vite, viem, Reown AppKit, Tailwind, Framer Motion. Muted charcoal / desaturated green.

**Screens:**
- Create stream (form → approve → create, with a live preview of the schedule)
- My streams — incoming and outgoing tabs
- Stream detail: vesting bar, **balance counter ticking up per second**, withdraw button, cancel if permitted
- Airdrop claim: connect → eligibility lookup → vested vs locked → claim

**The per-second counter is the demo.** Watching a claimable balance increase in real time sells the primitive faster than any explanation. Compute it client-side from the same math; it is display only, and the contract remains the source of truth.

**Never let the UI make an authorization decision.** Show state, disable buttons for UX, but every constraint is enforced on-chain. The lesson from the DMH frontend oracle finding: if a check only exists in the client, it does not exist.

---

## 10. Build order

Each step is gated — do not proceed until the previous one passes.

1. **VestingMath + property tests.** Half a day. Nothing else is written until the invariants hold under fuzzing.
2. **PaymentStream + full test matrix.** One day. No Merkle complexity, so this validates the accrual engine in a real contract.
3. **Deploy stream to testnet, verify on scan.botchain.ai.** Half a day.
4. **Merkle tooling + round-trip verification.** Half a day.
5. **MerkleVestedAirdrop + test matrix.** One day.
6. **Frontend, both flows.** One and a half days.
7. **Adversarial pass:** hostile token mock, reentrancy mock, fuzz the cancellation accounting. Half a day.

**Roughly five days.** Step 2 ships standalone if time runs short — a working stream contract alone is a legitimate submission.

---

## 11. Positioning

Do not pitch this as novel. Sablier proved streaming in 2019; Uniswap proved Merkle claims in 2020. The honest pitch is stronger:

> BOT Chain lacks a distribution primitive. This supplies one: non-custodial, no admin keys, no upgrade path, no escape hatches. The airdrop contract cannot be revoked because a revocable airdrop is not a commitment. Every constraint is enforced on-chain because a constraint in a frontend is not a constraint. Unsupported token types are documented rather than silently mishandled.

That is a claim you can defend under questioning. "We invented streaming" is not.

**Adoption path:** other builders on the chain issuing their own distributions. That only works if the non-revocability holds — the moment there is an owner key that can claw back, nobody claims and nobody integrates.
