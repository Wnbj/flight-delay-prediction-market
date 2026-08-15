// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StockMarket} from "../src/StockMarket.sol";

/**
 * Deploys StockMarket against the existing MockUSDC and registers the Sepolia
 * feeds it is allowed to settle from.
 *
 * The registry is not a convenience. `newMarket` is permissionless, so if the
 * feed address came from the caller, anyone could point a real-looking market
 * at a contract of their own and hand themselves the settlement price. Only
 * the owner adds feeds; callers choose one by symbol.
 *
 * Feeds registered here, all verified live on Sepolia before being added:
 *   CSPX - iShares Core S&P 500 UCITS ETF, USD. The S&P 500 in one number.
 *          There is no single-stock feed on Sepolia; this is the closest
 *          honest thing to an equity market.
 *   XAU  - gold, USD. Hourly heartbeat rather than daily, so it exercises a
 *          much tighter staleness tolerance.
 *   IB01 - iShares $ Treasury Bond 0-1yr ETF, USD.
 *
 * Required env:
 *   TOKEN            - existing MockUSDC address
 *   DEPLOYER_PK      - private key of the deployer / market owner
 *   FORWARDER        - the contract that calls onReport() as msg.sender; on
 *                      Sepolia with `cre workflow simulate --broadcast` this is
 *                      0x15fC6ae953E024d975e77382eEeC56A9101f9F88, NOT what
 *                      `cre workflow supported-chains` prints. See RUNBOOK.md.
 *   WORKFLOW_NAME    - plaintext registered workflow name (hashed to bytes10)
 *   WORKFLOW_AUTHOR  - workflow owner address; the local simulate placeholder
 *                      is 0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa
 */
contract DeployStock is Script {
    address constant CSPX_FEED = 0x4b531A318B0e44B549F3b2f824721b3D0d51930A;
    address constant XAU_FEED = 0xC5981F461d74c46eB4b0CF3f4Ec79f025573B0Ea;
    address constant IB01_FEED = 0xB677bfBc9B09a3469695f40477d05bc9BcB15F50;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address token = vm.envAddress("TOKEN");
        address forwarder = vm.envAddress("FORWARDER");
        string memory workflowName = vm.envString("WORKFLOW_NAME");
        address workflowAuthor = vm.envAddress("WORKFLOW_AUTHOR");

        vm.startBroadcast(pk);
        StockMarket market = new StockMarket(IERC20(token), forwarder);
        market.setExpectedAuthor(workflowAuthor);
        market.setExpectedWorkflowName(workflowName);

        market.registerFeed("CSPX", CSPX_FEED);
        market.registerFeed("XAU", XAU_FEED);
        market.registerFeed("IB01", IB01_FEED);
        vm.stopBroadcast();

        console2.log("STOCK_MARKET    ", address(market));
        console2.log("TOKEN           ", token);
        console2.log("FORWARDER       ", forwarder);
        console2.log("WORKFLOW_AUTHOR ", workflowAuthor);
        console2.logBytes10(market.getExpectedWorkflowName());
    }
}
