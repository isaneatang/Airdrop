// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Plain, well-behaved ERC20.
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Burns `feeBps` of every non-mint, non-burn transfer. Models USDT-style
///      fee-on-transfer and any deflationary token.
contract FeeOnTransferToken is ERC20 {
    uint256 public feeBps;
    address public constant FEE_SINK = address(0xFEE);

    constructor(uint256 feeBps_) ERC20("Fee", "FEE") {
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFeeBps(uint256 feeBps_) external {
        feeBps = feeBps_;
    }

    function _update(address from, address to, uint256 value) internal override {
        uint256 fee = (from == address(0) || to == address(0)) ? 0 : (value * feeBps) / 10_000;
        if (fee != 0) super._update(from, FEE_SINK, fee);
        super._update(from, to, value - fee);
    }
}

/// @dev ERC-777-style transfer hook. Re-enters `target` with `payload` on the way out
///      of a transfer, bubbling the inner revert so a blocked reentrancy is visible to
///      the caller.
contract ReentrantToken is ERC20 {
    address public target;
    bytes public payload;
    bool private _entered;

    constructor() ERC20("Reentrant", "RE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (target == address(0) || _entered || to == address(0)) return;

        _entered = true;
        (bool ok, bytes memory ret) = target.call(payload);
        _entered = false;

        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}

/// @dev Returns megabytes of returndata from `transfer`. Models the return-bomb
///      griefing vector: a caller that copies unbounded returndata into memory pays
///      quadratic gas and can be made to run out.
contract ReturnBombToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address, uint256) external pure returns (bool) {
        return true;
    }

    /// @dev No `return true` follows `_bomb()`: the assembly `return` ends execution,
    ///      so a trailing statement would be unreachable. `_bomb` writes the ABI-encoded
    ///      `true` itself before padding.
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        _bomb();
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        _bomb();
    }

    /// @dev Returns `abi.encode(true)` followed by 64KB of padding. A caller that
    ///      copies returndata unbounded pays quadratic memory-expansion gas on it.
    function _bomb() private pure {
        assembly {
            mstore(0x00, 1)
            return(0x00, 0x10000)
        }
    }
}

/// @dev Credits the receiver MORE than was sent. Models an inflationary/positive-rebase
///      token, which a fixed-schedule contract cannot account for.
contract InflatingToken is ERC20 {
    constructor() ERC20("Inflating", "INF") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from != address(0) && to != address(0)) _mint(to, value / 10);
    }
}
