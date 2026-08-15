// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CryptoMarket} from "../src/CryptoMarket.sol";

/**
 * Deploys CryptoMarket against the existing MockUSDC, so crypto and flight
 * markets share one stake token and one balance in the UI.
 *
 * Required env:
 *   TOKEN            - existing MockUSDC address
 *   DEPLOYER_PK      - private key of the deployer / market owner
 *   FORWARDER        - the contract that calls onReport() as msg.sender.
 *                       For `cre workflow simulate --broadcast` on Sepolia this
 *                       is 0x15fC6ae953E024d975e77382eEeC56A9101f9F88 — NOT the
 *                       address `cre workflow supported-chains` prints. See
 *                       RUNBOOK.md.
 *   WORKFLOW_NAME    - plaintext registered workflow name (hashed to bytes10)
 *   WORKFLOW_AUTHOR  - workflow owner address; for local simulate --broadcast
 *                       this is the placeholder
 *                       0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa
 *
 * Run:
 *   forge script script/DeployCrypto.s.sol:DeployCrypto \
 *     --rpc-url $SEPOLIA_RPC_URL --broadcast
 */
contract DeployCrypto is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address token = vm.envAddress("TOKEN");
        address forwarder = vm.envAddress("FORWARDER");
        string memory workflowName = vm.envString("WORKFLOW_NAME");
        address workflowAuthor = vm.envAddress("WORKFLOW_AUTHOR");

        vm.startBroadcast(pk);
        CryptoMarket market = new CryptoMarket(IERC20(token), forwarder);
        market.setExpectedAuthor(workflowAuthor);
        market.setExpectedWorkflowName(workflowName);
        vm.stopBroadcast();

        console2.log("CRYPTO_MARKET   ", address(market));
        console2.log("TOKEN           ", token);
        console2.log("FORWARDER       ", forwarder);
        console2.log("WORKFLOW_AUTHOR ", workflowAuthor);
        console2.logBytes10(market.getExpectedWorkflowName());
    }
}
