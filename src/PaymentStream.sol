// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VestingMath} from "./libraries/VestingMath.sol";

/// @title PaymentStream
/// @notice 1-sender to 1-recipient linear token streaming with an optional cliff and
///         an optional, creation-time-immutable revocation right.
/// @dev No owner, no pause, no upgrade path, no rescue function. The contract holds
///      funds and enforces a schedule; it never decides who gets paid.
///
///      UNSUPPORTED TOKENS: rebasing/elastic supply. Balances that move independently
///      of this contract's accounting cannot be reconciled against a fixed schedule.
///      Fee-on-transfer tokens are unsupported: both deposits and payouts must move
///      exactly the requested amount.
contract PaymentStream is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Packs into 4 storage slots.
    struct Stream {
        address sender; //     slot 0: 20 bytes
        uint64 start; //       slot 0: +8 = 28
        bool revocable; //     slot 0: +1 = 29  (immutable after creation)
        bool cancelled; //     slot 0: +1 = 30
        address recipient; //  slot 1: 20 bytes
        uint64 cliff; //       slot 1: +8 = 28  (== start when there is no cliff)
        address token; //      slot 2: 20 bytes
        uint64 end; //         slot 2: +8 = 28
        uint128 deposit; //    slot 3: 16 bytes (actual amount received, post-fee)
        uint128 withdrawn; //  slot 3: +16 = 32 (cumulative delivered to recipient)
    }

    mapping(uint256 streamId => Stream) public streams;

    /// @notice Monotonic. IDs are never reused and never derived from parameters.
    /// @dev A hash of (sender, recipient, amount, schedule) collides when the same
    ///      sender opens two identical streams, and the second silently overwrites
    ///      the first. A counter cannot.
    uint256 public nextStreamId;

    event StreamCreated(
        uint256 indexed streamId,
        address indexed sender,
        address indexed recipient,
        address token,
        uint128 deposit,
        uint64 start,
        uint64 cliff,
        uint64 end,
        bool revocable
    );
    event Withdrawn(uint256 indexed streamId, address indexed recipient, uint128 amount);
    event StreamCancelled(uint256 indexed streamId, uint128 recipientOwed, uint128 senderRefund);

    error ZeroAddress();
    error SelfStream();
    error ZeroAmount();
    error NoStream();
    error StreamIsCancelled();
    error NotSender();
    error NotRevocable();
    error AlreadyCancelled();
    error ExceedsClaimable();
    error NothingToWithdraw();
    /// @dev Raised when an ERC20 transfer moves a different amount than requested.
    error TransferAmountMismatch();
    /// @dev Raised when accrual exceeds the deposit backing it. Structurally
    ///      unreachable; present so a regression in VestingMath halts rather than
    ///      paying one stream out of another stream's balance.
    error AccrualExceedsDeposit();

    /// @notice Open a stream, pulling `amount` of `token` from the caller.
    /// @dev DECISION (blueprint left this open): `start` MAY be in the past.
    ///      Backdating is a real payroll case (work began before the stream was set
    ///      up) and costs the sender nothing they did not choose to commit; the
    ///      backdated portion simply becomes claimable immediately. The deposit is
    ///      pulled in full at creation either way, so backdating grants the sender no
    ///      advantage over the recipient.
    /// @return streamId Identifier of the new stream.
    function create(
        address recipient,
        address token,
        uint128 amount,
        uint64 start,
        uint64 cliff,
        uint64 end,
        bool revocable
    ) external nonReentrant returns (uint256 streamId) {
        if (recipient == address(0) || token == address(0)) revert ZeroAddress();
        if (recipient == msg.sender) revert SelfStream();
        if (amount == 0) revert ZeroAmount();
        VestingMath.validateSchedule(start, cliff, end);

        IERC20 erc20 = IERC20(token);
        uint256 balanceBefore = erc20.balanceOf(address(this));
        erc20.safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = erc20.balanceOf(address(this));
        if (balanceAfter < balanceBefore) revert TransferAmountMismatch();
        uint256 received = balanceAfter - balanceBefore;

        if (received != amount) revert TransferAmountMismatch();
        uint128 deposit = amount;

        streamId = nextStreamId++;
        streams[streamId] = Stream({
            sender: msg.sender,
            start: start,
            revocable: revocable,
            cancelled: false,
            recipient: recipient,
            cliff: cliff,
            token: token,
            end: end,
            deposit: deposit,
            withdrawn: 0
        });

        emit StreamCreated(streamId, msg.sender, recipient, token, deposit, start, cliff, end, revocable);
    }

    /// @notice Withdraw `amount` of the accrued balance to the stream's recipient.
    /// @dev DECISION (blueprint left this open): ANY address may call. Funds always go
    ///      to the stored recipient, so a third party can only pay gas on the
    ///      recipient's behalf. This enables gasless UX via a relayer and mirrors the
    ///      airdrop's claim-for-another property.
    function withdraw(uint256 streamId, uint128 amount) external nonReentrant {
        _withdraw(streamId, amount);
    }

    /// @notice Withdraw the entire currently-claimable balance.
    /// @dev Exists so callers never encode "everything" as a magic zero `amount`,
    ///      which would collide with the zero-amount rejection in `_withdraw`.
    function withdrawMax(uint256 streamId) external nonReentrant returns (uint128 amount) {
        Stream storage s = _get(streamId);
        if (s.cancelled) revert StreamIsCancelled();
        amount = _vested(s) - s.withdrawn;
        _withdraw(streamId, amount);
    }

    /// @notice Revoke a revocable stream, settling both sides at the current timestamp.
    /// @dev Cancellation is terminal and complete: the recipient is paid everything
    ///      accrued and the sender is refunded the remainder in this one call. The
    ///      stream is then fully settled and `withdraw` reverts on it.
    ///
    ///      `end` IS DELIBERATELY NOT MUTATED. Freezing accrual by assigning
    ///      `end = block.timestamp` looks correct and does the opposite: VestingMath
    ///      returns `total` for every `timestamp >= end`, so moving `end` into the
    ///      past makes the FULL deposit read as vested forever after, letting the
    ///      recipient withdraw the sender's already-refunded remainder out of other
    ///      streams' balances. Settling `deposit` down to what actually accrued is
    ///      what freezes the schedule.
    function cancel(uint256 streamId) external nonReentrant {
        Stream storage s = _get(streamId);
        if (msg.sender != s.sender) revert NotSender();
        if (!s.revocable) revert NotRevocable();
        if (s.cancelled) revert AlreadyCancelled();

        uint128 vested = _vested(s);
        uint128 recipientOwed = vested - s.withdrawn;
        uint128 senderRefund = s.deposit - vested;

        // EFFECTS — complete before either transfer, because cancellation moves funds
        // twice and a callback token could re-enter between the two.
        s.cancelled = true;
        s.deposit = vested;
        s.withdrawn = vested;

        emit StreamCancelled(streamId, recipientOwed, senderRefund);

        // INTERACTIONS
        IERC20 erc20 = IERC20(s.token);
        if (recipientOwed != 0) _transferExact(erc20, s.recipient, recipientOwed);
        if (senderRefund != 0) _transferExact(erc20, s.sender, senderRefund);
    }

    /// @notice Amount accrued to the recipient so far, including what was withdrawn.
    /// @dev Frontend: pair with `streams(id).deposit` to draw the vesting bar.
    ///
    ///      A cancelled stream is fully settled: `cancel` writes `deposit = withdrawn
    ///      = vested`, so the accrued figure IS the deposit. Recomputing it would
    ///      instead return a fraction of that settled deposit, because `end` is
    ///      deliberately left in the future (see `cancel`), and the bar would render a
    ///      settled stream as barely started.
    function vestedOf(uint256 streamId) external view returns (uint128) {
        Stream storage s = _get(streamId);
        return s.cancelled ? s.deposit : _vested(s);
    }

    /// @notice Amount the recipient can withdraw right now.
    /// @dev Frontend: the per-second counter interpolates between successive reads of
    ///      this value. Display only; the contract remains the source of truth.
    function claimableOf(uint256 streamId) external view returns (uint128) {
        Stream storage s = _get(streamId);
        if (s.cancelled) return 0;
        return _vested(s) - s.withdrawn;
    }

    function _withdraw(uint256 streamId, uint128 amount) private {
        Stream storage s = _get(streamId);
        if (s.cancelled) revert StreamIsCancelled();
        if (amount == 0) revert NothingToWithdraw();

        uint128 withdrawn = s.withdrawn;
        if (amount > _vested(s) - withdrawn) revert ExceedsClaimable();

        // EFFECTS before INTERACTIONS.
        s.withdrawn = withdrawn + amount;

        address recipient = s.recipient;
        emit Withdrawn(streamId, recipient, amount);
        _transferExact(IERC20(s.token), recipient, amount);
    }

    function _transferExact(IERC20 token, address to, uint128 amount) private {
        uint256 balanceBefore = token.balanceOf(to);
        token.safeTransfer(to, amount);
        uint256 balanceAfter = token.balanceOf(to);
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != amount) {
            revert TransferAmountMismatch();
        }
    }

    /// @dev Loads a stream, reverting if it was never created.
    function _get(uint256 streamId) private view returns (Stream storage s) {
        s = streams[streamId];
        if (s.sender == address(0)) revert NoStream();
    }

    /// @dev Accrual for `s`, bounded and narrowed in that order. The bound is checked
    ///      on the full uint256 BEFORE narrowing, so a hypothetical over-accrual
    ///      cannot be truncated into a value that slips past the guard.
    function _vested(Stream storage s) private view returns (uint128) {
        uint128 deposit = s.deposit;
        uint256 vested =
            VestingMath.vestedAmount(deposit, s.start, s.cliff, s.end, uint64(block.timestamp));
        if (vested > deposit) revert AccrualExceedsDeposit();
        // Proven `vested <= deposit` and `deposit` is uint128, so this cannot truncate.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint128(vested);
    }
}
