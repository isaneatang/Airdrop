// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {MerkleVestedAirdrop} from "../src/MerkleVestedAirdrop.sol";
import {VestingMath} from "../src/libraries/VestingMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "./mocks/Tokens.sol";

/// @dev Mirrors the contract's leaf encoding and OZ's sorted-pair internal hashing.
///      Any divergence between this and `MerkleVestedAirdrop.claim` is exactly the
///      failure the off-chain generator must also avoid, so the tests below double as
///      the encoding contract.
library TestMerkle {
    function leafOf(uint256 index, address account, uint128 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))));
    }

    function hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }
}

contract MerkleVestedAirdropTest is Test {
    using TestMerkle for bytes32;

    MerkleVestedAirdrop drop;
    MockERC20 token;

    address[4] recipients = [address(0xA1), address(0xB2), address(0xC3), address(0xD4)];
    // Deliberately not divisible by the duration, so truncation dust is exercised.
    uint128[4] amounts = [uint128(1000 ether + 7), 2500 ether + 13, 331 ether + 1, 4169 ether + 3];
    uint256 totalAllocated;

    bytes32[4] leaves;
    bytes32 n01;
    bytes32 n23;
    bytes32 root;

    address stranger = address(0xE5);
    uint64 start;
    uint64 cliff;
    uint64 end;

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new MockERC20();

        for (uint256 i = 0; i < 4; i++) {
            leaves[i] = TestMerkle.leafOf(i, recipients[i], amounts[i]);
            totalAllocated += amounts[i];
        }
        n01 = TestMerkle.hashPair(leaves[0], leaves[1]);
        n23 = TestMerkle.hashPair(leaves[2], leaves[3]);
        root = TestMerkle.hashPair(n01, n23);

        start = uint64(block.timestamp);
        cliff = start + 30 days;
        end = start + 365 days;

        drop = new MerkleVestedAirdrop(IERC20(address(token)), root, totalAllocated, start, cliff, end);
    }

    function _fund() internal {
        token.mint(address(drop), totalAllocated);
        drop.activate();
    }

    function _proof(uint256 i) internal view returns (bytes32[] memory p) {
        p = new bytes32[](2);
        if (i == 0) (p[0], p[1]) = (leaves[1], n23);
        else if (i == 1) (p[0], p[1]) = (leaves[0], n23);
        else if (i == 2) (p[0], p[1]) = (leaves[3], n01);
        else (p[0], p[1]) = (leaves[2], n01);
    }

    // ------------------------------------------------------------- constructor

    function test_Constructor_RejectsZeroRoot() public {
        vm.expectRevert(MerkleVestedAirdrop.ZeroRoot.selector);
        new MerkleVestedAirdrop(IERC20(address(token)), bytes32(0), totalAllocated, start, cliff, end);
    }

    function test_Constructor_RejectsZeroToken() public {
        vm.expectRevert(MerkleVestedAirdrop.ZeroAddress.selector);
        new MerkleVestedAirdrop(IERC20(address(0)), root, totalAllocated, start, cliff, end);
    }

    function test_Constructor_RejectsZeroAllocation() public {
        vm.expectRevert(MerkleVestedAirdrop.ZeroAllocation.selector);
        new MerkleVestedAirdrop(IERC20(address(token)), root, 0, start, cliff, end);
    }

    function test_Constructor_RejectsBadSchedule() public {
        vm.expectRevert(VestingMath.InvalidSchedule.selector);
        new MerkleVestedAirdrop(IERC20(address(token)), root, totalAllocated, start, cliff, start);
    }

    // ---------------------------------------------------------------- funding

    function test_Claim_BeforeFundedReverts() public {
        vm.expectRevert(MerkleVestedAirdrop.NotFunded.selector);
        drop.claim(0, recipients[0], amounts[0], _proof(0));
    }

    function test_Activate_UnderfundedReverts() public {
        token.mint(address(drop), totalAllocated - 1);
        vm.expectRevert(
            abi.encodeWithSelector(MerkleVestedAirdrop.Underfunded.selector, totalAllocated - 1, totalAllocated)
        );
        drop.activate();
    }

    function test_Activate_IsOneWay() public {
        _fund();
        vm.expectRevert(MerkleVestedAirdrop.AlreadyActivated.selector);
        drop.activate();
    }

    // ----------------------------------------------------------------- claims

    function test_Claim_NothingBeforeCliff() public {
        _fund();
        vm.warp(start + 29 days);
        vm.expectRevert(MerkleVestedAirdrop.NothingToClaim.selector);
        drop.claim(0, recipients[0], amounts[0], _proof(0));
    }

    function test_Claim_ValidProofAtMultiplePointsInSchedule() public {
        _fund();

        vm.warp(start + 100 days);
        drop.claim(0, recipients[0], amounts[0], _proof(0));
        uint256 atDay100 = token.balanceOf(recipients[0]);
        assertGt(atDay100, 0);

        vm.warp(start + 250 days);
        drop.claim(0, recipients[0], amounts[0], _proof(0));
        uint256 atDay250 = token.balanceOf(recipients[0]);
        assertGt(atDay250, atDay100, "second claim must release the newly vested slice");

        vm.warp(end);
        drop.claim(0, recipients[0], amounts[0], _proof(0));
        assertEq(token.balanceOf(recipients[0]), amounts[0], "full allocation by end");
    }

    function test_Claim_TwiceAtSameTimestampReverts() public {
        _fund();
        vm.warp(start + 100 days);
        drop.claim(0, recipients[0], amounts[0], _proof(0));
        vm.expectRevert(MerkleVestedAirdrop.NothingToClaim.selector);
        drop.claim(0, recipients[0], amounts[0], _proof(0));
    }

    function test_Claim_InvalidProofReverts() public {
        _fund();
        vm.warp(end);
        bytes32[] memory wrong = _proof(1); // proof for a different leaf
        vm.expectRevert(MerkleVestedAirdrop.InvalidProof.selector);
        drop.claim(0, recipients[0], amounts[0], wrong);
    }

    function test_Claim_InflatedAmountReverts() public {
        _fund();
        vm.warp(end);
        vm.expectRevert(MerkleVestedAirdrop.InvalidProof.selector);
        drop.claim(0, recipients[0], amounts[0] + 1, _proof(0));
    }

    function test_Claim_SubstitutedAccountReverts() public {
        _fund();
        vm.warp(end);
        vm.expectRevert(MerkleVestedAirdrop.InvalidProof.selector);
        drop.claim(0, stranger, amounts[0], _proof(0));
    }

    /// @notice The double hash. An internal node is a legitimate proof target in the raw
    ///         proof system, but the contract derives the leaf from (index, account,
    ///         amount) and never accepts a caller-supplied node, so the node can never
    ///         be presented as a leaf.
    function test_Claim_InternalNodePresentedAsLeafReverts() public {
        _fund();
        vm.warp(end);

        bytes32[] memory proofForNode = new bytes32[](1);
        proofForNode[0] = n23;

        // The internal node genuinely verifies against the root at depth 1. This is the
        // property that makes single-hashed leaves forgeable.
        assertTrue(MerkleProof.verify(proofForNode, root, n01), "n01 is a real node in the tree");

        // But no (index, account, amount) can produce n01 as a leaf, because leaf
        // preimages are 32 bytes and internal-node preimages are 64.
        vm.expectRevert(MerkleVestedAirdrop.InvalidProof.selector);
        drop.claim(0, recipients[0], amounts[0], proofForNode);

        vm.expectRevert(MerkleVestedAirdrop.InvalidProof.selector);
        drop.claim(uint256(n01), address(uint160(uint256(n01))), uint128(uint256(n01)), proofForNode);
    }

    function test_Claim_ThirdPartyTriggersButCannotRedirect() public {
        _fund();
        vm.warp(end);

        vm.prank(stranger);
        drop.claim(0, recipients[0], amounts[0], _proof(0));

        assertEq(token.balanceOf(recipients[0]), amounts[0], "funds land with the leaf's account");
        assertEq(token.balanceOf(stranger), 0, "caller receives nothing");
    }

    /// @notice Terminal exactness across the whole tree: every allocation pays out in
    ///         full and the contract is left with exactly zero.
    function test_Claim_AllRecipientsFullyPaid_NoDustStranded() public {
        _fund();

        // Partial claims part-way through, to accumulate truncation dust.
        vm.warp(start + 137 days);
        for (uint256 i = 0; i < 4; i++) {
            drop.claim(i, recipients[i], amounts[i], _proof(i));
        }

        vm.warp(end);
        for (uint256 i = 0; i < 4; i++) {
            drop.claim(i, recipients[i], amounts[i], _proof(i));
            assertEq(token.balanceOf(recipients[i]), amounts[i], "recipient short-paid");
        }

        assertEq(token.balanceOf(address(drop)), 0, "dust stranded in the contract");
    }

    function test_ClaimableOf_TracksContractAccounting() public {
        _fund();
        vm.warp(start + 200 days);

        uint256 previewed = drop.claimableOf(0, amounts[0]);
        drop.claim(0, recipients[0], amounts[0], _proof(0));
        assertEq(token.balanceOf(recipients[0]), previewed, "view must match what claim released");
        assertEq(drop.claimableOf(0, amounts[0]), 0, "nothing left immediately after");
    }

    function testFuzz_ClaimNeverExceedsAllocation(uint64 at) public {
        _fund();
        at = uint64(bound(at, start, end + 400 days));
        vm.warp(at);

        if (drop.claimableOf(0, amounts[0]) == 0) return;
        drop.claim(0, recipients[0], amounts[0], _proof(0));
        assertLe(token.balanceOf(recipients[0]), amounts[0], "over-released");
        assertEq(drop.claimedAmount(0), token.balanceOf(recipients[0]), "accounting diverged from balance");
    }
}
