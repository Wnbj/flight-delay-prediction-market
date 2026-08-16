// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AmmMarket} from "../src/AmmMarket.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/**
 * Creates a strike ladder: one question at one expiry, across several strikes.
 *
 * There is no ladder type on chain and there does not need to be — a ladder is
 * N markets sharing an asset and an expiry, differing only in strike. The UI
 * derives the grouping from exactly that, so this script creates ordinary
 * markets and they group themselves.
 *
 * On the AMM rather than a parimutuel contract on purpose: every rung needs a
 * price for the ladder to say anything, and an AMM quotes one from the moment
 * it opens. Parimutuel rungs read "no odds yet" until somebody stakes, which
 * makes a ladder of five of them a column of blanks.
 *
 * Note that each rung still OPENS at even money, because seeding mints equal
 * reserves and the maker takes no view. A fresh ladder therefore reads 50%
 * five times over; it only takes shape once traded.
 *
 * Required env:
 *   AMM_MARKET, TOKEN, DEPLOYER_PK
 *   STRIKE_LOW, STRIKE_STEP - whole dollars
 *   RUNGS                   - how many strikes
 * Optional:
 *   CLOSE_IN, EXPIRY_IN     - seconds from now (default 7200 / 9000)
 *   LIQUIDITY               - per rung, 6-decimal token units (default 40e6)
 */
contract CreateLadder is Script {
    function run() external {
        AmmMarket amm = AmmMarket(vm.envAddress("AMM_MARKET"));
        MockUSDC token = MockUSDC(vm.envAddress("TOKEN"));
        uint256 pk = vm.envUint("DEPLOYER_PK");

        uint64 low = uint64(vm.envUint("STRIKE_LOW"));
        uint64 step = uint64(vm.envUint("STRIKE_STEP"));
        uint256 rungs = vm.envUint("RUNGS");
        uint256 liquidity = vm.envOr("LIQUIDITY", uint256(40e6));

        uint64 closeTime = uint64(block.timestamp + vm.envOr("CLOSE_IN", uint256(7200)));
        uint64 expiryTime = uint64(block.timestamp + vm.envOr("EXPIRY_IN", uint256(9000)));

        vm.startBroadcast(pk);
        token.approve(address(amm), liquidity * rungs);
        for (uint256 i = 0; i < rungs; i++) {
            uint64 strike = low + uint64(i) * step;
            uint256 id = amm.newMarket(
                string.concat("Will BTC be at or above $", vm.toString(strike), " at expiry?"),
                AmmMarket.Asset.BTC,
                strike * 1e8,
                closeTime,
                expiryTime,
                liquidity
            );
            console2.log("rung", id, "strike", strike);
        }
        vm.stopBroadcast();

        console2.log("CLOSE_TIME ", closeTime);
        console2.log("EXPIRY_TIME", expiryTime);
    }
}
