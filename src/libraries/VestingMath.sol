// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title VestingMath
/// @notice Linear-with-cliff accrual. Pure, stateless, no external calls.
/// @dev This library is the shared engine for PaymentStream and MerkleVestedAirdrop.
///      It is written so that `vestedAmount` is total-function: it cannot revert and
///      cannot overflow for ANY input, without relying on the caller having validated
///      the schedule first. See the guard-ordering proof on `vestedAmount`.
library VestingMath {
    /// @notice Thrown by `validateSchedule` when a schedule can never accrue correctly.
    error InvalidSchedule();

    /// @notice Shortest permitted `end - start`.
    /// @dev Validators can nudge `block.timestamp` by a few seconds. Over an hour or
    ///      more that moves the payout by a negligible fraction. Below it, timestamp
    ///      manipulation becomes a material share of the schedule.
    uint64 internal constant MIN_DURATION = 1 hours;

    /// @notice Reverts unless (start, cliff, end) describes a usable schedule.
    /// @dev Call this at creation time in every contract that stores a schedule.
    ///      `vestedAmount` is safe without it; this exists to fail loudly and early
    ///      rather than silently storing a schedule that accrues in a useless shape.
    function validateSchedule(uint64 start, uint64 cliff, uint64 end) internal pure {
        if (end <= start) revert InvalidSchedule();
        // `end > start` proven above, so this subtraction cannot underflow.
        if (end - start < MIN_DURATION) revert InvalidSchedule();
        if (cliff < start || cliff > end) revert InvalidSchedule();
    }

    /// @notice Amount vested out of `total` at `timestamp`.
    /// @dev Monotonic non-decreasing in `timestamp`; never exceeds `total`; exact at
    ///      and after `end`.
    ///
    ///      GUARD ORDERING IS LOAD-BEARING. To reach the `unchecked` block a call must
    ///      pass `timestamp < end` and `timestamp > start`, which together prove
    ///      `start < timestamp < end` and therefore `end > start`. Both subtractions
    ///      are then underflow-free for every possible argument, including a corrupt
    ///      or unvalidated schedule. Reordering these branches reintroduces an
    ///      underflow that wraps to an enormous quotient.
    ///
    ///      OVERFLOW: `total <= type(uint128).max` by parameter type and
    ///      `timestamp - start < end - start <= type(uint64).max`, so the product is
    ///      bounded by 2**192 and cannot overflow uint256.
    function vestedAmount(uint128 total, uint64 start, uint64 cliff, uint64 end, uint64 timestamp)
        internal
        pure
        returns (uint256)
    {
        // Terminal exactness. Returning `total` directly rather than computing it is
        // what releases the dust that integer division truncates away over the life of
        // the schedule. Computing the final payout as a fraction strands funds.
        if (timestamp >= end) return total;
        if (timestamp <= start) return 0;
        if (timestamp < cliff) return 0;

        unchecked {
            return (uint256(total) * (timestamp - start)) / (end - start);
        }
    }
}
