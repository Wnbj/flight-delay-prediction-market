// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FlightMarket} from "../src/FlightMarket.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/**
 * Deploys the POC stack: mock stake token + market, then enables BOTH
 * expectedAuthor and expectedWorkflowName validation on the ReceiverTemplate
 * base. Name-only validation is insecure at 40-bit (bytes10) length, so the
 * base contract requires author validation to be configured too.
 *
 * Required env:
 *   DEPLOYER_PK      - private key of the deployer / market owner
 *   FORWARDER        - the contract that will call onReport() as msg.sender.
 *                       For `cre workflow simulate --broadcast` against Sepolia this is
 *                       the actual MockKeystoneForwarder contract, verified on Sourcify at
 *                       0x15fC6ae953E024d975e77382eEeC56A9101f9F88 (chain 11155111).
 *                       This is DIFFERENT from the "MOCK FORWARDER" address that
 *                       `cre workflow supported-chains` prints for ethereum-testnet-sepolia
 *                       (0xF8344CFd5c43616a4366C34E3EEE75af79a74482) — that one is not the
 *                       caller in the local --broadcast path and will make every onReport
 *                       revert with InvalidSender. Confirmed empirically: see RUNBOOK.md.
 *   WORKFLOW_NAME    - plaintext registered workflow name (hashed to bytes10 by the contract)
 *   WORKFLOW_AUTHOR  - address of the workflow's registered owner in CRE.
 *                       For local `simulate --broadcast` (no linked owner key — confirmed via
 *                       `cre account list-key` returning "No linked owners found"), the CLI
 *                       fills the metadata's workflowOwner with a fixed placeholder:
 *                       0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa. Use that here to match.
 *                       Swap for the real linked owner address once one exists.
 *
 * Run:
 *   forge script script/Deploy.s.sol:Deploy --rpc-url $SEPOLIA_RPC_URL --broadcast
 */
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address forwarder = vm.envAddress("FORWARDER");
        string memory workflowName = vm.envString("WORKFLOW_NAME");
        address workflowAuthor = vm.envAddress("WORKFLOW_AUTHOR");

        vm.startBroadcast(pk);
        MockUSDC token = new MockUSDC();
        FlightMarket market = new FlightMarket(IERC20(address(token)), forwarder);
        market.setExpectedAuthor(workflowAuthor);
        market.setExpectedWorkflowName(workflowName);
        vm.stopBroadcast();

        console2.log("TOKEN           ", address(token));
        console2.log("MARKET          ", address(market));
        console2.log("FORWARDER       ", forwarder);
        console2.log("OWNER           ", vm.addr(pk));
        console2.log("WORKFLOW_AUTHOR ", workflowAuthor);
        console2.logBytes10(market.getExpectedWorkflowName());
    }
}
