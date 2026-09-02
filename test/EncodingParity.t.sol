// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MerkleVestedAirdrop} from "../src/MerkleVestedAirdrop.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "./mocks/Tokens.sol";

/// @notice Cross-language round trip. The blueprint calls a mismatch between the
///         generator's leaf encoding and the contract's "the single most likely way
///         this project breaks", so the artefacts the deploy actually consumes are
///         replayed here against a real contract rather than against a Solidity
///         re-implementation of the same encoding.
///
/// @dev Requires `node tooling/build-tree.mjs tooling/recipients.csv tooling/out`.
contract EncodingParityTest is Test {
    MerkleVestedAirdrop drop;
    MockERC20 token;
    string json;

    uint64 start;
    uint64 cliff;
    uint64 end;

    function setUp() public {
        vm.warp(1_700_000_000);
        json = vm.readFile("tooling/out/proofs.json");

        bytes32 root = vm.parseJsonBytes32(json, ".merkleRoot");
        uint256 totalAllocated = vm.parseJsonUint(json, ".totalAllocated");

        start = uint64(block.timestamp);
        cliff = start + 30 days;
        end = start + 365 days;

        token = new MockERC20();
        drop = new MerkleVestedAirdrop(IERC20(address(token)), root, totalAllocated, start, cliff, end);

        token.mint(address(drop), totalAllocated);
        drop.activate();
    }

    /// @notice Every proof the generator emitted is accepted by the contract, every
    ///         allocation pays out in full, and nothing is left behind.
    function test_GeneratedProofsVerifyAgainstTheContract() public {
        string[] memory keys = vm.parseJsonKeys(json, ".claims");
        assertGt(keys.length, 0, "generator emitted no claims");
        assertEq(keys.length, vm.parseJsonUint(json, ".recipientCount"), "claim count mismatch");

        vm.warp(end);

        uint256 paidOut;
        for (uint256 i = 0; i < keys.length; i++) {
            string memory base = string.concat(".claims.", keys[i]);

            uint256 index = vm.parseJsonUint(json, string.concat(base, ".index"));
            address account = vm.parseJsonAddress(json, string.concat(base, ".account"));
            uint256 amount = vm.parseJsonUint(json, string.concat(base, ".amount"));
            bytes32[] memory proof = vm.parseJsonBytes32Array(json, string.concat(base, ".proof"));

            // The generator rejects any allocation above uint128, so this cannot
            // truncate. Asserted rather than assumed, since the value crosses a
            // language boundary.
            assertLe(amount, type(uint128).max, "generator emitted an unclaimable amount");
            // forge-lint: disable-next-line(unsafe-typecast)
            drop.claim(index, account, uint128(amount), proof);

            assertEq(token.balanceOf(account), amount, "generated proof paid the wrong amount");
            paidOut += amount;
        }

        assertEq(paidOut, vm.parseJsonUint(json, ".totalAllocated"), "sum of leaves != totalAllocated");
        assertEq(token.balanceOf(address(drop)), 0, "contract not fully drained");
    }

    /// @notice `totalAllocated` in deploy-args.json is the figure the deploy script
    ///         consumes. If it ever drifts from the sum of the tree's leaves, `activate`
    ///         becomes a false solvency signal, so pin them together here.
    function test_DeployArgsMatchTheTree() public view {
        string memory args = vm.readFile("tooling/out/deploy-args.json");
        assertEq(vm.parseJsonBytes32(args, ".merkleRoot"), vm.parseJsonBytes32(json, ".merkleRoot"));
        assertEq(vm.parseJsonUint(args, ".totalAllocated"), vm.parseJsonUint(json, ".totalAllocated"));
        assertEq(vm.parseJsonUint(args, ".recipientCount"), vm.parseJsonUint(json, ".recipientCount"));
    }
}
