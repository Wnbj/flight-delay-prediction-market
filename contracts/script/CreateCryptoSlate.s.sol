// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CryptoMarket} from "../src/CryptoMarket.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/**
 * Creates the standing crypto slate: BTC and ETH, each at 5 minutes, 15
 * minutes and 1 hour, all sharing one strike per asset and one close time.
 *
 * This is the product slate, not the settlement test — CreateCryptoMarkets.s.sol
 * is the one that deliberately strikes far either side of spot to force a known
 * Yes and a known No. Here the strikes are set just off spot so the questions
 * are genuinely open, and the same strike is reused across all three horizons
 * so the implied odds fan out with time rather than with the level.
 *
 * Staking closes for every market at the same moment, some way before the
 * shortest expiry. That is the point of a separate closeTime: with staking open
 * right up to expiry, anyone could stake a second before the price is read and
 * take the pot off people who committed early.
 *
 * Required env:
 *   CRYPTO_MARKET - CryptoMarket address
 *   TOKEN         - MockUSDC address
 *   YES_PK, NO_PK - the two staking keys
 *   BTC_STRIKE    - whole dollars, near spot
 *   ETH_STRIKE    - whole dollars, near spot
 * Optional:
 *   STAKE_WINDOW  - seconds of open staking before every market closes
 *                   (default 420)
 *
 * Keep STAKE_WINDOW well clear of how long this script takes to land.
 * `block.timestamp` is read once during forge's simulation pass, but the
 * twenty-odd transactions below broadcast one per block — around four and a
 * half minutes on a 12-second chain. Too tight a window and the later stakes
 * revert with TooLate, leaving empty markets that can only void.
 */
contract CreateCryptoSlate is Script {
    uint256 constant STAKE_AMOUNT = 1e6; // 1 MockUSDC per side per market

    uint64 constant PRICE_SCALE = 1e8; // 8 decimals, Chainlink feed convention

    struct Horizon {
        uint64 seconds_;
        string label;
    }

    /// `vm.toString` gives "63000", which reads badly next to the "$63,000.00"
    /// the UI formats from the same strike. The question is the most prominent
    /// text on a card, so group the thousands.
    function _dollars(uint64 amount) internal pure returns (string memory out) {
        bytes memory digits = bytes(vm.toString(uint256(amount)));
        for (uint256 i = 0; i < digits.length; i++) {
            uint256 remaining = digits.length - i;
            if (i > 0 && remaining % 3 == 0) out = string.concat(out, ",");
            out = string.concat(out, string(abi.encodePacked(digits[i])));
        }
    }

    function run() external {
        CryptoMarket market = CryptoMarket(vm.envAddress("CRYPTO_MARKET"));
        MockUSDC token = MockUSDC(vm.envAddress("TOKEN"));
        uint256 yesPk = vm.envUint("YES_PK");
        uint256 noPk = vm.envUint("NO_PK");
        uint64 btcDollars = uint64(vm.envUint("BTC_STRIKE"));
        uint64 ethDollars = uint64(vm.envUint("ETH_STRIKE"));

        uint64 closeTime = uint64(block.timestamp + vm.envOr("STAKE_WINDOW", uint256(420)));

        Horizon[3] memory horizons =
            [Horizon(5 minutes, "5 minutes"), Horizon(15 minutes, "15 minutes"), Horizon(1 hours, "1 hour")];

        uint256[6] memory ids;
        uint256 n;

        vm.startBroadcast(yesPk);
        token.mint(vm.addr(yesPk), STAKE_AMOUNT * 6);
        token.approve(address(market), STAKE_AMOUNT * 6);

        for (uint256 a = 0; a < 2; a++) {
            CryptoMarket.Asset asset = a == 0 ? CryptoMarket.Asset.BTC : CryptoMarket.Asset.ETH;
            string memory symbol = a == 0 ? "BTC" : "ETH";
            uint64 dollars = a == 0 ? btcDollars : ethDollars;

            for (uint256 h = 0; h < horizons.length; h++) {
                uint256 id = market.newMarket(
                    string.concat(
                        "Will ", symbol, " be at or above $", _dollars(dollars), " in ", horizons[h].label, "?"
                    ),
                    asset,
                    dollars * PRICE_SCALE,
                    closeTime,
                    closeTime + horizons[h].seconds_
                );
                market.stake(id, true, STAKE_AMOUNT);
                ids[n++] = id;
            }
        }
        vm.stopBroadcast();

        // Both sides must be backed or the market voids on settlement no matter
        // what the price does, which would make the whole slate pointless.
        vm.startBroadcast(noPk);
        token.mint(vm.addr(noPk), STAKE_AMOUNT * 6);
        token.approve(address(market), STAKE_AMOUNT * 6);
        for (uint256 i = 0; i < ids.length; i++) {
            market.stake(ids[i], false, STAKE_AMOUNT);
        }
        vm.stopBroadcast();

        console2.log("CLOSE_TIME", closeTime);
        for (uint256 i = 0; i < ids.length; i++) {
            (,, uint64 settleAfter,,,,,,) = market.core(ids[i]);
            console2.log("market", ids[i], "settleable at", settleAfter);
        }
    }
}
