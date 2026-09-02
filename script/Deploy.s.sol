// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PaymentStream} from "../src/PaymentStream.sol";
import {MerkleVestedAirdrop} from "../src/MerkleVestedAirdrop.sol";
import {VestingMath} from "../src/libraries/VestingMath.sol";

/// @title Deployment
/// @notice Shared chain guards, env parsing and deployment recording.
/// @dev Neither contract has an owner, a pause or an upgrade path, so a deployment is
///      the last moment anything can be corrected. Every check that CAN run before the
///      broadcast does run before it: a revert in a constructor on a live chain costs
///      real gas and reports an opaque failure, while the same revert here costs
///      nothing and names the parameter.
///
///      SHAPE. Each script separates `run()`, which reads the environment, from
///      `deploy(...)`, which takes every input explicitly and holds all the logic.
///      Environment variables are process-global and shared across concurrently
///      running test contracts, so a suite that configured itself by mutating them
///      would race against itself. Explicit parameters also let one script compose
///      another without going through the shell.
abstract contract Deployment is Script {
    /// @dev BOT Chain. Testnet is the default target; mainnet requires an explicit ack.
    uint256 internal constant BOT_TESTNET = 968;
    uint256 internal constant BOT_MAINNET = 677;

    /// @notice Mainnet deploy attempted without CONFIRM_MAINNET=1.
    error MainnetNotConfirmed();
    /// @notice Deployment was attempted on a chain that is not an explicitly supported target.
    error UnknownChain(uint256 chainId);
    /// @notice An env value that must fit uint64 did not.
    error ValueExceedsUint64(string name, uint256 value);

    /// @dev Refuses a mainnet deploy that was not explicitly asked for. Deploying to
    ///      677 when you meant 968 produces an immutable contract on the wrong chain
    ///      that no key can retire.
    function _guardChain(bool mainnetConfirmed) internal view {
        console2.log("chain id           ", block.chainid);
        if (block.chainid == BOT_MAINNET && !mainnetConfirmed) revert MainnetNotConfirmed();
        if (block.chainid != BOT_MAINNET && block.chainid != BOT_TESTNET) {
            revert UnknownChain(block.chainid);
        }
    }

    /// @dev CONFIRM_MAINNET=1 is the operator's acknowledgement that chain 677 is meant.
    function _mainnetConfirmed() internal view returns (bool) {
        return vm.envOr("CONFIRM_MAINNET", uint256(0)) == 1;
    }

    /// @dev Reads an env var that the contracts store as uint64. `envUint` returns
    ///      uint256, and a silent narrowing here would write a schedule nobody asked
    ///      for into an immutable.
    function _envUint64(string memory name) internal view returns (uint64) {
        uint256 value = vm.envUint(name);
        if (value > type(uint64).max) revert ValueExceedsUint64(name, value);
        // Bound proven directly above.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(value);
    }

    /// @dev Serialises the fields every deployment record carries and returns the
    ///      object key, so each script can append its own before writing.
    function _openRecord(address deployed) internal returns (string memory key) {
        key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "address", deployed);
        vm.serializeAddress(key, "deployer", msg.sender);
        // A LOWER BOUND on the deployment block, not the block the transaction landed
        // in: this runs during simulation, one block ahead of which the deploy is
        // mined. "My streams" anchors its paginated log scan here (RESEARCH.txt 9.4),
        // and a lower bound is the safe direction to be wrong in. The exact receipt is
        // in broadcast/ if it is ever needed.
        vm.serializeUint(key, "fromBlock", block.number);
        vm.serializeUint(key, "timestamp", block.timestamp);
    }

    /// @dev Writes `deployments/<chainId>-<name>.json`, one file per contract per
    ///      chain so a second deployment never has to merge into the first.
    ///
    ///      Only under `--broadcast`. A dry run and a test both leave the tree clean,
    ///      which is why the tests can exercise these scripts directly rather than a
    ///      stripped-down copy of them.
    function _writeRecord(string memory name, string memory json) internal {
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            console2.log("record              skipped, not a broadcast");
            return;
        }
        vm.createDir("deployments", true);
        string memory path =
            string.concat("deployments/", vm.toString(block.chainid), "-", name, ".json");
        vm.writeJson(json, path);
        console2.log("record             ", path);
    }
}

/// @notice Deploys PaymentStream.
/// @dev Takes no arguments and depends on nothing off-chain. This is the piece that
///      can ship the moment an RPC endpoint and a funded key exist.
///
///      forge script script/Deploy.s.sol:DeployPaymentStream \
///          --rpc-url $BOT_RPC_URL --account deployer --broadcast --verify
contract DeployPaymentStream is Deployment {
    /// @notice A freshly deployed stream contract did not read back as empty.
    error UnexpectedInitialState();

    function run() external returns (PaymentStream) {
        return deploy(_mainnetConfirmed());
    }

    function deploy(bool mainnetConfirmed) public returns (PaymentStream stream) {
        _guardChain(mainnetConfirmed);

        vm.startBroadcast();
        stream = new PaymentStream();
        vm.stopBroadcast();

        // Readback. Cheap, and it proves the address holds the code we think it does
        // rather than a reverted-but-recorded deployment.
        if (stream.nextStreamId() != 0) revert UnexpectedInitialState();

        console2.log("PaymentStream      ", address(stream));

        string memory key = _openRecord(address(stream));
        _writeRecord("PaymentStream", vm.serializeString(key, "contract", "PaymentStream"));
    }
}

