// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FlightMarket} from "../src/FlightMarket.sol";

/**
 * Creates a single market and leaves it Open, so stakes can be placed through
 * the UI. CreateAndStake is no use for that: it fires requestSettlement in the
 * same run, which moves the market out of Open immediately.
 *
 * closeTime and settleAfter are both set ahead of now, so the market stays
 * stakeable and cannot be settled yet.
 *
 * Required env:
 *   MARKET      - FlightMarket address
 *   DEPLOYER_PK - key to create from
 *   THRESHOLD   - delay threshold in minutes
 *
 * Run:
 *   forge script script/CreateOpenMarket.s.sol:CreateOpenMarket \
 *     --rpc-url $SEPOLIA_RPC_URL --broadcast
 */
contract CreateOpenMarket is Script {
    function run() external {
        FlightMarket market = FlightMarket(vm.envAddress("MARKET"));
        uint256 pk = vm.envUint("DEPLOYER_PK");
        uint16 threshold = uint16(vm.envUint("THRESHOLD"));

        uint64 closeTime = uint64(block.timestamp + 2 days);
        uint64 settleAfter = uint64(block.timestamp + 3 days);

        vm.startBroadcast(pk);
        uint256 id = market.newMarket(
            "Will BA286 arrive 45m+ late?", "BA286", 20260820, threshold, closeTime, settleAfter
        );
        vm.stopBroadcast();

        console2.log("MARKET_ID ", id);
        console2.log("closeTime ", closeTime);
        console2.log("settleAfter", settleAfter);
    }
}
