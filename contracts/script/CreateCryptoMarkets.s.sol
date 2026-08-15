// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CryptoMarket} from "../src/CryptoMarket.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/**
 * Creates two BTC markets with the same expiry — one struck well below spot,
 * one well above — and stakes both sides of each. Settling them together
 * exercises the Yes and No paths against live venue data in a single wait.
 *
 * Both sides must be staked: a one-sided book voids regardless of the price,
 * which would mask whether the price logic worked at all.
 *
 * Required env:
 *   CRYPTO_MARKET - CryptoMarket address
 *   TOKEN         - MockUSDC address
 *   YES_PK, NO_PK - the two staking keys
 *   LOW_STRIKE    - strike below spot, 8 decimals (expect Yes)
 *   HIGH_STRIKE   - strike above spot, 8 decimals (expect No)
 * Optional:
 *   EXPIRY_IN     - seconds until expiry (default 300)
 *
 * Keep EXPIRY_IN generous. `block.timestamp` here is read during forge's
 * simulation pass, but the ten transactions below are then broadcast one per
 * block — roughly two minutes on a 12-second chain. Too short a window and the
 * stakes land after closeTime and revert with TooLate, leaving empty markets
 * that can only void.
 */
contract CreateCryptoMarkets is Script {
    uint256 constant YES_AMOUNT = 1e6;
    uint256 constant NO_AMOUNT = 1e6;

    function run() external {
        CryptoMarket market = CryptoMarket(vm.envAddress("CRYPTO_MARKET"));
        MockUSDC token = MockUSDC(vm.envAddress("TOKEN"));
        uint256 yesPk = vm.envUint("YES_PK");
        uint256 noPk = vm.envUint("NO_PK");
        uint64 lowStrike = uint64(vm.envUint("LOW_STRIKE"));
        uint64 highStrike = uint64(vm.envUint("HIGH_STRIKE"));

        uint64 expiry = uint64(block.timestamp + vm.envOr("EXPIRY_IN", uint256(300)));

        vm.startBroadcast(yesPk);
        uint256 lowId = market.newMarket(
            "Will BTC be at or above the low strike?", CryptoMarket.Asset.BTC, lowStrike, expiry, expiry
        );
        uint256 highId = market.newMarket(
            "Will BTC be at or above the high strike?", CryptoMarket.Asset.BTC, highStrike, expiry, expiry
        );
        token.mint(vm.addr(yesPk), YES_AMOUNT * 2);
        token.approve(address(market), YES_AMOUNT * 2);
        market.stake(lowId, true, YES_AMOUNT);
        market.stake(highId, true, YES_AMOUNT);
        vm.stopBroadcast();

        vm.startBroadcast(noPk);
        token.mint(vm.addr(noPk), NO_AMOUNT * 2);
        token.approve(address(market), NO_AMOUNT * 2);
        market.stake(lowId, false, NO_AMOUNT);
        market.stake(highId, false, NO_AMOUNT);
        vm.stopBroadcast();

        console2.log("LOW_STRIKE_MARKET ", lowId);
        console2.log("HIGH_STRIKE_MARKET", highId);
        console2.log("EXPIRY            ", expiry);
        console2.log("SETTLEABLE_AT     ", expiry + market.SETTLEMENT_DELAY());
    }
}