/// @notice Deploys MerkleVestedAirdrop from the generator's artefacts.
/// @dev The root and the total are read from tooling/out/deploy-args.json, which
///      build-tree.mjs derives from a single pass over recipients.csv. They are never
///      passed by hand: a totalAllocated that disagrees with the tree turns
///      `activate()` from a solvency guarantee into a false signal, which is exactly
///      the failure the two-step funding design exists to prevent.
///
///      Schedule and token come from the environment, because they are a policy
///      choice rather than a property of the tree.
///
///      AIRDROP_TOKEN=0x...  AIRDROP_START=<unix>  AIRDROP_CLIFF=<unix>  AIRDROP_END=<unix> \
///      forge script script/Deploy.s.sol:DeployMerkleVestedAirdrop \
///          --rpc-url $BOT_RPC_URL --account deployer --broadcast --verify
contract DeployMerkleVestedAirdrop is Deployment {
    string internal constant ARGS_PATH = "tooling/out/deploy-args.json";
    string internal constant RECIPIENTS_PATH = "tooling/recipients.csv";

    /// @dev Root of the worked example in tooling/recipients.csv, whose four
    ///      recipients are placeholders (0x..A1 through 0x..D4). Committing it to a
    ///      real chain would create a permanently funded contract that no real address
    ///      can ever claim from and no owner can ever unwind.
    bytes32 internal constant EXAMPLE_ROOT =
        0x5eab0066553558831972ebb8d68adc8f95f314c42838b9ea229d92fdbdcc19c1;

    struct Config {
        IERC20 token;
        bytes32 merkleRoot;
        uint256 totalAllocated;
        uint256 recipientCount;
        uint64 start;
        uint64 cliff;
        uint64 end;
        bool allowExampleRecipients;
    }

    /// @notice tooling/out/deploy-args.json is absent. Run build-tree.mjs first.
    error MissingDeployArgs(string path);
    /// @notice The artefact carries an empty root, total or recipient count.
    error EmptyTree();
    /// @notice The tree is the placeholder example. Set ALLOW_EXAMPLE_RECIPIENTS=1 to override.
    error ExampleRecipientList();
    /// @notice AIRDROP_TOKEN is the zero address.
    error ZeroToken();
    /// @notice AIRDROP_TOKEN has no code on this chain.
    error TokenNotAContract(address token);
    /// @notice The schedule has already finished, so every allocation would be claimable at once.
    error ScheduleAlreadyFinished(uint64 end, uint256 nowTs);
    /// @notice A deployed immutable did not read back as the value it was given.
    error DeployedStateMismatch();
    error InvalidArtifact(string field);

    function run() external returns (MerkleVestedAirdrop) {
        return deploy(config(), _mainnetConfirmed());
    }

    function deploy(Config memory c, bool mainnetConfirmed)
        public
        returns (MerkleVestedAirdrop drop)
    {
        _guardChain(mainnetConfirmed);
        _preflight(c);

        vm.startBroadcast();
        drop = new MerkleVestedAirdrop(
            c.token, c.merkleRoot, c.totalAllocated, c.start, c.cliff, c.end
        );
        vm.stopBroadcast();

        _verifyDeployed(drop, c);
        console2.log("MerkleVestedAirdrop", address(drop));

        _report(drop, c);

        string memory key = _openRecord(address(drop));
        vm.serializeString(key, "contract", "MerkleVestedAirdrop");
        vm.serializeAddress(key, "token", address(c.token));
        vm.serializeBytes32(key, "merkleRoot", c.merkleRoot);
        vm.serializeString(key, "totalAllocated", vm.toString(c.totalAllocated));
        vm.serializeUint(key, "recipientCount", c.recipientCount);
        vm.serializeUint(key, "start", c.start);
        vm.serializeUint(key, "cliff", c.cliff);
        _writeRecord("MerkleVestedAirdrop", vm.serializeUint(key, "end", c.end));
    }

    /// @notice Tree parameters from the generator's artefact, schedule and token from
    ///         the environment.
    /// @dev Public so an operator can dry-run exactly what `run()` would deploy, and
    ///      so the artefact-reading path is exercised on its own.
    function config() public view returns (Config memory) {
        return configFrom(ARGS_PATH);
    }

    /// @notice `config()` against an artefact path, with integrity checked against the
    ///         checked-in recipient source.
    /// @dev The source path is intentionally fixed to the checked-in CSV. JSON is not
    ///      treated as an independently trusted commitment: the recorded hash only
    ///      binds it to the source file available to this deployment environment.
    function configFrom(string memory argsPath) public view returns (Config memory c) {
        if (!vm.exists(argsPath)) revert MissingDeployArgs(argsPath);
        string memory json = vm.readFile(argsPath);

        string memory sourcePath = vm.parseJsonString(json, ".sourcePath");
        if (keccak256(bytes(sourcePath)) != keccak256(bytes(RECIPIENTS_PATH))) {
            revert InvalidArtifact("sourcePath");
        }

        c.merkleRoot = vm.parseJsonBytes32(json, ".merkleRoot");
        c.totalAllocated = vm.parseJsonUint(json, ".totalAllocated");
        c.recipientCount = vm.parseJsonUint(json, ".recipientCount");
        if (c.merkleRoot == bytes32(0) || c.totalAllocated == 0 || c.recipientCount == 0) {
            revert InvalidArtifact("empty tree metadata");
        }
        if (c.recipientCount > type(uint64).max) revert InvalidArtifact("recipientCount");
        string[] memory leafTypes = vm.parseJsonStringArray(json, ".leafTypes");
        if (
            leafTypes.length != 3 || keccak256(bytes(leafTypes[0])) != keccak256(bytes("uint256"))
                || keccak256(bytes(leafTypes[1])) != keccak256(bytes("address"))
                || keccak256(bytes(leafTypes[2])) != keccak256(bytes("uint128"))
        ) revert InvalidArtifact("leafTypes");
        if (vm.parseJsonBytes32(json, ".sourceHash") != keccak256(vm.readFileBinary(RECIPIENTS_PATH))) {
            revert InvalidArtifact("sourceHash");
        }

        c.token = IERC20(vm.envAddress("AIRDROP_TOKEN"));
        c.start = _envUint64("AIRDROP_START");
        c.cliff = _envUint64("AIRDROP_CLIFF");
        c.end = _envUint64("AIRDROP_END");
        c.allowExampleRecipients = vm.envOr("ALLOW_EXAMPLE_RECIPIENTS", uint256(0)) == 1;
    }

    /// @dev Every constructor revert, plus the ones a constructor cannot see, run
    ///      before a single wei of gas is spent.
    function _preflight(Config memory c) internal view {
        console2.log("merkle root        ", vm.toString(c.merkleRoot));
        console2.log("total allocated    ", c.totalAllocated);
        console2.log("recipients         ", c.recipientCount);
        console2.log("token              ", address(c.token));
        console2.log("start / cliff / end", c.start, c.cliff, c.end);

        if (c.merkleRoot == bytes32(0) || c.totalAllocated == 0 || c.recipientCount == 0) {
            revert EmptyTree();
        }
        if (c.merkleRoot == EXAMPLE_ROOT && !c.allowExampleRecipients) revert ExampleRecipientList();
        if (address(c.token) == address(0)) revert ZeroToken();
        // A mistyped token address is unrecoverable: `token` is immutable and there is
        // no sweep. Code at the address is a weak check but it catches a typo.
        if (address(c.token).code.length == 0) revert TokenNotAContract(address(c.token));

        // Same call the constructor makes, so a bad schedule fails here instead.
        VestingMath.validateSchedule(c.start, c.cliff, c.end);
        // Off-chain sanity check on an operator-supplied date, not an on-chain
        // authorisation. A validator nudging the timestamp by seconds cannot make a
        // finished schedule look live.
        // forge-lint: disable-next-line(block-timestamp)
        if (c.end <= block.timestamp) revert ScheduleAlreadyFinished(c.end, block.timestamp);
    }

    /// @dev Reads the immutables back off the deployed contract. It cannot undo a bad
    ///      deployment, but it stops a wrong one from being recorded, announced and
    ///      then funded, which is the point at which the mistake becomes permanent.
    function _verifyDeployed(MerkleVestedAirdrop drop, Config memory c) internal view {
        if (
            address(drop.token()) != address(c.token) || drop.merkleRoot() != c.merkleRoot
                || drop.totalAllocated() != c.totalAllocated || drop.start() != c.start
                || drop.cliff() != c.cliff || drop.end() != c.end || drop.funded()
        ) revert DeployedStateMismatch();
    }

    /// @dev The contract is deployed but inert until it is funded and armed. Say so,
    ///      with the exact figure, because underfunding is silent until the last
    ///      claimant reverts.
    function _report(MerkleVestedAirdrop drop, Config memory c) internal view {
        console2.log("");
        console2.log("Deployed, NOT yet claimable. Two steps remain:");
        console2.log("  1. transfer          ", c.totalAllocated);
        console2.log("     of token          ", address(c.token));
        console2.log("     to                ", address(drop));
        console2.log("  2. cast send <addr> \"activate()\"   (permissionless)");

        uint256 held = c.token.balanceOf(msg.sender);
        if (held < c.totalAllocated) {
            console2.log("warning             deployer holds less than the allocation:", held);
        }
    }
}
