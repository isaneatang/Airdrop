// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VestingMath} from "./libraries/VestingMath.sol";

/// @title MerkleVestedAirdrop
/// @notice 1-funder to N-recipient vesting distribution gated by a Merkle proof.
/// @dev Non-revocable by construction, not by configuration. Every schedule parameter
///      is immutable, there is no owner, no pause, no upgrade path and no sweep.
///
///      A revocable airdrop is not a commitment: recipients would hold a promise
///      rather than an entitlement, which is strictly worse than a manual transfer
///      because it adds gas and a claim flow to something that still requires trusting
///      the issuer. Exposing revocability as a toggle would not give recipients a
///      choice, it would let every issuer pick the weaker version.
///
///      UNSUPPORTED TOKENS: fee-on-transfer and rebasing. Leaf amounts are fixed
///      before deployment and cannot be reconciled against a balance that moves
///      independently of this contract's accounting. See `activate`.
contract MerkleVestedAirdrop is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    bytes32 public immutable merkleRoot;
    /// @notice Sum of every leaf amount in the tree. Gate for `activate`.
    uint256 public immutable totalAllocated;
    uint64 public immutable start;
    uint64 public immutable cliff;
    uint64 public immutable end;

    /// @notice True once the contract holds enough tokens to pay every leaf in full.
    bool public funded;

    /// @notice Cumulative amount already released for a leaf index.
    /// @dev This is the whole claim accounting. There is no claimed-bitmap: vesting
    ///      means an index is claimed repeatedly, so a boolean "has claimed" bit is
    ///      not an authority over anything, and a second source of truth for the same
    ///      fact is a divergence waiting to happen. "Has ever claimed" is
    ///      `claimedAmount[index] != 0`.
    mapping(uint256 index => uint256 claimed) public claimedAmount;

    event Activated(uint256 balance);
    event Claimed(uint256 indexed index, address indexed account, uint256 amount);

    error ZeroAddress();
    error ZeroRoot();
    error ZeroAllocation();
    error AlreadyActivated();
    error NotFunded();
    error Underfunded(uint256 balance, uint256 required);
    error InvalidProof();
    error NothingToClaim();
    /// @dev Structurally unreachable; halts rather than over-releasing a leaf if
    ///      VestingMath ever regresses.
    error AccrualExceedsAllocation();

    constructor(
        IERC20 token_,
        bytes32 merkleRoot_,
        uint256 totalAllocated_,
        uint64 start_,
        uint64 cliff_,
        uint64 end_
    ) {
        if (address(token_) == address(0)) revert ZeroAddress();
        if (merkleRoot_ == bytes32(0)) revert ZeroRoot();
        if (totalAllocated_ == 0) revert ZeroAllocation();
        VestingMath.validateSchedule(start_, cliff_, end_);

        token = token_;
        merkleRoot = merkleRoot_;
        totalAllocated = totalAllocated_;
        start = start_;
        cliff = cliff_;
        end = end_;
    }

    /// @notice Arm the distribution once the contract is fully funded.
    /// @dev Deliberately permissionless and one-way. It stores no role and grants no
    ///      authority: the only state it can reach is `funded = true`, and only when
    ///      the balance covers every leaf. Anyone calling it early simply reverts.
    ///
    ///      This is a real solvency guarantee ONLY because `totalAllocated` is the
    ///      exact sum of the tree's leaves. The deploy script derives both from the
    ///      same pass over `recipients.csv` so the figure cannot be hand-typed out of
    ///      agreement with the root. If it were understated, early claimants would
    ///      succeed and the last ones would revert on an empty balance.
    function activate() external {
        if (funded) revert AlreadyActivated();
        uint256 balance = token.balanceOf(address(this));
        if (balance < totalAllocated) revert Underfunded(balance, totalAllocated);
        funded = true;
        emit Activated(balance);
    }

    /// @notice Release everything vested for `index` that has not been released yet.
    /// @dev Payout always goes to `account` as committed in the leaf, never to
    ///      `msg.sender`. A third party can therefore trigger someone's claim and pay
    ///      the gas, but cannot redirect the funds. That also makes the call
    ///      un-front-runnable: copying the transaction pays the rightful owner and
    ///      costs the copier gas.
    function claim(uint256 index, address account, uint128 amount, bytes32[] calldata merkleProof)
        external
        nonReentrant
    {
        if (!funded) revert NotFunded();

        // Double hash. With a single hash a 64-byte leaf preimage is indistinguishable
        // from the concatenation of two sorted internal nodes, letting an attacker
        // present an internal node as a leaf and forge a claim. Hashing twice puts
        // leaves in a different domain from internal nodes.
        // `abi.encode`, never `abi.encodePacked`: packed encoding admits ambiguous
        // preimages across adjacent fields.
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))));
        if (!MerkleProof.verifyCalldata(merkleProof, merkleRoot, leaf)) revert InvalidProof();

        uint256 vested = VestingMath.vestedAmount(amount, start, cliff, end, uint64(block.timestamp));
        if (vested > amount) revert AccrualExceedsAllocation();

        uint256 alreadyClaimed = claimedAmount[index];
        if (vested <= alreadyClaimed) revert NothingToClaim();
        uint256 payout = vested - alreadyClaimed;

        // EFFECTS before INTERACTIONS.
        claimedAmount[index] = vested;

        emit Claimed(index, account, payout);
        token.safeTransfer(account, payout);
    }

    /// @notice Amount currently releasable for a leaf, for UI display.
    /// @dev Takes the leaf's `index` and `amount` rather than a proof: this is a view
    ///      helper, and showing a number to an unproven caller releases nothing.
    ///      Authorisation lives entirely in `claim`.
    function claimableOf(uint256 index, uint128 amount) external view returns (uint256) {
        uint256 vested = VestingMath.vestedAmount(amount, start, cliff, end, uint64(block.timestamp));
        uint256 alreadyClaimed = claimedAmount[index];
        return vested > alreadyClaimed ? vested - alreadyClaimed : 0;
    }
}
