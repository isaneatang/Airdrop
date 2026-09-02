// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VestingMath} from "../src/libraries/VestingMath.sol";

/// @dev `validateSchedule` is an internal library call and inlines into its caller, so
///      `vm.expectRevert` cannot observe it without an external frame. This harness
///      supplies one.
contract ScheduleHarness {
    function validate(uint64 start, uint64 cliff, uint64 end) external pure {
        VestingMath.validateSchedule(start, cliff, end);
    }
}

contract VestingMathTest is Test {
    ScheduleHarness harness = new ScheduleHarness();

    /// Invariant 1: monotonic non-decreasing in timestamp.
    function testFuzz_Monotonic(uint128 total, uint64 start, uint64 cliff, uint64 end, uint64 t1, uint64 t2) public pure {
        (start, cliff, end) = _schedule(start, cliff, end);
        if (t1 > t2) (t1, t2) = (t2, t1);
        assertLe(
            VestingMath.vestedAmount(total, start, cliff, end, t1),
            VestingMath.vestedAmount(total, start, cliff, end, t2),
            "entitlement decreased"
        );
    }

    /// Invariant 2: bounded by total.
    function testFuzz_Bounded(uint128 total, uint64 start, uint64 cliff, uint64 end, uint64 t) public pure {
        (start, cliff, end) = _schedule(start, cliff, end);
        assertLe(VestingMath.vestedAmount(total, start, cliff, end, t), total, "exceeded total");
    }

    /// Invariant 3: terminal exactness at and past end.
    function testFuzz_ExactAtAndPastEnd(uint128 total, uint64 start, uint64 cliff, uint64 end, uint64 extra) public pure {
        (start, cliff, end) = _schedule(start, cliff, end);
        assertEq(VestingMath.vestedAmount(total, start, cliff, end, end), total, "not exact at end");
        uint64 past = end > type(uint64).max - extra ? type(uint64).max : end + extra;
        assertEq(VestingMath.vestedAmount(total, start, cliff, end, past), total, "not exact past end");
    }

    /// Invariant 4: nothing before the cliff.
    function testFuzz_ZeroBeforeCliff(uint128 total, uint64 start, uint64 cliff, uint64 end, uint64 t) public pure {
        (start, cliff, end) = _schedule(start, cliff, end);
        vm.assume(cliff > 0);
        t = uint64(bound(t, 0, uint256(cliff) - 1));
        assertEq(VestingMath.vestedAmount(total, start, cliff, end, t), 0, "accrued before cliff");
    }

    /// Invariant 5: no overflow at the extremes the type system permits.
    function test_NoOverflowAtExtremes() public pure {
        uint128 total = type(uint128).max;
        uint64 start = 0;
        uint64 end = type(uint64).max;
        uint64 mid = type(uint64).max / 2;
        uint256 vested = VestingMath.vestedAmount(total, start, start, end, mid);
        assertApproxEqRel(vested, uint256(total) / 2, 1e12, "midpoint should be ~half");
        assertLe(vested, total, "exceeded total at extremes");
    }

    /// @notice The guard-ordering claim: `vestedAmount` must be total across the FULL
    ///         input space, including schedules `validateSchedule` would reject. No
    ///         revert, no wraparound, still bounded by total.
    function testFuzz_TotalFunctionOnUnvalidatedSchedules(
        uint128 total,
        uint64 start,
        uint64 cliff,
        uint64 end,
        uint64 t
    ) public pure {
        // Deliberately NO schedule normalisation: end may be <= start, cliff may sit
        // outside [start, end]. This is the case the original library's `unchecked`
        // block wrapped on.
        uint256 vested = VestingMath.vestedAmount(total, start, cliff, end, t);
        assertLe(vested, total, "unvalidated schedule broke the bound");
    }

    /// @notice The cliff is a step, not a ramp: crossing it releases the whole accrued
    ///         portion at once rather than back-loading it.
    function test_CliffIsAStep() public pure {
        uint128 total = 1200;
        uint64 start = 1000;
        uint64 cliff = start + 300;
        uint64 end = start + 1200;

        assertEq(VestingMath.vestedAmount(total, start, cliff, end, cliff - 1), 0, "leaked before cliff");
        assertEq(VestingMath.vestedAmount(total, start, cliff, end, cliff), 300, "cliff should release accrual to date");
    }

    /// @notice Truncation always rounds down, so the contract can never over-pay.
    function testFuzz_RoundsDownNeverUp(uint128 total, uint64 duration, uint64 elapsed) public pure {
        uint64 start = 1_000_000;
        duration = uint64(bound(duration, VestingMath.MIN_DURATION, 365 days));
        elapsed = uint64(bound(elapsed, 0, duration));
        uint64 end = start + duration;

        uint256 vested = VestingMath.vestedAmount(total, start, start, end, start + elapsed);
        uint256 exact = (uint256(total) * elapsed) / duration;
        assertEq(vested, elapsed == duration ? uint256(total) : exact, "rounding drifted");
    }

    function test_ValidateSchedule_RejectsInverted() public {
        vm.expectRevert(VestingMath.InvalidSchedule.selector);
        harness.validate(2000, 2000, 1000);
    }

    function test_ValidateSchedule_RejectsTooShort() public {
        vm.expectRevert(VestingMath.InvalidSchedule.selector);
        harness.validate(1000, 1000, 1000 + VestingMath.MIN_DURATION - 1);
    }

    function test_ValidateSchedule_RejectsCliffOutsideRange() public {
        vm.expectRevert(VestingMath.InvalidSchedule.selector);
        harness.validate(1000, 999, 1000 + 2 hours);
        vm.expectRevert(VestingMath.InvalidSchedule.selector);
        harness.validate(1000, 1000 + 3 hours, 1000 + 2 hours);
    }

    /// @dev Normalises fuzz input into a schedule `validateSchedule` accepts.
    function _schedule(uint64 start, uint64 cliff, uint64 end)
        private
        pure
        returns (uint64, uint64, uint64)
    {
        start = uint64(bound(start, 0, type(uint64).max - 2 * VestingMath.MIN_DURATION - 1));
        end = uint64(bound(end, uint256(start) + VestingMath.MIN_DURATION, type(uint64).max));
        cliff = uint64(bound(cliff, start, end));
        return (start, cliff, end);
    }
}
