// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FlightMarket} from "../src/FlightMarket.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/**
 * Creates a market, stakes BOTH sides from two different EOAs, and fires
 * requestSettlement() — the log the CRE workflow triggers on.
 *
 * Both sides must be staked: a one-sided book makes `onReport` fall through to
 * Void regardless of the outcome the DON agrees on, which would mask a working
 * settlement path.
 *
 * settleAfter is set to `now`, so requestSettlement is callable in the same run
 * with no waiting. closeTime stays an hour out so the stakes land first.
 *
 * Required env:
 *   MARKET       - FlightMarket address from Deploy
 *   TOKEN        - MockUSDC address from Deploy
 *   YES_PK       - private key staking YES (needs Sepolia ETH for gas)
 *   NO_PK        - private key staking NO  (needs Sepolia ETH for gas)
 *   THRESHOLD    - delay threshold in minutes (30 => YES against a 42m mock delay)
 *
 * Run:
 *   forge script script/CreateAndStake.s.sol:CreateAndStake --rpc-url $SEPOLIA_RPC_URL --broadcast
 */
contract CreateAndStake is Script {
    uint256 constant YES_AMOUNT = 1e6;
    uint256 constant NO_AMOUNT = 3e6;

    function run() external {
        FlightMarket market = FlightMarket(vm.envAddress("MARKET"));
        MockUSDC token = MockUSDC(vm.envAddress("TOKEN"));
        uint256 yesPk = vm.envUint("YES_PK");
        uint256 noPk = vm.envUint("NO_PK");
        uint16 threshold = uint16(vm.envUint("THRESHOLD"));

        uint64 closeTime = uint64(block.timestamp + 1 hours);
        uint64 settleAfter = uint64(block.timestamp);

        // --- create + stake YES ---
        vm.startBroadcast(yesPk);
        uint256 marketId = market.newMarket(
            "Will AA100 arrive 30m+ late?", "AA100", 20240115, threshold, closeTime, settleAfter
        );
        token.mint(vm.addr(yesPk), YES_AMOUNT);
        token.approve(address(market), YES_AMOUNT);
        market.stake(marketId, true, YES_AMOUNT);
        vm.stopBroadcast();

        // --- stake NO from the second EOA ---
        vm.startBroadcast(noPk);
        token.mint(vm.addr(noPk), NO_AMOUNT);
        token.approve(address(market), NO_AMOUNT);
        market.stake(marketId, false, NO_AMOUNT);
        vm.stopBroadcast();

        // --- fire the trigger ---
        vm.startBroadcast(yesPk);
        market.requestSettlement(marketId);
        vm.stopBroadcast();

        console2.log("MARKET_ID    ", marketId);
        console2.log("THRESHOLD    ", threshold);
        console2.log("YES staker   ", vm.addr(yesPk));
        console2.log("NO  staker   ", vm.addr(noPk));
        console2.log("Take the requestSettlement tx hash from the broadcast log above.");
    }
}
