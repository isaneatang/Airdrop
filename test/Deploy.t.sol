// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Deployment, DeployPaymentStream, DeployMerkleVestedAirdrop} from "../script/Deploy.s.sol";
import {PaymentStream} from "../src/PaymentStream.sol";
import {MerkleVestedAirdrop} from "../src/MerkleVestedAirdrop.sol";
import {VestingMath} from "../src/libraries/VestingMath.sol";
import {MockERC20} from "./mocks/Tokens.sol";

/// @notice Exercises the deploy scripts themselves, not a re-implementation of them.
/// @dev Record writing is skipped outside `--broadcast`, so these tests leave the tree
///      clean while running the same code path an operator runs.
contract DeployPaymentStreamTest is Test {
    DeployPaymentStream script;

    function setUp() public {
        vm.chainId(968);
        script = new DeployPaymentStream();
    }

    /// @notice The deployed contract is not merely non-zero, it streams.
    function test_Deploy_ProducesAUsableStreamContract() public {
        PaymentStream stream = script.deploy(false);

        assertGt(address(stream).code.length, 0, "no code at deployed address");
        assertEq(stream.nextStreamId(), 0, "fresh contract should have no streams");

        MockERC20 token = new MockERC20();
        address sender = address(0xA1);
        address recipient = address(0xB2);

        token.mint(sender, 1000 ether);
        vm.startPrank(sender);
        token.approve(address(stream), 1000 ether);
        uint64 start = uint64(block.timestamp);
        uint256 id = stream.create(
            recipient, address(token), 1000 ether, start, start, start + 365 days, true
        );
        vm.stopPrank();

        assertEq(id, 0, "first stream should be id 0");
        vm.warp(start + 365 days);
        assertEq(stream.claimableOf(id), 1000 ether, "stream did not accrue");
    }

    /// @notice `run()` is the operator entrypoint and reads the environment for itself.
    function test_Run_DeploysOnTestnet() public {
        assertGt(address(script.run()).code.length, 0, "run() produced no contract");
    }

    /// @notice BOT Chain mainnet needs an explicit acknowledgement.
    function test_Deploy_RefusesUnconfirmedMainnet() public {
        vm.chainId(677);
        vm.expectRevert(Deployment.MainnetNotConfirmed.selector);
        script.deploy(false);
    }

    function test_Deploy_AllowsMainnetWhenConfirmed() public {
        vm.chainId(677);
        assertGt(address(script.deploy(true)).code.length, 0, "confirmed mainnet deploy failed");
    }

    function test_Deploy_RefusesUnknownChain() public {
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(Deployment.UnknownChain.selector, 1));
        script.deploy(false);
    }
}

