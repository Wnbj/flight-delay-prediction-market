// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReserveMarket} from "../src/ReserveMarket.sol";
import {ParimutuelMarket} from "../src/ParimutuelMarket.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract ReserveMarketTest is Test {
    ReserveMarket internal market;
    MockUSDC internal token;

    address internal forwarder = address(0xF0);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    // Real Sepolia reserve feeds. Nothing here calls them — settlement reads
    // the feed off chain in the CRE workflow — but using the real addresses
    // keeps the fixtures honest.
    address internal constant STETH_POR = 0x8328e01902A47942Eecb9DBF97d6bF9dd3bd07E6;
    address internal constant USDW_RESERVES = 0x92B42669e6B34f54dd445EF23552C61A68bda0F1;

    string internal constant WF_NAME_STR = "reserve-settlement-staging";
    address internal wfAuthor;
    bytes10 internal wfName;

    /// 9,000,000.00 tokens at 8 decimals — a level below stETH's real reserves.
    uint64 internal constant STRIKE = 900_000_000_000_000;
    uint32 internal constant MAX_STALENESS = 26 hours;

    uint64 internal closeTime;
    uint64 internal expiryTime;

    event MarketCreated(
        uint256 indexed marketId, string symbol, address feed, uint64 strikePrice, uint64 expiryTime
    );

    /// Note the absence of closeTime — see test_settlementRequest_carriesNoCloseTime.
    event SettlementRequested(
        uint256 indexed marketId,
        address feed,
        uint64 strikePrice,
        uint64 expiryTime,
        uint32 maxStaleness
    );

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new MockUSDC();
        market = new ReserveMarket(IERC20(address(token)), forwarder);

        wfAuthor = address(this);
        market.setExpectedAuthor(wfAuthor);
        market.setExpectedWorkflowName(WF_NAME_STR);
        wfName = market.getExpectedWorkflowName();

        market.registerFeed("STETH", STETH_POR);

        closeTime = uint64(block.timestamp + 1 hours);
        expiryTime = uint64(block.timestamp + 1 days);

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
            "Will stETH reserves be at or above 9,000,000?",
            "STETH",
            STRIKE,
            closeTime,
            expiryTime,
            MAX_STALENESS
        );
    }

    function _validMetadata() internal view returns (bytes memory) {
        return abi.encodePacked(bytes32(0), wfName, wfAuthor);
    }

    function _report(uint256 id, uint8 outcome, int256 level, bytes32 evidence)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(id, outcome, level, evidence);
    }

    function _stakeBoth(uint256 id, uint256 yesAmt, uint256 noAmt) internal {
        vm.prank(alice);
        market.stake(id, true, yesAmt);
        vm.prank(bob);
        market.stake(id, false, noAmt);
    }

    function _settle(uint256 id, uint8 outcome, int256 level) internal {
        vm.warp(expiryTime + market.SETTLEMENT_DELAY());
        market.requestSettlement(id);
        vm.prank(forwarder);
        market.onReport(_validMetadata(), _report(id, outcome, level, bytes32("ev")));
    }

    function _status(uint256 id) internal view returns (ParimutuelMarket.Status s) {
        (,,, s,,,,,) = market.core(id);
    }

    // --- what makes this contract different --------------------------------

    /**
     * The whole reason this is a separate contract from StockMarket.
     *
     * StockMarket emits closeTime so the workflow can void a market whose feed
     * answer never changed — right for an equity, where an unchanged answer
     * over a session means the exchange was shut. A reserve has no session:
     * sitting still for a day is ordinary, not evidence the outcome was already
     * fixed. Withholding the input is a stronger guarantee than asking the
     * workflow not to use it, so this asserts the event's exact shape.
     */
    function test_settlementRequest_carriesNoCloseTime() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 10e6, 10e6);
        vm.warp(expiryTime + market.SETTLEMENT_DELAY());

        vm.expectEmit(true, true, true, true);
        emit SettlementRequested(id, STETH_POR, STRIKE, expiryTime, MAX_STALENESS);
        market.requestSettlement(id);
    }

    /**
     * Reserve and NAV feeds publish slowly — some Sepolia fund feeds run to a
     * 27-hour heartbeat — so settlement waits longer here than for a price.
     */
    function test_settlementDelay_isAnHour() public view {
        assertEq(market.SETTLEMENT_DELAY(), 1 hours);
    }

    /**
     * A strike is quoted at 8 decimals whatever the feed's own scale is. stETH
     * Proof of Reserves publishes 18 decimals and its raw answer does not fit
     * in a uint64 at all; the workflow rescales before comparing. This just
     * pins that a large 8-decimal strike is storable.
     */
    function test_strike_holdsAMillionsScaleLevel() public {
        uint256 id = _newMarket();
        (, uint64 strike,,) = market.terms(id);
        assertEq(strike, STRIKE);
        assertEq(uint256(strike) / 1e8, 9_000_000);
    }

    // --- feed registry ------------------------------------------------------

    function test_registerFeed_mapsBothDirections() public {
        market.registerFeed("USDW", USDW_RESERVES);
        assertEq(market.feedFor("USDW"), USDW_RESERVES);
        assertEq(market.symbolFor(USDW_RESERVES), "USDW");
    }

    function test_registerFeed_onlyOwner() public {
        vm.prank(alice);
        vm.expectPartialRevert(Ownable.OwnableUnauthorizedAccount.selector);
        market.registerFeed("USDW", USDW_RESERVES);
    }

    function test_registerFeed_rejectsDuplicateSymbol() public {
        vm.expectRevert(ReserveMarket.FeedExists.selector);
        market.registerFeed("STETH", USDW_RESERVES);
    }

    function test_registerFeed_rejectsZeroAddress() public {
        vm.expectRevert(ReserveMarket.UnknownFeed.selector);
        market.registerFeed("NIL", address(0));
    }

    function test_removeFeed_leavesExistingMarketsIntact() public {
        uint256 id = _newMarket();
        market.removeFeed("STETH");
        (address feed,,,) = market.terms(id);
        assertEq(feed, STETH_POR);
    }

    /// The allowlist is the point: nobody can name their own settlement source.
    function test_newMarket_rejectsUnregisteredSymbol() public {
        vm.expectRevert(ReserveMarket.UnknownFeed.selector);
        market.newMarket("bad", "MADEUP", STRIKE, closeTime, expiryTime, MAX_STALENESS);
    }

    // --- creation -----------------------------------------------------------

    function test_newMarket_storesTermsAndOpens() public {
        uint256 id = _newMarket();
        (address feed, uint64 strike, uint64 expiry, uint32 staleness) = market.terms(id);

        assertEq(feed, STETH_POR);
        assertEq(strike, STRIKE);
        assertEq(expiry, expiryTime);
        assertEq(staleness, MAX_STALENESS);
        assertEq(uint8(_status(id)), uint8(ParimutuelMarket.Status.Open));
    }

    function test_newMarket_emits() public {
        vm.expectEmit(true, true, true, true);
        emit MarketCreated(0, "STETH", STETH_POR, STRIKE, expiryTime);
        _newMarket();
    }

    function test_newMarket_rejectsZeroStrike() public {
        vm.expectRevert(ReserveMarket.BadStrike.selector);
        market.newMarket("bad", "STETH", 0, closeTime, expiryTime, MAX_STALENESS);
    }

    /**
     * Even without a movement check, staking must shut before the level is
     * read — otherwise the reserve could cross the strike with the book still
     * open and anyone watching could stake on a known result.
     */
    function test_newMarket_rejectsCloseAfterExpiry() public {
        vm.expectRevert(ReserveMarket.BadExpiry.selector);
        market.newMarket("bad", "STETH", STRIKE, expiryTime + 1, expiryTime, MAX_STALENESS);
    }

    /**
     * Staleness is the load-bearing guard here, since the movement check is
     * gone. A zero tolerance would void every market, so it is refused at
     * creation rather than discovered at settlement.
     */
    function test_newMarket_rejectsZeroStaleness() public {
        vm.expectRevert(ReserveMarket.BadExpiry.selector);
        market.newMarket("bad", "STETH", STRIKE, closeTime, expiryTime, 0);
    }

    // --- settlement ---------------------------------------------------------

    function test_settle_yesPaysYesSide() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 30e6, 10e6);
        _settle(id, uint8(ParimutuelMarket.Outcome.Yes), 950_565_085_746_582);

        (,,, ParimutuelMarket.Status s, ParimutuelMarket.Outcome o,, int256 observed,,) =
            market.core(id);
        assertEq(uint8(s), uint8(ParimutuelMarket.Status.Settled));
        assertEq(uint8(o), uint8(ParimutuelMarket.Outcome.Yes));
        // The normalized stETH reserve level, 9,505,650.85746582 at 8 decimals.
        assertEq(observed, 950_565_085_746_582);

        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        market.claim(id);
        assertEq(token.balanceOf(alice) - before, 40e6);
    }

    function test_settle_noPaysNoSide() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 30e6, 10e6);
        _settle(id, uint8(ParimutuelMarket.Outcome.No), 800_000_000_000_000);

        uint256 before = token.balanceOf(bob);
        vm.prank(bob);
        market.claim(id);
        assertEq(token.balanceOf(bob) - before, 40e6);
    }

    /// A stale feed is the failure mode this contract is most exposed to.
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
        _settle(id, uint8(ParimutuelMarket.Outcome.Yes), 950_565_085_746_582);
        assertEq(uint8(_status(id)), uint8(ParimutuelMarket.Status.Void));
    }

    function test_settle_rejectsWrongAuthor() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 10e6, 10e6);
        vm.warp(expiryTime + market.SETTLEMENT_DELAY());
        market.requestSettlement(id);

        bytes memory badMeta = abi.encodePacked(bytes32(0), wfName, address(0xBAD));
        vm.prank(forwarder);
        vm.expectRevert();
        market.onReport(badMeta, _report(id, 1, 950_565_085_746_582, bytes32("ev")));
    }

    function test_requestSettlement_rejectedBeforeDelayElapses() public {
        uint256 id = _newMarket();
        vm.warp(expiryTime + market.SETTLEMENT_DELAY() - 1);
        vm.expectRevert(ParimutuelMarket.TooEarly.selector);
        market.requestSettlement(id);
    }

    function test_stake_rejectedAtCloseTime() public {
        uint256 id = _newMarket();
        vm.warp(closeTime);
        vm.prank(alice);
        vm.expectRevert(ParimutuelMarket.TooLate.selector);
        market.stake(id, true, 10e6);
    }

    function testFuzz_settle_payoutNeverExceedsPot(uint96 yesAmt, uint96 noAmt) public {
        vm.assume(yesAmt > 0 && noAmt > 0);
        vm.assume(yesAmt < 1_000e6 && noAmt < 1_000e6);

        uint256 id = _newMarket();
        _stakeBoth(id, yesAmt, noAmt);
        _settle(id, uint8(ParimutuelMarket.Outcome.Yes), 950_565_085_746_582);

        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        market.claim(id);
        assertLe(token.balanceOf(alice) - before, uint256(yesAmt) + uint256(noAmt));
    }
}
