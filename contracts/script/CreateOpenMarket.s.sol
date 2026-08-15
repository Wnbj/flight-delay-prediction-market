// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FlightMarket} from "../src/FlightMarket.sol";

/**
 * Creates a single market and leaves it Open, so stakes can be placed through
 * the UI. CreateAndStake is no use for that: it fires requestSettlement in the
 * same run, which moves the market out of Open immediately.
 *
 * The two windows are independent — the contract never requires settleAfter to
 * follow closeTime — so a market can be open for staking and settleable at the
 * same time. That is what you want for a POC: SETTLE_IN=0 lets the whole
 * stake → settle → claim loop run in one sitting instead of waiting out a
 * timer that serves no purpose here.
 *
 * Required env:
 *   MARKET      - FlightMarket address
 *   DEPLOYER_PK - key to create from
 *   THRESHOLD   - delay threshold in minutes
 * Optional env:
 *   CLOSE_IN    - seconds until staking closes (default 1800)
 *   SETTLE_IN   - seconds until settlement is allowed (default 0)
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

        uint64 closeTime = uint64(block.timestamp + vm.envOr("CLOSE_IN", uint256(1800)));
        uint64 settleAfter = uint64(block.timestamp + vm.envOr("SETTLE_IN", uint256(0)));

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
