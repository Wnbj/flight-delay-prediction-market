// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AmmMarket} from "../src/AmmMarket.sol";

/**
 * Deploys AmmMarket against the existing MockUSDC.
 *
 * Its SettlementRequested event is byte-identical to CryptoMarket's, so no new
 * workflow handler is needed — this address is simply added to that trigger's
 * address list, and the same settlement code serves both pricing models.
 *
 * Required env: TOKEN, DEPLOYER_PK, FORWARDER, WORKFLOW_NAME, WORKFLOW_AUTHOR
 * — see DeployStock.s.sol for what each must be and why.
 */
contract DeployAmm is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address token = vm.envAddress("TOKEN");
        address forwarder = vm.envAddress("FORWARDER");
        string memory workflowName = vm.envString("WORKFLOW_NAME");
        address workflowAuthor = vm.envAddress("WORKFLOW_AUTHOR");

        vm.startBroadcast(pk);
        AmmMarket market = new AmmMarket(IERC20(token), forwarder);
        market.setExpectedAuthor(workflowAuthor);
        market.setExpectedWorkflowName(workflowName);
        vm.stopBroadcast();

        console2.log("AMM_MARKET      ", address(market));
        console2.logBytes10(market.getExpectedWorkflowName());
    }
}