/// @notice The airdrop deploy, driven by the artefacts build-tree.mjs actually emits.
/// @dev Requires `node tooling/build-tree.mjs tooling/recipients.csv tooling/out`, for
///      the same reason EncodingParityTest does: the artefacts the deploy consumes are
///      the thing under test.
///
///      Config is passed as a struct rather than through the environment. Env vars are
///      process-global and shared across concurrently running test contracts, so a
///      suite that configured itself by mutating them would race against itself. The
///      env-reading path has its own dedicated contract below.
contract DeployMerkleVestedAirdropTest is Test {
    DeployMerkleVestedAirdrop script;
    MockERC20 token;
    DeployMerkleVestedAirdrop.Config baseConfig;

    uint64 start;
    uint64 cliff;
    uint64 end;

    function setUp() public {
        vm.warp(1_700_000_000);
        vm.chainId(968);
        script = new DeployMerkleVestedAirdrop();
        token = new MockERC20();

        start = uint64(block.timestamp);
        cliff = start + 30 days;
        end = start + 365 days;

        string memory args = vm.readFile("tooling/out/deploy-args.json");
        baseConfig = DeployMerkleVestedAirdrop.Config({
            token: IERC20(address(token)),
            merkleRoot: vm.parseJsonBytes32(args, ".merkleRoot"),
            totalAllocated: vm.parseJsonUint(args, ".totalAllocated"),
            recipientCount: vm.parseJsonUint(args, ".recipientCount"),
            start: start,
            cliff: cliff,
            end: end,
            // tooling/recipients.csv is the worked example, which the script refuses by
            // default. The guard has its own test below.
            allowExampleRecipients: true
        });
    }

    /// @notice Deploy from the generator's artefacts, then fund, arm and drain it.
    /// @dev The end-to-end assertion is that the contract empties to EXACTLY zero. Had
    ///      the script carried through a stale root, a different total, or a narrowed
    ///      schedule value, the claims would not sum to the balance.
    function test_Deploy_FromArtefactsPaysEveryRecipient() public {
        MerkleVestedAirdrop drop = script.deploy(baseConfig, false);

        assertEq(drop.merkleRoot(), baseConfig.merkleRoot, "root");
        assertEq(drop.totalAllocated(), baseConfig.totalAllocated, "total");
        assertEq(address(drop.token()), address(token), "token");
        assertEq(drop.start(), start, "start");
        assertEq(drop.cliff(), cliff, "cliff");
        assertEq(drop.end(), end, "end");
        assertFalse(drop.funded(), "must not be armed at deploy");

        token.mint(address(drop), drop.totalAllocated());
        drop.activate();

        string memory proofs = vm.readFile("tooling/out/proofs.json");
        string[] memory keys = vm.parseJsonKeys(proofs, ".claims");
        assertEq(keys.length, baseConfig.recipientCount, "recipient count");

        vm.warp(end);
        for (uint256 i = 0; i < keys.length; i++) {
            string memory base = string.concat(".claims.", keys[i]);
            uint256 index = vm.parseJsonUint(proofs, string.concat(base, ".index"));
            address account = vm.parseJsonAddress(proofs, string.concat(base, ".account"));
            uint256 amount = vm.parseJsonUint(proofs, string.concat(base, ".amount"));
            bytes32[] memory proof = vm.parseJsonBytes32Array(proofs, string.concat(base, ".proof"));

            // The generator rejects any allocation above uint128, so this cannot
            // truncate. Asserted rather than assumed, since the value crosses a
            // language boundary.
            assertLe(amount, type(uint128).max, "generator emitted an unclaimable amount");
            // forge-lint: disable-next-line(unsafe-typecast)
            drop.claim(index, account, uint128(amount), proof);
            assertEq(token.balanceOf(account), amount, "recipient underpaid");
        }

        assertEq(token.balanceOf(address(drop)), 0, "dust stranded in the airdrop");
    }

    /// @notice The placeholder recipient list cannot be deployed by accident.
    /// @dev The most consequential guard here. tooling/recipients.csv holds four
    ///      placeholder addresses; an immutable, non-revocable contract funded against
    ///      that root is unclaimable and unrecoverable forever.
    function test_Deploy_RefusesTheExampleRecipientList() public {
        DeployMerkleVestedAirdrop.Config memory c = baseConfig;
        c.allowExampleRecipients = false;
        vm.expectRevert(DeployMerkleVestedAirdrop.ExampleRecipientList.selector);
        script.deploy(c, false);
    }

    function test_Deploy_RefusesEmptyRoot() public {
        DeployMerkleVestedAirdrop.Config memory c = baseConfig;
        c.merkleRoot = bytes32(0);
        vm.expectRevert(DeployMerkleVestedAirdrop.EmptyTree.selector);
        script.deploy(c, false);
    }

    function test_Deploy_RefusesEmptyAllocation() public {
        DeployMerkleVestedAirdrop.Config memory c = baseConfig;
        c.totalAllocated = 0;
        vm.expectRevert(DeployMerkleVestedAirdrop.EmptyTree.selector);
        script.deploy(c, false);
    }

    function test_Deploy_RefusesEmptyRecipientCount() public {
        DeployMerkleVestedAirdrop.Config memory c = baseConfig;
        c.recipientCount = 0;
        vm.expectRevert(DeployMerkleVestedAirdrop.EmptyTree.selector);
        script.deploy(c, false);
    }

    function test_Deploy_RefusesZeroToken() public {
        DeployMerkleVestedAirdrop.Config memory c = baseConfig;
        c.token = IERC20(address(0));
        vm.expectRevert(DeployMerkleVestedAirdrop.ZeroToken.selector);
        script.deploy(c, false);
    }

    /// @notice A mistyped token address is unrecoverable, so an address with no code is refused.
    function test_Deploy_RefusesTokenWithNoCode() public {
        DeployMerkleVestedAirdrop.Config memory c = baseConfig;
        c.token = IERC20(address(0xBEEF));
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMerkleVestedAirdrop.TokenNotAContract.selector, address(0xBEEF)
            )
        );
        script.deploy(c, false);
    }

    /// @notice A schedule that has already ended would make every allocation claimable at once.
    function test_Deploy_RefusesFinishedSchedule() public {
        DeployMerkleVestedAirdrop.Config memory c = baseConfig;
        c.end = uint64(block.timestamp) - 1;
        c.start = c.end - 365 days;
        c.cliff = c.start;
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMerkleVestedAirdrop.ScheduleAlreadyFinished.selector, c.end, block.timestamp
            )
        );
        script.deploy(c, false);
    }

    /// @notice The constructor's own schedule validation runs before the broadcast.
    /// @dev Same revert the contract would give, reached without spending gas on chain.
    function test_Deploy_RefusesSubMinimumDurationBeforeBroadcasting() public {
        DeployMerkleVestedAirdrop.Config memory c = baseConfig;
        c.cliff = start;
        c.end = start + 59 minutes;
        vm.expectRevert(VestingMath.InvalidSchedule.selector);
        script.deploy(c, false);
    }

    function test_Deploy_RefusesUnconfirmedMainnet() public {
        vm.chainId(677);
        vm.expectRevert(Deployment.MainnetNotConfirmed.selector);
        script.deploy(baseConfig, false);
    }

    /// @notice A missing generator artefact is named, not reported as a parse failure.
    function test_ConfigFrom_MissingArtefactReverts() public {
        string memory absent = "tooling/out/no-such-deploy-args.json";
        vm.expectRevert(
            abi.encodeWithSelector(DeployMerkleVestedAirdrop.MissingDeployArgs.selector, absent)
        );
        script.configFrom(absent);
    }

    function test_ConfigFrom_RejectsArtifactWithWrongSource() public {
        string memory path = "tooling/out/invalid-source-deploy-args.json";
        vm.expectRevert(
            abi.encodeWithSelector(DeployMerkleVestedAirdrop.InvalidArtifact.selector, "sourcePath")
        );
        script.configFrom(path);
    }
}

