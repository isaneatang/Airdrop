// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PaymentStream} from "../src/PaymentStream.sol";
import {VestingMath} from "../src/libraries/VestingMath.sol";
import {MockERC20} from "./mocks/Tokens.sol";

/// @dev Minimal reproduction of the ORIGINAL blueprint's cancellation, which said:
///      "set `end = block.timestamp` so future accrual is frozen".
///      Kept only as the counterexample proving why PaymentStream does not do that.
contract LegacyCancelStream {
    struct S {
        uint128 deposit;
        uint128 withdrawn;
        uint64 start;
        uint64 cliff;
        uint64 end;
    }

    S public s;

    function open(uint128 deposit, uint64 start, uint64 cliff, uint64 end) external {
        s = S(deposit, 0, start, cliff, end);
    }

    /// @dev The original spec: pay both legs, then move `end` to now.
    function legacyCancel() external returns (uint256 recipientOwed, uint256 senderRefund) {
        uint256 vested = VestingMath.vestedAmount(s.deposit, s.start, s.cliff, s.end, uint64(block.timestamp));
        recipientOwed = vested - s.withdrawn;
        senderRefund = s.deposit - vested;
        // vested <= deposit and deposit is uint128, so this cannot truncate.
        // forge-lint: disable-next-line(unsafe-typecast)
        s.withdrawn = uint128(vested);
        s.end = uint64(block.timestamp); // <-- the bug
    }

    function claimableNow() external view returns (uint256) {
        uint256 vested = VestingMath.vestedAmount(s.deposit, s.start, s.cliff, s.end, uint64(block.timestamp));
        return vested - s.withdrawn;
    }
}

contract CancelRegressionTest is Test {
    PaymentStream stream;
    MockERC20 token;

    address sender = address(0xA1);
    address recipient = address(0xB2);
    address bystander = address(0xC3);

    uint128 constant DEPOSIT = 1000 ether;
    uint64 start;
    uint64 end;

    function setUp() public {
        vm.warp(1_700_000_000);
        stream = new PaymentStream();
        token = new MockERC20();

        start = uint64(block.timestamp);
        end = start + 30 days;

        token.mint(sender, DEPOSIT);
        token.mint(bystander, DEPOSIT);

        vm.prank(sender);
        token.approve(address(stream), type(uint256).max);
        vm.prank(bystander);
        token.approve(address(stream), type(uint256).max);
    }

    /// @notice Demonstrates the original design drained the contract after cancellation.
    function test_Legacy_CancelThenWithdraw_OverReleasesFullDeposit() public {
        LegacyCancelStream legacy = new LegacyCancelStream();
        legacy.open(DEPOSIT, start, start, end);

        vm.warp(start + 10 days);
        (uint256 owed, uint256 refund) = legacy.legacyCancel();

        // Settled correctly at the moment of cancellation.
        assertEq(owed + refund, DEPOSIT, "cancellation split should sum to deposit");
        assertApproxEqAbs(owed, DEPOSIT / 3, 1e15, "recipient accrued ~1/3");

        // One second later the schedule reads as fully vested, because `end` is now in
        // the past and VestingMath returns `total` for every timestamp at or past it.
        vm.warp(start + 10 days + 1);
        assertEq(legacy.claimableNow(), refund, "BUG: sender's refunded remainder is claimable again");
        assertGt(legacy.claimableNow(), 0, "BUG: cancelled stream still owes funds");
    }

    /// @notice The same sequence against the fixed contract releases nothing extra.
    function test_Fixed_CancelThenWithdraw_Reverts() public {
        vm.prank(sender);
        uint256 id = stream.create(recipient, address(token), DEPOSIT, start, start, end, true);

        vm.warp(start + 10 days);
        vm.prank(sender);
        stream.cancel(id);

        vm.warp(start + 10 days + 1);
        assertEq(stream.claimableOf(id), 0, "cancelled stream must owe nothing");

        vm.expectRevert(PaymentStream.StreamIsCancelled.selector);
        stream.withdrawMax(id);

        vm.warp(end + 365 days);
        assertEq(stream.claimableOf(id), 0, "still nothing owed long after original end");
    }

    /// @notice The drain in the legacy design stole from OTHER streams. Prove the fixed
    ///         contract keeps an unrelated stream whole across a cancellation.
    function test_Fixed_CancellationCannotTouchAnotherStreamsFunds() public {
        vm.prank(bystander);
        uint256 safeId = stream.create(recipient, address(token), DEPOSIT, start, start, end, false);

        vm.prank(sender);
        uint256 victimId = stream.create(recipient, address(token), DEPOSIT, start, start, end, true);

        vm.warp(start + 10 days);
        vm.prank(sender);
        stream.cancel(victimId);

        // The bystander's stream must still be able to pay out in full at `end`.
        vm.warp(end);
        uint256 before = token.balanceOf(recipient);
        stream.withdrawMax(safeId);
        assertEq(token.balanceOf(recipient) - before, DEPOSIT, "unrelated stream must pay in full");
    }

    /// @notice Cancelling a not-yet-started stream is the worst legacy case: `end` would
    ///         land BEFORE `start`, inverting the schedule.
    function test_Fixed_CancelBeforeStart_RefundsAllAndStaysSettled() public {
        uint64 futureStart = uint64(block.timestamp) + 7 days;
        uint64 futureEnd = futureStart + 30 days;

        vm.prank(sender);
        uint256 id = stream.create(recipient, address(token), DEPOSIT, futureStart, futureStart, futureEnd, true);

        uint256 senderBefore = token.balanceOf(sender);
        vm.prank(sender);
        stream.cancel(id);

        assertEq(token.balanceOf(sender) - senderBefore, DEPOSIT, "full refund before start");
        assertEq(token.balanceOf(recipient), 0, "recipient accrued nothing");

        vm.warp(futureEnd + 1 days);
        assertEq(stream.claimableOf(id), 0, "must stay settled past the original end");
        assertEq(token.balanceOf(address(stream)), 0, "contract holds nothing");
    }
}
