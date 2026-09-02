// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PaymentStream} from "../src/PaymentStream.sol";
import {VestingMath} from "../src/libraries/VestingMath.sol";
import {MockERC20, FeeOnTransferToken, ReentrantToken, ReturnBombToken, InflatingToken} from "./mocks/Tokens.sol";

contract PaymentStreamTest is Test {
    PaymentStream stream;
    MockERC20 token;

    address sender = address(0xA1);
    address recipient = address(0xB2);
    address relayer = address(0xD4);

    uint128 constant DEPOSIT = 1000 ether;
    uint64 start;
    uint64 end;

    function setUp() public {
        vm.warp(1_700_000_000);
        stream = new PaymentStream();
        token = new MockERC20();
        start = uint64(block.timestamp);
        end = start + 30 days;

        token.mint(sender, 10 * uint256(DEPOSIT));
        vm.prank(sender);
        token.approve(address(stream), type(uint256).max);
    }

    function _open(bool revocable) internal returns (uint256) {
        vm.prank(sender);
        return stream.create(recipient, address(token), DEPOSIT, start, start, end, revocable);
    }

    function _openWithCliff(uint64 cliff) internal returns (uint256) {
        vm.prank(sender);
        return stream.create(recipient, address(token), DEPOSIT, start, cliff, end, true);
    }

    // ---------------------------------------------------------------- creation

    function test_Create_StoresExactDeposit() public {
        uint256 id = _open(true);
        (address s_,,,, address r_,, address t_,, uint128 dep, uint128 wd) = stream.streams(id);
        assertEq(s_, sender);
        assertEq(r_, recipient);
        assertEq(t_, address(token));
        assertEq(dep, DEPOSIT);
        assertEq(wd, 0);
        assertEq(token.balanceOf(address(stream)), DEPOSIT);
    }

    function test_Create_RejectsSelfStream() public {
        vm.prank(sender);
        vm.expectRevert(PaymentStream.SelfStream.selector);
        stream.create(sender, address(token), DEPOSIT, start, start, end, true);
    }

    function test_Create_RejectsZeroRecipient() public {
        vm.prank(sender);
        vm.expectRevert(PaymentStream.ZeroAddress.selector);
        stream.create(address(0), address(token), DEPOSIT, start, start, end, true);
    }

    function test_Create_RejectsSubMinimumDuration() public {
        vm.prank(sender);
        vm.expectRevert(VestingMath.InvalidSchedule.selector);
        stream.create(recipient, address(token), DEPOSIT, start, start, start + 59 minutes, true);
    }

    function test_Create_IdsAreMonotonicAndNeverReused() public {
        assertEq(_open(true), 0);
        assertEq(_open(true), 1);
        assertEq(_open(true), 2);
        assertEq(stream.nextStreamId(), 3);
    }

    // ---------------------------------------------------------------- withdraw

    function test_Withdraw_BeforeCliffReverts() public {
        uint256 id = _openWithCliff(start + 10 days);
        vm.warp(start + 5 days);
        vm.expectRevert(PaymentStream.NothingToWithdraw.selector);
        stream.withdrawMax(id);
    }

    function test_Withdraw_ExactClaimableSucceeds_OneWeiMoreReverts() public {
        uint256 id = _open(true);
        vm.warp(start + 10 days);
        uint128 claimable = stream.claimableOf(id);

        vm.expectRevert(PaymentStream.ExceedsClaimable.selector);
        stream.withdraw(id, claimable + 1);

        stream.withdraw(id, claimable);
        assertEq(token.balanceOf(recipient), claimable);
    }

    function test_Withdraw_RepeatedPartialsSumToDepositAtEnd() public {
        uint256 id = _open(true);
        for (uint256 i = 1; i <= 29; i++) {
            vm.warp(start + i * 1 days);
            stream.withdrawMax(id);
        }
        vm.warp(end);
        stream.withdrawMax(id);
        assertEq(token.balanceOf(recipient), DEPOSIT, "partials must sum exactly to deposit");
        assertEq(token.balanceOf(address(stream)), 0, "no dust stranded");
    }

    function test_Withdraw_AnyoneMayTrigger_FundsGoToRecipient() public {
        uint256 id = _open(true);
        vm.warp(start + 15 days);
        vm.prank(relayer);
        stream.withdrawMax(id);
        assertGt(token.balanceOf(recipient), 0, "recipient paid");
        assertEq(token.balanceOf(relayer), 0, "relayer received nothing");
    }

    function test_Withdraw_UnknownStreamReverts() public {
        vm.expectRevert(PaymentStream.NoStream.selector);
        stream.withdrawMax(999);
    }

    // ------------------------------------------------------------------ cancel

    function test_Cancel_BeforeCliff_FullRefundZeroToRecipient() public {
        uint256 id = _openWithCliff(start + 10 days);
        vm.warp(start + 5 days);

        uint256 senderBefore = token.balanceOf(sender);
        vm.prank(sender);
        stream.cancel(id);

        assertEq(token.balanceOf(sender) - senderBefore, DEPOSIT);
        assertEq(token.balanceOf(recipient), 0);
    }

    function test_Cancel_MidStreamAfterPartialWithdrawal_ThreeWayAccounting() public {
        uint256 id = _open(true);

        vm.warp(start + 10 days);
        stream.withdrawMax(id);
        uint256 withdrawn = token.balanceOf(recipient);

        vm.warp(start + 20 days);
        uint256 senderBefore = token.balanceOf(sender);
        vm.prank(sender);
        stream.cancel(id);

        uint256 recipientTotal = token.balanceOf(recipient);
        uint256 refund = token.balanceOf(sender) - senderBefore;

        assertGt(recipientTotal, withdrawn, "recipient received the cancellation leg");
        assertEq(recipientTotal + refund, DEPOSIT, "three-way accounting must sum to deposit");
        assertEq(token.balanceOf(address(stream)), 0, "contract fully drained of this stream");
    }

    function test_Cancel_AfterFullVest_ZeroRefund() public {
        uint256 id = _open(true);
        vm.warp(end + 1 days);

        uint256 senderBefore = token.balanceOf(sender);
        vm.prank(sender);
        stream.cancel(id);

        assertEq(token.balanceOf(sender) - senderBefore, 0, "nothing left to refund");
        assertEq(token.balanceOf(recipient), DEPOSIT, "recipient gets the whole deposit");
    }

    function test_Cancel_DoubleCancelReverts() public {
        uint256 id = _open(true);
        vm.warp(start + 5 days);
        vm.prank(sender);
        stream.cancel(id);
        vm.prank(sender);
        vm.expectRevert(PaymentStream.AlreadyCancelled.selector);
        stream.cancel(id);
    }

    function test_Cancel_NonRevocableReverts() public {
        uint256 id = _open(false);
        vm.warp(start + 5 days);
        vm.prank(sender);
        vm.expectRevert(PaymentStream.NotRevocable.selector);
        stream.cancel(id);
    }

    function test_Cancel_NonSenderReverts() public {
        uint256 id = _open(true);
        vm.prank(recipient);
        vm.expectRevert(PaymentStream.NotSender.selector);
        stream.cancel(id);
    }

    /// @notice A recipient front-running `cancel` with `withdraw` gains nothing: they
    ///         receive only what had already accrued, which cancellation would have
    ///         paid them anyway.
    function test_Cancel_FrontRunByRecipientIsNeutral() public {
        uint256 idA = _open(true);
        uint256 idB = _open(true);

        // Path A: recipient front-runs with a withdraw, then the cancel lands.
        vm.warp(start + 12 days);
        stream.withdrawMax(idA);
        vm.prank(sender);
        stream.cancel(idA);
        uint256 pathA = token.balanceOf(recipient);

        // Path B: cancel lands with no front-run, at the same timestamp.
        vm.prank(sender);
        stream.cancel(idB);
        uint256 pathB = token.balanceOf(recipient) - pathA;

        assertEq(pathA, pathB, "front-running cancellation must be worth nothing");
    }

    // ------------------------------------------------------- hostile token set

    function test_FeeOnTransfer_DepositIsRejected() public {
        FeeOnTransferToken fee = new FeeOnTransferToken(200); // 2%
        fee.mint(sender, DEPOSIT);
        vm.prank(sender);
        fee.approve(address(stream), type(uint256).max);

        vm.prank(sender);
        vm.expectRevert(PaymentStream.TransferAmountMismatch.selector);
        stream.create(recipient, address(fee), DEPOSIT, start, start, end, true);
    }

    function test_Reentrancy_RecursiveWithdrawReverts() public {
        ReentrantToken evil = new ReentrantToken();
        evil.mint(sender, DEPOSIT);
        vm.prank(sender);
        evil.approve(address(stream), type(uint256).max);

        vm.prank(sender);
        uint256 id = stream.create(recipient, address(evil), DEPOSIT, start, start, end, true);

        evil.arm(address(stream), abi.encodeCall(PaymentStream.withdrawMax, (id)));
        vm.warp(start + 10 days);

        vm.expectRevert(); // ReentrancyGuardReentrantCall, bubbled through the token
        stream.withdrawMax(id);
    }

    /// @notice SafeERC20 bounds its returndata copy to 32 bytes, so a token returning
    ///         64KB cannot exhaust the caller's gas. Recorded as a gas ceiling.
    function test_ReturnBomb_DoesNotExhaustGas() public {
        ReturnBombToken bomb = new ReturnBombToken();
        bomb.mint(sender, DEPOSIT);

        vm.prank(sender);
        uint256 gasBefore = gasleft();
        uint256 id = stream.create(recipient, address(bomb), DEPOSIT, start, start, end, true);
        uint256 used = gasBefore - gasleft();

        assertLt(used, 400_000, "return bomb inflated create() gas");
        vm.warp(end);
        stream.withdrawMax(id);
        assertEq(bomb.balanceOf(recipient), DEPOSIT);
    }

    // ------------------------------------------------------------ view surface

    function test_VestedOf_TracksAccrualIncludingWithdrawn() public {
        uint256 id = _open(true);

        vm.warp(start + 10 days);
        uint128 vestedBefore = stream.vestedOf(id);
        assertApproxEqRel(vestedBefore, DEPOSIT / 3, 1e15, "one third accrued at day 10");

        stream.withdrawMax(id);
        assertEq(stream.vestedOf(id), vestedBefore, "vestedOf must include what was withdrawn");
        assertEq(stream.claimableOf(id), 0, "nothing left claimable immediately after");

        vm.warp(end);
        assertEq(stream.vestedOf(id), DEPOSIT, "fully vested at end");
    }

    /// @notice A cancelled stream reads as fully settled, not as partially accrued.
    /// @dev Found on testnet, not in this suite. `cancel` settles `deposit` down to
    ///      what accrued and leaves `end` in the future on purpose, so recomputing
    ///      accrual afterwards returns a FRACTION of that settled deposit. The
    ///      frontend pairs vestedOf with deposit to draw the vesting bar (RESEARCH.txt
    ///      9.4), so the unfixed version renders a settled stream as barely started.
    ///      No funds were ever at risk: claimableOf already returned 0 and both
    ///      withdraw paths revert on a cancelled stream.
    function test_VestedOf_OnCancelledStreamReadsAsFullySettled() public {
        uint256 id = _open(true);

        vm.warp(start + 10 days);
        vm.prank(sender);
        stream.cancel(id);

        (,,,,,,,, uint128 deposit, uint128 withdrawn) = stream.streams(id);
        assertEq(deposit, withdrawn, "cancel must leave the stream settled");
        assertEq(stream.vestedOf(id), deposit, "vestedOf must equal the settled deposit");
        assertEq(stream.claimableOf(id), 0, "nothing claimable on a cancelled stream");

        // Still settled well past the original end, where the raw computation would
        // otherwise have jumped to the terminal branch.
        vm.warp(end + 365 days);
        assertEq(stream.vestedOf(id), deposit, "settled figure must not drift with time");
        assertEq(stream.claimableOf(id), 0, "still nothing claimable");
    }

    function test_VestedOf_UnknownStreamReverts() public {
        vm.expectRevert(PaymentStream.NoStream.selector);
        stream.vestedOf(999);
    }

    function test_ClaimableOf_UnknownStreamReverts() public {
        vm.expectRevert(PaymentStream.NoStream.selector);
        stream.claimableOf(999);
    }

    // -------------------------------------------------- remaining revert paths

    function test_Cancel_UnknownStreamReverts() public {
        vm.expectRevert(PaymentStream.NoStream.selector);
        vm.prank(sender);
        stream.cancel(999);
    }

    function test_Withdraw_ZeroAmountReverts() public {
        uint256 id = _open(true);
        vm.warp(start + 10 days);
        vm.expectRevert(PaymentStream.NothingToWithdraw.selector);
        stream.withdraw(id, 0);
    }

    function test_Withdraw_OnCancelledStreamReverts() public {
        uint256 id = _open(true);
        vm.warp(start + 10 days);
        vm.prank(sender);
        stream.cancel(id);

        vm.expectRevert(PaymentStream.StreamIsCancelled.selector);
        stream.withdraw(id, 1);
    }

    function test_Create_RejectsZeroToken() public {
        vm.prank(sender);
        vm.expectRevert(PaymentStream.ZeroAddress.selector);
        stream.create(recipient, address(0), DEPOSIT, start, start, end, true);
    }

    function test_Create_RejectsZeroAmount() public {
        vm.prank(sender);
        vm.expectRevert(PaymentStream.ZeroAmount.selector);
        stream.create(recipient, address(token), 0, start, start, end, true);
    }

    /// @notice A token that credits MORE than requested (inflationary/rebasing) is
    ///         rejected outright rather than mis-accounted.
    function test_Create_RejectsOverCreditingToken() public {
        InflatingToken infl = new InflatingToken();
        infl.mint(sender, 10 * uint256(DEPOSIT));
        vm.prank(sender);
        infl.approve(address(stream), type(uint256).max);

        vm.prank(sender);
        vm.expectRevert(PaymentStream.TransferAmountMismatch.selector);
        stream.create(recipient, address(infl), DEPOSIT, start, start, end, true);
    }

    function test_Withdraw_RejectsFeeOnTransferPayout() public {
        FeeOnTransferToken fee = new FeeOnTransferToken(0);
        fee.mint(sender, DEPOSIT);
        vm.prank(sender);
        fee.approve(address(stream), type(uint256).max);
        vm.prank(sender);
        uint256 id = stream.create(recipient, address(fee), DEPOSIT, start, start, end, true);

        fee.setFeeBps(200);
        vm.warp(end);
        vm.expectRevert(PaymentStream.TransferAmountMismatch.selector);
        stream.withdrawMax(id);
    }

    function test_Cancel_RejectsFeeOnTransferPayout() public {
        FeeOnTransferToken fee = new FeeOnTransferToken(0);
        fee.mint(sender, DEPOSIT);
        vm.prank(sender);
        fee.approve(address(stream), type(uint256).max);
        vm.prank(sender);
        uint256 id = stream.create(recipient, address(fee), DEPOSIT, start, start, end, true);

        fee.setFeeBps(200);
        vm.prank(sender);
        vm.expectRevert(PaymentStream.TransferAmountMismatch.selector);
        stream.cancel(id);
    }

    /// @notice A fee token taking 100% delivers nothing, which must not create a stream.
    function test_Create_RejectsFullyConfiscatingToken() public {
        FeeOnTransferToken all = new FeeOnTransferToken(10_000);
        all.mint(sender, DEPOSIT);
        vm.prank(sender);
        all.approve(address(stream), type(uint256).max);

        vm.prank(sender);
        vm.expectRevert(PaymentStream.TransferAmountMismatch.selector);
        stream.create(recipient, address(all), DEPOSIT, start, start, end, true);
    }

    // ------------------------------------------------------------------- fuzz

    /// @notice Conservation: whatever the schedule and cancellation point, the sender's
    ///         refund plus everything the recipient received equals the deposit, and
    ///         the contract keeps nothing.
    function testFuzz_CancellationConservesValue(uint64 cliffOffset, uint64 cancelAt, uint128 amount) public {
        amount = uint128(bound(amount, 1e6, type(uint96).max));
        uint64 duration = 30 days;
        uint64 s_ = uint64(block.timestamp);
        uint64 e_ = s_ + duration;
        uint64 c_ = s_ + uint64(bound(cliffOffset, 0, duration));
        cancelAt = uint64(bound(cancelAt, s_, e_ + 10 days));

        token.mint(sender, amount);
        vm.prank(sender);
        uint256 id = stream.create(recipient, address(token), amount, s_, c_, e_, true);

        uint256 streamBefore = token.balanceOf(address(stream));
        uint256 senderBefore = token.balanceOf(sender);
        uint256 recipientBefore = token.balanceOf(recipient);

        vm.warp(cancelAt);
        vm.prank(sender);
        stream.cancel(id);

        uint256 toRecipient = token.balanceOf(recipient) - recipientBefore;
        uint256 toSender = token.balanceOf(sender) - senderBefore;

        assertEq(toRecipient + toSender, amount, "value not conserved across cancellation");
        assertEq(token.balanceOf(address(stream)), streamBefore - amount, "contract retained funds");
        assertEq(stream.claimableOf(id), 0, "cancelled stream still owes");
    }
}