/// @notice The environment-reading layer, isolated in its own contract.
/// @dev Env vars are process-global. Every name touched here is written by exactly one
///      test in the whole suite, so nothing can race against it.
contract DeployConfigEnvTest is Test {
    DeployMerkleVestedAirdrop script;
    MockERC20 token;

    /// @dev Held as uint64 so the assertions below need no casts of their own.
    uint64 constant START = 1_700_000_000;

    function setUp() public {
        vm.warp(START);
        script = new DeployMerkleVestedAirdrop();
        token = new MockERC20();
    }

    /// @notice `config()` carries the artefact through unchanged and parses the env.
    function test_Config_CombinesArtefactAndEnvironment() public {
        vm.setEnv("AIRDROP_TOKEN", vm.toString(address(token)));
        vm.setEnv("AIRDROP_START", vm.toString(uint256(START)));
        vm.setEnv("AIRDROP_CLIFF", vm.toString(uint256(START) + 30 days));
        vm.setEnv("AIRDROP_END", vm.toString(uint256(START) + 365 days));
        vm.setEnv("ALLOW_EXAMPLE_RECIPIENTS", "1");

        DeployMerkleVestedAirdrop.Config memory c = script.config();

        string memory args = vm.readFile("tooling/out/deploy-args.json");
        assertEq(c.merkleRoot, vm.parseJsonBytes32(args, ".merkleRoot"), "root");
        assertEq(c.totalAllocated, vm.parseJsonUint(args, ".totalAllocated"), "total");
        assertEq(c.recipientCount, vm.parseJsonUint(args, ".recipientCount"), "recipients");
        assertEq(address(c.token), address(token), "token");
        assertEq(c.start, START, "start");
        assertEq(c.cliff, START + 30 days, "cliff");
        assertEq(c.end, START + 365 days, "end");
        assertTrue(c.allowExampleRecipients, "override flag");

        // A schedule value too large for uint64 is refused, never silently narrowed
        // into an immutable nobody asked for. Asserted in the same test so no other
        // test has to write AIRDROP_END.
        uint256 tooLarge = uint256(type(uint64).max) + 1;
        vm.setEnv("AIRDROP_END", vm.toString(tooLarge));
        vm.expectRevert(
            abi.encodeWithSelector(Deployment.ValueExceedsUint64.selector, "AIRDROP_END", tooLarge)
        );
        script.config();
    }
}
