// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReserveMarket} from "../src/ReserveMarket.sol";

/**
 * Deploys ReserveMarket against the existing MockUSDC and registers the
 * Sepolia reserve and NAV feeds it may settle from.
 *
 * A separate contract from StockMarket rather than a flag on it, because the
 * difference is a settlement rule, not a parameter: StockMarket voids unless
 * the feed's answer changed between close and expiry, which is right for an
 * equity and wrong for a reserve that can legitimately sit still for a day.
 * ReserveMarket does not even emit closeTime, so that check cannot be applied
 * here by accident.
 *
 * Feeds registered here, all verified live on Sepolia:
 *   STETH - stETH Proof of Reserves, 18 decimals. The raw answer does not fit
 *           in a uint64; the workflow rescales using the feed's decimals().
 *   USDW  - USDW Reserves, 6 decimals.
 *   USTB  - USTB NAV per Share, 6 decimals.
 *
 * Required env: TOKEN, DEPLOYER_PK, FORWARDER, WORKFLOW_NAME, WORKFLOW_AUTHOR
 * — see DeployStock.s.sol for what each one has to be and why.
 */
contract DeployReserve is Script {
    address constant STETH_POR = 0x8328e01902A47942Eecb9DBF97d6bF9dd3bd07E6;
    address constant USDW_RESERVES = 0x92B42669e6B34f54dd445EF23552C61A68bda0F1;
    address constant USTB_NAV = 0x732d3C7515356eAB22E3F3DcA183c5c65102d518;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address token = vm.envAddress("TOKEN");
        address forwarder = vm.envAddress("FORWARDER");
        string memory workflowName = vm.envString("WORKFLOW_NAME");
        address workflowAuthor = vm.envAddress("WORKFLOW_AUTHOR");

        vm.startBroadcast(pk);
        ReserveMarket market = new ReserveMarket(IERC20(token), forwarder);
        market.setExpectedAuthor(workflowAuthor);
        market.setExpectedWorkflowName(workflowName);

        market.registerFeed("STETH", STETH_POR);
        market.registerFeed("USDW", USDW_RESERVES);
        market.registerFeed("USTB", USTB_NAV);
        vm.stopBroadcast();

        console2.log("RESERVE_MARKET  ", address(market));
        console2.log("TOKEN           ", token);
        console2.log("FORWARDER       ", forwarder);
        console2.logBytes10(market.getExpectedWorkflowName());
    }
}
