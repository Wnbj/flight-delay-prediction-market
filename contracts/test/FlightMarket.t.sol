// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {FlightMarket} from "../src/FlightMarket.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ReceiverTemplate} from "../src/interfaces/ReceiverTemplate.sol";

contract FlightMarketTest is Test {
    FlightMarket internal market;
    MockUSDC internal token;

    address internal forwarder = address(0xF0);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    string internal constant WF_NAME_STR = "flight-settlement-staging";
    address internal wfAuthor;      // = address(this), the deployer/owner
    bytes10 internal wfName;        // derived by ReceiverTemplate from WF_NAME_STR

    uint64 internal closeTime;
    uint64 internal settleAfter;

    // Mirrors of the contract's events, for expectEmit.
    event SettlementRequested(
        uint256 indexed marketId, string flightIata, uint32 departureDate, uint16 thresholdMinutes
    );
    event Settled(uint256 indexed marketId, FlightMarket.Outcome outcome, int32 observedDelay, bytes32 evidenceHash);

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new MockUSDC();
        market = new FlightMarket(IERC20(address(token)), forwarder);

        wfAuthor = address(this);
        market.setExpectedAuthor(wfAuthor);
        market.setExpectedWorkflowName(WF_NAME_STR);
        wfName = market.getExpectedWorkflowName();

        closeTime = uint64(block.timestamp + 1 days);
        settleAfter = uint64(block.timestamp + 2 days);

        token.mint(alice, 1_000e6);
        token.mint(bob, 1_000e6);

        vm.prank(alice);
        token.approve(address(market), type(uint256).max);
        vm.prank(bob);
        token.approve(address(market), type(uint256).max);
    }

    // --- helpers ------------------------------------------------------------

    function _newMarket() internal returns (uint256 id) {
        id = market.newMarket("Will AA100 be >=60m late?", "AA100", 20240115, 60, closeTime, settleAfter);
    }

    /// @dev Matches ReceiverTemplate._decodeMetadata: packed(workflowId, workflowName, workflowOwner).
    ///      workflowId is left zero since expectedWorkflowId is never configured in these tests.
    function _metadata(bytes10 name, address authorAddr) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes32(0), name, authorAddr);
    }

    function _validMetadata() internal view returns (bytes memory) {
        return _metadata(wfName, wfAuthor);
    }

    function _report(uint256 id, uint8 outcome, int32 delay, bytes32 evidence)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(id, outcome, delay, evidence);
    }

    function _stakeBoth(uint256 id, uint256 yesAmt, uint256 noAmt) internal {
        vm.prank(alice);
        market.stake(id, true, yesAmt);
        vm.prank(bob);
        market.stake(id, false, noAmt);
    }

    function _requestSettlement(uint256 id) internal {
        vm.warp(settleAfter);
        market.requestSettlement(id);
    }

    // --- lifecycle ----------------------------------------------------------

    function test_newMarket_setsOpenStatus() public {
        uint256 id = _newMarket();
        assertEq(uint8(_status(id)), uint8(FlightMarket.Status.Open));
        assertEq(market.marketCount(), 1);
    }

    function test_stake_accumulatesPools() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 300e6);

        assertEq(market.yesStake(id, alice), 100e6);
        assertEq(market.noStake(id, bob), 300e6);
        assertEq(token.balanceOf(address(market)), 400e6);
    }

    function test_stake_revertsAfterCloseTime() public {
        uint256 id = _newMarket();
        vm.warp(closeTime);
        vm.prank(alice);
        vm.expectRevert(FlightMarket.TooLate.selector);
        market.stake(id, true, 100e6);
    }

    function test_requestSettlement_revertsBeforeSettleAfter() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 100e6);
        vm.expectRevert(FlightMarket.TooEarly.selector);
        market.requestSettlement(id);
    }

    /// This is the exact log the CRE workflow triggers on.
    function test_requestSettlement_emitsTriggerEvent() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 100e6);
        vm.warp(settleAfter);

        vm.expectEmit(true, false, false, true, address(market));
        emit SettlementRequested(id, "AA100", 20240115, 60);
        market.requestSettlement(id);
    }

    // --- onReport / ReceiverTemplate plumbing --------------------------------

    function test_onReport_revertsForNonForwarder() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 100e6);
        _requestSettlement(id);

        // Args-bearing errors need expectPartialRevert (selector prefix match);
        // expectRevert(selector) requires an exact full-data match in forge 1.7.
        bytes memory metadata = _validMetadata();
        bytes memory report = _report(id, 1, 90, bytes32(uint256(1)));
        vm.expectPartialRevert(ReceiverTemplate.InvalidSender.selector);
        market.onReport(metadata, report);
    }

    function test_onReport_revertsForWrongAuthor() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 100e6);
        _requestSettlement(id);

        bytes memory metadata = _metadata(wfName, alice);
        bytes memory report = _report(id, 1, 90, bytes32(uint256(1)));
        vm.prank(forwarder);
        vm.expectPartialRevert(ReceiverTemplate.InvalidAuthor.selector);
        market.onReport(metadata, report);
    }

    function test_onReport_revertsForWrongWorkflowName() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 100e6);
        _requestSettlement(id);

        bytes memory metadata = _metadata(bytes10("wrong-name"), wfAuthor);
        bytes memory report = _report(id, 1, 90, bytes32(uint256(1)));
        vm.prank(forwarder);
        vm.expectPartialRevert(ReceiverTemplate.InvalidWorkflowName.selector);
        market.onReport(metadata, report);
    }

    /// ReceiverTemplate enforces that name validation cannot run without author
    /// validation also configured — 40-bit (bytes10) names alone are collision-prone.
    function test_onReport_nameWithoutAuthorReverts() public {
        FlightMarket bare = new FlightMarket(IERC20(address(token)), forwarder);
        bare.setExpectedWorkflowName(WF_NAME_STR);

        bytes memory metadata = _metadata(bare.getExpectedWorkflowName(), address(0));
        bytes memory report = _report(0, 1, 90, bytes32(0));
        vm.prank(forwarder);
        vm.expectRevert(ReceiverTemplate.WorkflowNameRequiresAuthorValidation.selector);
        bare.onReport(metadata, report);
    }

    function test_onReport_settlesYes() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 300e6);
        _requestSettlement(id);

        bytes32 evidence = keccak256("evidence");
        vm.prank(forwarder);
        vm.expectEmit(true, false, false, true, address(market));
        emit Settled(id, FlightMarket.Outcome.Yes, 90, evidence);
        market.onReport(_validMetadata(), _report(id, 1, 90, evidence));

        (FlightMarket.Status status, FlightMarket.Outcome outcome, bytes32 ev, int32 delay) = _settlement(id);
        assertEq(uint8(status), uint8(FlightMarket.Status.Settled));
        assertEq(uint8(outcome), uint8(FlightMarket.Outcome.Yes));
        assertEq(delay, 90);
        assertEq(ev, evidence);
    }

    function test_onReport_voidOutcomeVoidsMarket() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 300e6);
        _requestSettlement(id);

        vm.prank(forwarder);
        market.onReport(_validMetadata(), _report(id, 3, 0, bytes32(0)));

        assertEq(uint8(_status(id)), uint8(FlightMarket.Status.Void));
    }

    /// A one-sided book cannot pay out, so it must void even on a decisive outcome.
    function test_onReport_oneSidedBookVoids() public {
        uint256 id = _newMarket();
        vm.prank(alice);
        market.stake(id, true, 100e6);
        _requestSettlement(id);

        vm.prank(forwarder);
        market.onReport(_validMetadata(), _report(id, 1, 90, bytes32(0)));

        assertEq(uint8(_status(id)), uint8(FlightMarket.Status.Void));
    }

    function test_onReport_revertsIfNotAwaitingSettlement() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 100e6);

        vm.prank(forwarder);
        vm.expectRevert(FlightMarket.BadStatus.selector);
        market.onReport(_validMetadata(), _report(id, 1, 90, bytes32(0)));
    }

    function test_onReport_revertsOnOutOfRangeOutcome() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 100e6);
        _requestSettlement(id);

        vm.prank(forwarder);
        vm.expectRevert();
        market.onReport(_validMetadata(), _report(id, 4, 0, bytes32(0)));
    }

    // --- claims -------------------------------------------------------------

    function test_claim_parimutuelPayoutToWinner() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 300e6);
        _requestSettlement(id);

        vm.prank(forwarder);
        market.onReport(_validMetadata(), _report(id, 1, 90, bytes32(0)));

        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        market.claim(id);
        // Sole YES staker takes the entire 400e6 pot.
        assertEq(token.balanceOf(alice) - before, 400e6);
    }

    function test_claim_loserGetsNothing() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 300e6);
        _requestSettlement(id);

        vm.prank(forwarder);
        market.onReport(_validMetadata(), _report(id, 1, 90, bytes32(0)));

        vm.prank(bob);
        vm.expectRevert(FlightMarket.NothingToClaim.selector);
        market.claim(id);
    }

    function test_claim_refundsBothSidesOnVoid() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 300e6);
        _requestSettlement(id);

        vm.prank(forwarder);
        market.onReport(_validMetadata(), _report(id, 3, 0, bytes32(0)));

        vm.prank(alice);
        market.claim(id);
        vm.prank(bob);
        market.claim(id);

        assertEq(token.balanceOf(alice), 1_000e6);
        assertEq(token.balanceOf(bob), 1_000e6);
        assertEq(token.balanceOf(address(market)), 0);
    }

    function test_claim_revertsOnDoubleClaim() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 300e6);
        _requestSettlement(id);

        vm.prank(forwarder);
        market.onReport(_validMetadata(), _report(id, 1, 90, bytes32(0)));

        vm.startPrank(alice);
        market.claim(id);
        vm.expectRevert(FlightMarket.AlreadyClaimed.selector);
        market.claim(id);
        vm.stopPrank();
    }

    function test_claim_revertsBeforeSettlement() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 100e6);

        vm.prank(alice);
        vm.expectRevert(FlightMarket.BadStatus.selector);
        market.claim(id);
    }

    /// Split pot: two YES stakers share proportionally, and the pot is fully drained.
    function test_claim_proportionalSplitAndNoDust() public {
        uint256 id = _newMarket();
        address carol = address(0xCA401);
        token.mint(carol, 1_000e6);
        vm.prank(carol);
        token.approve(address(market), type(uint256).max);

        vm.prank(alice);
        market.stake(id, true, 100e6);
        vm.prank(carol);
        market.stake(id, true, 100e6);
        vm.prank(bob);
        market.stake(id, false, 200e6);

        _requestSettlement(id);
        vm.prank(forwarder);
        market.onReport(_validMetadata(), _report(id, 1, 90, bytes32(0)));

        vm.prank(alice);
        market.claim(id);
        vm.prank(carol);
        market.claim(id);

        assertEq(token.balanceOf(alice), 1_100e6);
        assertEq(token.balanceOf(carol), 1_100e6);
        assertEq(token.balanceOf(address(market)), 0);
    }

    // --- access control -----------------------------------------------------

    function test_setExpectedAuthor_onlyOwner() public {
        vm.prank(alice);
        vm.expectPartialRevert(Ownable.OwnableUnauthorizedAccount.selector);
        market.setExpectedAuthor(alice);
    }

    function test_setExpectedWorkflowName_onlyOwner() public {
        vm.prank(alice);
        vm.expectPartialRevert(Ownable.OwnableUnauthorizedAccount.selector);
        market.setExpectedWorkflowName("nope");
    }

    function test_ownerVoid_onlyOwner() public {
        uint256 id = _newMarket();
        vm.prank(alice);
        vm.expectPartialRevert(Ownable.OwnableUnauthorizedAccount.selector);
        market.ownerVoid(id);
    }

    // --- fuzz ---------------------------------------------------------------

    /// Total paid out must never exceed the pot, for any split.
    function testFuzz_payoutsNeverExceedPot(uint96 yesAmt, uint96 noAmt) public {
        yesAmt = uint96(bound(yesAmt, 1e6, 500e6));
        noAmt = uint96(bound(noAmt, 1e6, 500e6));

        uint256 id = _newMarket();
        _stakeBoth(id, yesAmt, noAmt);
        _requestSettlement(id);

        vm.prank(forwarder);
        market.onReport(_validMetadata(), _report(id, 1, 90, bytes32(0)));

        uint256 pot = uint256(yesAmt) + uint256(noAmt);
        assertEq(token.balanceOf(address(market)), pot);

        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        market.claim(id);
        uint256 paid = token.balanceOf(alice) - before;

        // Sole YES staker: takes the whole pot, and never more than the pot.
        assertLe(paid, pot);
        assertEq(paid, pot);
        assertEq(token.balanceOf(address(market)), 0);

        // The losing side can never extract anything.
        vm.prank(bob);
        vm.expectRevert(FlightMarket.NothingToClaim.selector);
        market.claim(id);
    }

    // --- struct accessors ---------------------------------------------------
    // Market layout: question, flightIata, departureDate, thresholdMinutes,
    // closeTime, settleAfter, status, outcome, evidenceHash, observedDelay,
    // yesPool, noPool.

    function _status(uint256 id) internal view returns (FlightMarket.Status status) {
        (,,,,,, status,,,,,) = market.markets(id);
    }

    function _settlement(uint256 id)
        internal
        view
        returns (
            FlightMarket.Status status,
            FlightMarket.Outcome outcome,
            bytes32 evidenceHash,
            int32 observedDelay
        )
    {
        (,,,,,, status, outcome, evidenceHash, observedDelay,,) = market.markets(id);
    }
}
