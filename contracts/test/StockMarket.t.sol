// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {StockMarket} from "../src/StockMarket.sol";
import {ParimutuelMarket} from "../src/ParimutuelMarket.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract StockMarketTest is Test {
    StockMarket internal market;
    MockUSDC internal token;

    address internal forwarder = address(0xF0);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    // The real CSPX/USD proxy on Sepolia, used as a plausible-looking address.
    // Nothing here calls it — settlement reads the feed off chain, in the CRE
    // workflow, so these tests never need a live aggregator.
    address internal constant CSPX_FEED = 0x4b531A318B0e44B549F3b2f824721b3D0d51930A;
    address internal constant XAU_FEED = 0xC5981F461d74c46eB4b0CF3f4Ec79f025573B0Ea;

    string internal constant WF_NAME_STR = "stock-settlement-staging";
    address internal wfAuthor;
    bytes10 internal wfName;

    /// $840.00 at 8 decimals.
    uint64 internal constant STRIKE = 84_000_000_000;
    uint32 internal constant MAX_STALENESS = 26 hours;

    uint64 internal closeTime;
    uint64 internal expiryTime;

    event FeedRegistered(string symbol, address feed);
    event FeedRemoved(string symbol, address feed);
    event MarketCreated(
        uint256 indexed marketId, string symbol, address feed, uint64 strikePrice, uint64 expiryTime
    );
    event SettlementRequested(
        uint256 indexed marketId,
        address feed,
        uint64 strikePrice,
        uint64 closeTime,
        uint64 expiryTime,
        uint32 maxStaleness
    );

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new MockUSDC();
        market = new StockMarket(IERC20(address(token)), forwarder);

        wfAuthor = address(this);
        market.setExpectedAuthor(wfAuthor);
        market.setExpectedWorkflowName(WF_NAME_STR);
        wfName = market.getExpectedWorkflowName();

        market.registerFeed("CSPX", CSPX_FEED);

        closeTime = uint64(block.timestamp + 1 hours);
        expiryTime = uint64(block.timestamp + 8 hours);

        token.mint(alice, 1_000e6);
        token.mint(bob, 1_000e6);
        vm.prank(alice);
        token.approve(address(market), type(uint256).max);
        vm.prank(bob);
        token.approve(address(market), type(uint256).max);
    }

    // --- helpers ------------------------------------------------------------

    function _newMarket() internal returns (uint256 id) {
        id = market.newMarket(
            "Will CSPX be at or above $840 at the close?",
            "CSPX",
            STRIKE,
            closeTime,
            expiryTime,
            MAX_STALENESS
        );
    }

    function _validMetadata() internal view returns (bytes memory) {
        return abi.encodePacked(bytes32(0), wfName, wfAuthor);
    }

    function _report(uint256 id, uint8 outcome, int256 price, bytes32 evidence)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(id, outcome, price, evidence);
    }

    function _stakeBoth(uint256 id, uint256 yesAmt, uint256 noAmt) internal {
        vm.prank(alice);
        market.stake(id, true, yesAmt);
        vm.prank(bob);
        market.stake(id, false, noAmt);
    }

    function _settle(uint256 id, uint8 outcome, int256 price) internal {
        vm.warp(expiryTime + market.SETTLEMENT_DELAY());
        market.requestSettlement(id);
        vm.prank(forwarder);
        market.onReport(_validMetadata(), _report(id, outcome, price, bytes32("ev")));
    }

    function _status(uint256 id) internal view returns (ParimutuelMarket.Status s) {
        (,,, s,,,,,) = market.core(id);
    }

    function _settlement(uint256 id)
        internal
        view
        returns (ParimutuelMarket.Status s, ParimutuelMarket.Outcome o, int256 observed)
    {
        (,,, s, o,, observed,,) = market.core(id);
    }

    // --- feed registry ------------------------------------------------------

    function test_registerFeed_mapsBothDirections() public {
        market.registerFeed("XAU", XAU_FEED);
        assertEq(market.feedFor("XAU"), XAU_FEED);
        assertEq(market.symbolFor(XAU_FEED), "XAU");
    }

    function test_registerFeed_emits() public {
        vm.expectEmit(true, true, true, true);
        emit FeedRegistered("XAU", XAU_FEED);
        market.registerFeed("XAU", XAU_FEED);
    }

    function test_registerFeed_onlyOwner() public {
        vm.prank(alice);
        vm.expectPartialRevert(Ownable.OwnableUnauthorizedAccount.selector);
        market.registerFeed("XAU", XAU_FEED);
    }

    /// Silently repointing a symbol would change the settlement source of every
    /// market already created against it.
    function test_registerFeed_rejectsDuplicateSymbol() public {
        vm.expectRevert(StockMarket.FeedExists.selector);
        market.registerFeed("CSPX", XAU_FEED);
    }

    function test_registerFeed_rejectsZeroAddress() public {
        vm.expectRevert(StockMarket.UnknownFeed.selector);
        market.registerFeed("NIL", address(0));
    }

    function test_removeFeed_clearsBothDirections() public {
        market.removeFeed("CSPX");
        assertEq(market.feedFor("CSPX"), address(0));
        assertEq(market.symbolFor(CSPX_FEED), "");
    }

    function test_removeFeed_onlyOwner() public {
        vm.prank(alice);
        vm.expectPartialRevert(Ownable.OwnableUnauthorizedAccount.selector);
        market.removeFeed("CSPX");
    }

    function test_removeFeed_rejectsUnknown() public {
        vm.expectRevert(StockMarket.UnknownFeed.selector);
        market.removeFeed("NOPE");
    }

    /// Removing a symbol must not disturb markets already created from it —
    /// their feed is captured in their own terms.
    function test_removeFeed_leavesExistingMarketsIntact() public {
        uint256 id = _newMarket();
        market.removeFeed("CSPX");
        (address feed,,,) = market.terms(id);
        assertEq(feed, CSPX_FEED);
    }

    // --- creation -----------------------------------------------------------

    function test_newMarket_storesTermsAndOpens() public {
        uint256 id = _newMarket();
        (address feed, uint64 strike, uint64 expiry, uint32 staleness) = market.terms(id);

        assertEq(feed, CSPX_FEED);
        assertEq(strike, STRIKE);
        assertEq(expiry, expiryTime);
        assertEq(staleness, MAX_STALENESS);
        assertEq(uint8(_status(id)), uint8(ParimutuelMarket.Status.Open));
        assertEq(market.marketCount(), 1);
    }

    function test_newMarket_settleAfterIsExpiryPlusDelay() public {
        uint256 id = _newMarket();
        (,, uint64 settleAfter,,,,,,) = market.core(id);
        assertEq(settleAfter, expiryTime + market.SETTLEMENT_DELAY());
    }

    function test_newMarket_emits() public {
        vm.expectEmit(true, true, true, true);
        emit MarketCreated(0, "CSPX", CSPX_FEED, STRIKE, expiryTime);
        _newMarket();
    }

    /// The whole point of the allowlist: an unregistered symbol has no feed, so
    /// nobody can slip in a settlement source of their own choosing.
    function test_newMarket_rejectsUnregisteredSymbol() public {
        vm.expectRevert(StockMarket.UnknownFeed.selector);
        market.newMarket("bad", "TSLA", STRIKE, closeTime, expiryTime, MAX_STALENESS);
    }

    function test_newMarket_rejectsZeroStrike() public {
        vm.expectRevert(StockMarket.BadStrike.selector);
        market.newMarket("bad", "CSPX", 0, closeTime, expiryTime, MAX_STALENESS);
    }

    function test_newMarket_rejectsCloseAfterExpiry() public {
        vm.expectRevert(StockMarket.BadExpiry.selector);
        market.newMarket("bad", "CSPX", STRIKE, expiryTime + 1, expiryTime, MAX_STALENESS);
    }

    /// Zero tolerance would mean "the round must be published at the exact
    /// second of expiry", which no feed can satisfy — every such market would
    /// void. Rejecting it at creation is better than voiding at settlement.
    function test_newMarket_rejectsZeroStaleness() public {
        vm.expectRevert(StockMarket.BadExpiry.selector);
        market.newMarket("bad", "CSPX", STRIKE, closeTime, expiryTime, 0);
    }

    function test_newMarket_allowsCloseEqualToExpiry() public {
        uint256 id =
            market.newMarket("ok", "CSPX", STRIKE, expiryTime, expiryTime, MAX_STALENESS);
        assertEq(uint8(_status(id)), uint8(ParimutuelMarket.Status.Open));
    }

    // --- settlement request -------------------------------------------------

    /// The workflow is handed closeTime as well as expiry: without it, it
    /// cannot tell whether the price moved while the market was live.
    function test_requestSettlement_emitsBothDeadlines() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 10e6, 10e6);
        vm.warp(expiryTime + market.SETTLEMENT_DELAY());

        vm.expectEmit(true, true, true, true);
        emit SettlementRequested(id, CSPX_FEED, STRIKE, closeTime, expiryTime, MAX_STALENESS);
        market.requestSettlement(id);
    }

    function test_requestSettlement_rejectedBeforeDelayElapses() public {
        uint256 id = _newMarket();
        vm.warp(expiryTime + market.SETTLEMENT_DELAY() - 1);
        vm.expectRevert(ParimutuelMarket.TooEarly.selector);
        market.requestSettlement(id);
    }

    function test_requestSettlement_rejectsSecondRequest() public {
        uint256 id = _newMarket();
        vm.warp(expiryTime + market.SETTLEMENT_DELAY());
        market.requestSettlement(id);
        vm.expectRevert(ParimutuelMarket.BadStatus.selector);
        market.requestSettlement(id);
    }

    // --- staking ------------------------------------------------------------

    function test_stake_rejectedAtCloseTime() public {
        uint256 id = _newMarket();
        vm.warp(closeTime);
        vm.prank(alice);
        vm.expectRevert(ParimutuelMarket.TooLate.selector);
        market.stake(id, true, 10e6);
    }

    // --- settlement ---------------------------------------------------------

    function test_settle_yesPaysYesSide() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 30e6, 10e6);
        _settle(id, uint8(ParimutuelMarket.Outcome.Yes), 84_100_000_000);

        (ParimutuelMarket.Status s, ParimutuelMarket.Outcome o, int256 observed) = _settlement(id);
        assertEq(uint8(s), uint8(ParimutuelMarket.Status.Settled));
        assertEq(uint8(o), uint8(ParimutuelMarket.Outcome.Yes));
        assertEq(observed, 84_100_000_000);

        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        market.claim(id);
        assertEq(token.balanceOf(alice) - before, 40e6);
    }

    function test_settle_noPaysNoSide() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 30e6, 10e6);
        _settle(id, uint8(ParimutuelMarket.Outcome.No), 83_900_000_000);

        uint256 before = token.balanceOf(bob);
        vm.prank(bob);
        market.claim(id);
        assertEq(token.balanceOf(bob) - before, 40e6);
    }

    /// A price that never moved between close and expiry means the market was
    /// already decided when the book shut. The workflow reports Void; the
    /// contract must refund rather than pay a winner.
    function test_settle_voidRefundsBothSides() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 30e6, 10e6);
        _settle(id, uint8(ParimutuelMarket.Outcome.Void), 0);

        assertEq(uint8(_status(id)), uint8(ParimutuelMarket.Status.Void));

        uint256 aliceBefore = token.balanceOf(alice);
        uint256 bobBefore = token.balanceOf(bob);
        vm.prank(alice);
        market.claim(id);
        vm.prank(bob);
        market.claim(id);
        assertEq(token.balanceOf(alice) - aliceBefore, 30e6);
        assertEq(token.balanceOf(bob) - bobBefore, 10e6);
    }

    function test_settle_oneSidedBookVoidsEvenOnYes() public {
        uint256 id = _newMarket();
        vm.prank(alice);
        market.stake(id, true, 30e6);
        _settle(id, uint8(ParimutuelMarket.Outcome.Yes), 84_100_000_000);

        assertEq(uint8(_status(id)), uint8(ParimutuelMarket.Status.Void));
        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        market.claim(id);
        assertEq(token.balanceOf(alice) - before, 30e6);
    }

    function test_settle_rejectsReportFromNonForwarder() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 10e6, 10e6);
        vm.warp(expiryTime + market.SETTLEMENT_DELAY());
        market.requestSettlement(id);

        vm.prank(alice);
        vm.expectRevert();
        market.onReport(_validMetadata(), _report(id, 1, 84_100_000_000, bytes32("ev")));
    }

    function test_settle_rejectsWrongAuthor() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 10e6, 10e6);
        vm.warp(expiryTime + market.SETTLEMENT_DELAY());
        market.requestSettlement(id);

        bytes memory badMeta = abi.encodePacked(bytes32(0), wfName, address(0xBAD));
        vm.prank(forwarder);
        vm.expectRevert();
        market.onReport(badMeta, _report(id, 1, 84_100_000_000, bytes32("ev")));
    }

    function test_settle_rejectsUnrequestedMarket() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 10e6, 10e6);
        vm.prank(forwarder);
        vm.expectRevert(ParimutuelMarket.BadStatus.selector);
        market.onReport(_validMetadata(), _report(id, 1, 84_100_000_000, bytes32("ev")));
    }

    /// Equities can and do trade below a dollar after a collapse; the report
    /// carries int256 so a feed reporting a negative or zero value cannot wrap
    /// into a huge positive one on the way in.
    function test_settle_acceptsZeroObservedPriceOnVoid() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 10e6, 10e6);
        _settle(id, uint8(ParimutuelMarket.Outcome.Void), 0);
        (,, int256 observed) = _settlement(id);
        assertEq(observed, 0);
    }

    // --- payout maths -------------------------------------------------------

    function testFuzz_settle_yesSidePayoutNeverExceedsPot(uint96 yesAmt, uint96 noAmt) public {
        vm.assume(yesAmt > 0 && noAmt > 0);
        vm.assume(yesAmt < 1_000e6 && noAmt < 1_000e6);

        uint256 id = _newMarket();
        _stakeBoth(id, yesAmt, noAmt);
        _settle(id, uint8(ParimutuelMarket.Outcome.Yes), 84_100_000_000);

        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        market.claim(id);
        assertLe(token.balanceOf(alice) - before, uint256(yesAmt) + uint256(noAmt));
    }
}
