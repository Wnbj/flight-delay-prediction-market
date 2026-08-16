// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AmmMarket} from "../src/AmmMarket.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract AmmMarketTest is Test {
    AmmMarket internal market;
    MockUSDC internal token;

    address internal forwarder = address(0xF0);
    address internal maker = address(0x4A4E);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    string internal constant WF_NAME_STR = "amm-settlement-staging";
    address internal wfAuthor;
    bytes10 internal wfName;

    uint64 internal constant STRIKE = 6_300_000_000_000; // $63,000.00
    uint256 internal constant LIQUIDITY = 1_000e6;

    uint64 internal closeTime;
    uint64 internal expiryTime;

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new MockUSDC();
        market = new AmmMarket(IERC20(address(token)), forwarder);

        wfAuthor = address(this);
        market.setExpectedAuthor(wfAuthor);
        market.setExpectedWorkflowName(WF_NAME_STR);
        wfName = market.getExpectedWorkflowName();

        closeTime = uint64(block.timestamp + 1 hours);
        expiryTime = uint64(block.timestamp + 2 hours);

        for (uint256 i = 0; i < 3; i++) {
            address who = [maker, alice, bob][i];
            token.mint(who, 100_000e6);
            vm.prank(who);
            token.approve(address(market), type(uint256).max);
        }
    }

    // --- helpers ------------------------------------------------------------

    function _newMarket() internal returns (uint256 id) {
        return _newMarketAt(5_000);
    }

    function _newMarketAt(uint256 openingBps) internal returns (uint256 id) {
        vm.prank(maker);
        id = market.newMarket(
            "Will BTC be at or above $63,000?",
            AmmMarket.Asset.BTC,
            STRIKE,
            closeTime,
            expiryTime,
            LIQUIDITY,
            openingBps
        );
    }

    function _buy(uint256 id, address who, bool isYes, uint256 amount) internal returns (uint256) {
        vm.prank(who);
        return market.buy(id, isYes, amount, 0);
    }

    function _validMetadata() internal view returns (bytes memory) {
        return abi.encodePacked(bytes32(0), wfName, wfAuthor);
    }

    function _settle(uint256 id, AmmMarket.Outcome outcome) internal {
        vm.warp(expiryTime + market.SETTLEMENT_DELAY());
        market.requestSettlement(id);
        vm.prank(forwarder);
        market.onReport(
            _validMetadata(),
            abi.encode(id, uint8(outcome), int256(6_400_000_000_000), bytes32("ev"))
        );
    }

    function _pool(uint256 id)
        internal
        view
        returns (uint256 yesReserve, uint256 noReserve, uint256 collateral)
    {
        (,,,,, yesReserve, noReserve, collateral) = market.pool(id);
    }

    /**
     * The invariant everything rests on: every share in existence, in the pool
     * or in a wallet, is backed by its own unit of collateral. Asserted after
     * every trade rather than only at the end.
     */
    function _assertFullyCollateralised(uint256 id, address[] memory holders) internal view {
        (uint256 yesReserve, uint256 noReserve, uint256 collateral) = _pool(id);

        uint256 yesHeld = yesReserve;
        uint256 noHeld = noReserve;
        for (uint256 i = 0; i < holders.length; i++) {
            yesHeld += market.yesShares(id, holders[i]);
            noHeld += market.noShares(id, holders[i]);
        }

        assertEq(yesHeld, collateral, "YES shares not fully collateralised");
        assertEq(noHeld, collateral, "NO shares not fully collateralised");
        assertGe(token.balanceOf(address(market)), collateral, "contract holds less than it owes");
    }

    function _holders() internal view returns (address[] memory h) {
        h = new address[](3);
        h[0] = maker;
        h[1] = alice;
        h[2] = bob;
    }

    // --- the property that distinguishes this from parimutuel ---------------

    /**
     * The whole point of the AMM. In the parimutuel contracts a later stake on
     * your own side dilutes your share of the pot; here a later trade cannot
     * touch what you already hold.
     */
    function test_buyerPriceIsFixedByLaterTrades() public {
        uint256 id = _newMarket();

        uint256 aliceShares = _buy(id, alice, true, 100e6);

        // Bob piles into the same side, hard.
        _buy(id, bob, true, 500e6);

        assertEq(market.yesShares(id, alice), aliceShares, "alice's holding changed");

        _settle(id, AmmMarket.Outcome.Yes);

        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        market.redeem(id);
        assertEq(token.balanceOf(alice) - before, aliceShares, "alice's payout changed");
    }

    /// Buying pushes the price of that side up, which is what a price is for.
    function test_priceMovesWithTheTrade() public {
        uint256 id = _newMarket();
        assertEq(market.yesPriceBps(id), 5_000, "should open at even odds");

        _buy(id, alice, true, 200e6);
        uint256 afterYes = market.yesPriceBps(id);
        assertGt(afterYes, 5_000, "buying YES must raise the YES price");

        _buy(id, bob, false, 200e6);
        assertLt(market.yesPriceBps(id), afterYes, "buying NO must lower the YES price");
    }

    /// A buyer always pays less than 1 per share, or the trade makes no sense.
    function test_sharesOutAlwaysExceedCollateralIn() public {
        uint256 id = _newMarket();
        assertGt(_buy(id, alice, true, 50e6), 50e6);
    }

    function test_quoteMatchesWhatBuyActuallyGives() public {
        uint256 id = _newMarket();
        uint256 quoted = market.quote(id, true, 123e6);
        assertEq(_buy(id, alice, true, 123e6), quoted);
    }

    function test_buy_respectsSlippageBound() public {
        uint256 id = _newMarket();
        uint256 quoted = market.quote(id, true, 100e6);

        vm.prank(alice);
        vm.expectRevert(AmmMarket.SlippageTooHigh.selector);
        market.buy(id, true, 100e6, quoted + 1);
    }

    // --- solvency -----------------------------------------------------------

    function test_collateralisation_holdsAfterEveryTrade() public {
        uint256 id = _newMarket();
        _assertFullyCollateralised(id, _holders());

        _buy(id, alice, true, 300e6);
        _assertFullyCollateralised(id, _holders());

        _buy(id, bob, false, 750e6);
        _assertFullyCollateralised(id, _holders());

        _buy(id, alice, true, 10e6);
        _assertFullyCollateralised(id, _holders());
    }

    /**
     * Everyone redeems and the maker withdraws: the contract must end at
     * exactly zero for this market. A surplus means someone was underpaid, a
     * shortfall means it could not have paid the last claim.
     */
    function test_everyClaimIsPayableAndNothingIsLeftOver() public {
        uint256 id = _newMarket();
        _buy(id, alice, true, 400e6);
        _buy(id, bob, false, 250e6);

        _settle(id, AmmMarket.Outcome.Yes);

        vm.prank(alice);
        market.redeem(id);
        vm.prank(maker);
        market.withdrawMakerLiquidity(id);

        // Bob held only the losing side.
        vm.prank(bob);
        vm.expectRevert(AmmMarket.NothingToRedeem.selector);
        market.redeem(id);

        assertEq(token.balanceOf(address(market)), 0, "contract should be fully drained");
    }

    /**
     * A void pays half a unit per share, either side — and is NOT a refund.
     *
     * The first version of the contract paid both sides in full here, which
     * promises two units for every one of collateral held. This test failed
     * with ERC20InsufficientBalance, which is how the bug was found.
     */
    function test_voidPaysHalfPerShareAndStaysSolvent() public {
        uint256 id = _newMarket();
        uint256 aliceShares = _buy(id, alice, true, 400e6);
        uint256 bobShares = _buy(id, bob, false, 250e6);

        uint256 aliceBefore = token.balanceOf(alice);
        uint256 bobBefore = token.balanceOf(bob);

        (,, uint256 collateral) = _pool(id);
        _settle(id, AmmMarket.Outcome.Void);

        vm.prank(alice);
        market.redeem(id);
        vm.prank(bob);
        market.redeem(id);
        vm.prank(maker);
        market.withdrawMakerLiquidity(id);

        assertEq(token.balanceOf(alice) - aliceBefore, aliceShares / 2);
        assertEq(token.balanceOf(bob) - bobBefore, bobShares / 2);

        // Solvent, with only flooring dust left behind — never a shortfall.
        assertLe(token.balanceOf(address(market)), 3);
        assertLe(collateral, type(uint256).max);
    }

    /// Buying away from even odds means a void costs you — stated, not hidden.
    function test_voidIsALossForSomeoneWhoBoughtAboveFiftyCents() public {
        uint256 id = _newMarket();
        // A large buy pushes the price well past even, so these shares cost
        // more than 50 cents apiece.
        uint256 shares = _buy(id, alice, true, 900e6);
        assertLt(shares, 900e6 * 2, "these shares cost more than 50c each");

        uint256 before = token.balanceOf(alice);
        _settle(id, AmmMarket.Outcome.Void);
        vm.prank(alice);
        market.redeem(id);

        assertLt(token.balanceOf(alice) - before, 900e6, "a void is not a refund here");
    }

    /**
     * The maker's risk, made explicit. Traders who backed the winning side are
     * paid out of the liquidity the maker seeded, so the maker recovers less
     * than they put in — bounded by the seed, never more.
     */
    function test_makerLosesWhenTradersAreRight() public {
        uint256 id = _newMarket();
        _buy(id, alice, true, 500e6);

        uint256 makerBefore = token.balanceOf(maker);
        _settle(id, AmmMarket.Outcome.Yes);
        vm.prank(maker);
        market.withdrawMakerLiquidity(id);

        uint256 recovered = token.balanceOf(maker) - makerBefore;
        assertLt(recovered, LIQUIDITY, "maker should be down when traders are right");
        assertGt(recovered, 0, "maker's loss is bounded, not total");
    }

    function test_makerGainsWhenTradersAreWrong() public {
        uint256 id = _newMarket();
        _buy(id, alice, true, 500e6);

        uint256 makerBefore = token.balanceOf(maker);
        _settle(id, AmmMarket.Outcome.No);
        vm.prank(maker);
        market.withdrawMakerLiquidity(id);

        assertGt(token.balanceOf(maker) - makerBefore, LIQUIDITY, "maker keeps the losing bet");
    }

    /**
     * Nobody traded. Unlike the parimutuel contracts, which void a one-sided
     * book, this settles normally and the maker simply gets their money back.
     */
    function test_untradedMarketReturnsLiquidityIntact() public {
        uint256 id = _newMarket();
        uint256 makerBefore = token.balanceOf(maker);

        _settle(id, AmmMarket.Outcome.Yes);
        vm.prank(maker);
        market.withdrawMakerLiquidity(id);

        assertEq(token.balanceOf(maker) - makerBefore, LIQUIDITY);
        assertEq(token.balanceOf(address(market)), 0);
    }

    // --- opening at a chosen price ------------------------------------------

    /**
     * A ladder seeded flat reads 50% at every strike, which says nothing about
     * where the price will land — the shape IS the information. Before this,
     * the only way to get one was to trade every rung by hand.
     */
    function test_opensAtTheRequestedPrice() public {
        uint256[5] memory targets = [uint256(1_200), 2_500, 4_500, 7_000, 8_500];
        for (uint256 i = 0; i < targets.length; i++) {
            uint256 id = _newMarketAt(targets[i]);
            // Within a tenth of a percent; reserves are integers.
            assertApproxEqAbs(market.yesPriceBps(id), targets[i], 10);
        }
    }

    function test_evenMoneyStillSeedsEqualReserves() public {
        uint256 id = _newMarketAt(5_000);
        (uint256 yes, uint256 no,) = _pool(id);
        assertEq(yes, no);
        assertEq(market.yesPriceBps(id), 5_000);
    }

    /**
     * The other half of quoting a view: whatever the pool does not take is the
     * maker's own position. Opening a market at 85% leaves them holding YES.
     */
    function test_makerKeepsThePositionImpliedByTheirPrice() public {
        uint256 id = _newMarketAt(8_500);
        assertGt(market.yesShares(id, maker), 0, "a bullish maker should hold YES");
        assertEq(market.noShares(id, maker), 0);

        uint256 bearish = _newMarketAt(1_200);
        assertGt(market.noShares(bearish, maker), 0, "a bearish maker should hold NO");
        assertEq(market.yesShares(bearish, maker), 0);
    }

    /**
     * The invariant must survive an asymmetric seed: every minted share is
     * still accounted for, whether it sits in the pool or in the maker's own
     * balance.
     */
    function test_asymmetricSeedStaysFullyCollateralised() public {
        uint256 id = _newMarketAt(8_500);
        _assertFullyCollateralised(id, _holders());

        _buy(id, alice, false, 200e6);
        _assertFullyCollateralised(id, _holders());
    }

    /// Both ends would collapse the constant product, so they are refused.
    function test_rejectsOpeningPricesAtTheExtremes() public {
        for (uint256 i = 0; i < 4; i++) {
            uint256 bad = [uint256(0), 99, 9_901, 10_000][i];
            vm.prank(maker);
            vm.expectRevert(AmmMarket.BadOpeningPrice.selector);
            market.newMarket(
                "bad", AmmMarket.Asset.BTC, STRIKE, closeTime, expiryTime, LIQUIDITY, bad
            );
        }
    }

    /**
     * A market opened away from even money still pays out correctly, and the
     * maker's own seeded position redeems like anyone else's.
     */
    function testFuzz_asymmetricSeedRemainsPayable(uint96 amount, bool isYes, uint16 openingBps)
        public
    {
        vm.assume(amount > 1e6 && amount < 50_000e6);
        uint256 opening = 100 + (uint256(openingBps) % 9_800);

        uint256 id = _newMarketAt(opening);
        _buy(id, alice, isYes, amount);
        _assertFullyCollateralised(id, _holders());

        _settle(id, AmmMarket.Outcome.Yes);

        address[2] memory who = [alice, maker];
        for (uint256 i = 0; i < who.length; i++) {
            if (market.yesShares(id, who[i]) == 0) continue;
            vm.prank(who[i]);
            market.redeem(id);
        }
        // The pool's leftover winning side belongs to the maker, whatever the
        // market last priced at.
        (uint256 yesReserve,,) = _pool(id);
        if (yesReserve > 0) {
            vm.prank(maker);
            market.withdrawMakerLiquidity(id);
        }
        assertLe(token.balanceOf(address(market)), 3, "left more than rounding dust");
    }

    // --- selling: the exit that makes a locked price mean something ---------

    /**
     * Buy and immediately sell back. You must never get more than you paid —
     * that would be free money minted from rounding, and the pool would drain
     * a little on every round trip until it could not pay a claim.
     */
    function test_roundTripNeverReturnsMoreThanWasPaid() public {
        uint256 id = _newMarket();
        uint256 paid = 100e6;
        uint256 shares = _buy(id, alice, true, paid);

        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        uint256 back = market.sell(id, true, shares, 0);

        assertLe(back, paid, "round trip returned more than it cost");
        assertEq(token.balanceOf(alice) - before, back);
    }

    /// Selling into a position you are up on realises the gain before expiry.
    function test_sellRealisesAGainWithoutWaitingForSettlement() public {
        uint256 id = _newMarket();
        uint256 shares = _buy(id, alice, true, 100e6);

        // The market moves alice's way — someone else buys the same side.
        _buy(id, bob, true, 600e6);

        vm.prank(alice);
        uint256 back = market.sell(id, true, shares, 0);
        assertGt(back, 100e6, "should be able to take a profit early");
    }

    /// And selling out of a losing position cuts it, rather than riding to zero.
    function test_sellCutsALosingPositionEarly() public {
        uint256 id = _newMarket();
        uint256 shares = _buy(id, alice, true, 100e6);

        // The market moves against alice.
        _buy(id, bob, false, 600e6);

        vm.prank(alice);
        uint256 back = market.sell(id, true, shares, 0);
        assertLt(back, 100e6, "a losing exit should return less than was paid");
        assertGt(back, 0, "but something, not nothing");
    }

    function test_sellMovesThePriceBack() public {
        uint256 id = _newMarket();
        uint256 shares = _buy(id, alice, true, 300e6);
        uint256 peak = market.yesPriceBps(id);

        vm.prank(alice);
        market.sell(id, true, shares, 0);

        assertLt(market.yesPriceBps(id), peak, "selling YES must lower the YES price");
    }

    function test_quoteSellMatchesWhatSellGives() public {
        uint256 id = _newMarket();
        uint256 shares = _buy(id, alice, true, 250e6);

        uint256 quoted = market.quoteSell(id, true, shares);
        vm.prank(alice);
        assertEq(market.sell(id, true, shares, 0), quoted);
    }

    function test_sell_respectsSlippageBound() public {
        uint256 id = _newMarket();
        uint256 shares = _buy(id, alice, true, 100e6);
        uint256 quoted = market.quoteSell(id, true, shares);

        vm.prank(alice);
        vm.expectRevert(AmmMarket.SlippageTooHigh.selector);
        market.sell(id, true, shares, quoted + 1);
    }

    function test_sell_rejectsMoreSharesThanHeld() public {
        uint256 id = _newMarket();
        uint256 shares = _buy(id, alice, true, 50e6);

        vm.prank(alice);
        vm.expectRevert(AmmMarket.NotEnoughShares.selector);
        market.sell(id, true, shares + 1, 0);
    }

    function test_sell_rejectedOnSomeoneElsesShares() public {
        uint256 id = _newMarket();
        _buy(id, alice, true, 50e6);

        vm.prank(bob);
        vm.expectRevert(AmmMarket.NotEnoughShares.selector);
        market.sell(id, true, 1e6, 0);
    }

    function test_sell_rejectedAfterTradingCloses() public {
        uint256 id = _newMarket();
        uint256 shares = _buy(id, alice, true, 50e6);

        vm.warp(closeTime);
        vm.prank(alice);
        vm.expectRevert(AmmMarket.TooLate.selector);
        market.sell(id, true, shares, 0);
    }

    /// Selling burns complete sets, so the collateral figure has to fall with it.
    function test_sellKeepsEverythingCollateralised() public {
        uint256 id = _newMarket();
        uint256 shares = _buy(id, alice, true, 400e6);
        _buy(id, bob, false, 150e6);
        _assertFullyCollateralised(id, _holders());

        vm.prank(alice);
        market.sell(id, true, shares / 2, 0);
        _assertFullyCollateralised(id, _holders());

        vm.prank(alice);
        market.sell(id, true, shares / 2, 0);
        _assertFullyCollateralised(id, _holders());
    }

    // --- lifecycle guards ---------------------------------------------------

    function test_buy_rejectedAtCloseTime() public {
        uint256 id = _newMarket();
        vm.warp(closeTime);
        vm.prank(alice);
        vm.expectRevert(AmmMarket.TooLate.selector);
        market.buy(id, true, 10e6, 0);
    }

    function test_newMarket_rejectsZeroLiquidity() public {
        vm.prank(maker);
        vm.expectRevert(AmmMarket.NoLiquidity.selector);
        market.newMarket("bad", AmmMarket.Asset.BTC, STRIKE, closeTime, expiryTime, 0, 5_000);
    }

    function test_newMarket_rejectsZeroStrike() public {
        vm.prank(maker);
        vm.expectRevert(AmmMarket.BadStrike.selector);
        market.newMarket("bad", AmmMarket.Asset.BTC, 0, closeTime, expiryTime, LIQUIDITY, 5_000);
    }

    function test_newMarket_rejectsCloseAfterExpiry() public {
        vm.prank(maker);
        vm.expectRevert(AmmMarket.BadExpiry.selector);
        market.newMarket("bad", AmmMarket.Asset.BTC, STRIKE, expiryTime + 1, expiryTime, LIQUIDITY, 5_000);
    }

    function test_redeem_rejectsSecondAttempt() public {
        uint256 id = _newMarket();
        _buy(id, alice, true, 100e6);
        _settle(id, AmmMarket.Outcome.Yes);

        vm.prank(alice);
        market.redeem(id);
        vm.prank(alice);
        vm.expectRevert(AmmMarket.AlreadyRedeemed.selector);
        market.redeem(id);
    }

    function test_makerWithdraw_onlyByMaker() public {
        uint256 id = _newMarket();
        _settle(id, AmmMarket.Outcome.Yes);
        vm.prank(alice);
        vm.expectRevert(AmmMarket.BadStatus.selector);
        market.withdrawMakerLiquidity(id);
    }

    function test_settle_rejectsWrongAuthor() public {
        uint256 id = _newMarket();
        vm.warp(expiryTime + market.SETTLEMENT_DELAY());
        market.requestSettlement(id);

        vm.prank(forwarder);
        vm.expectRevert();
        market.onReport(
            abi.encodePacked(bytes32(0), wfName, address(0xBAD)),
            abi.encode(id, uint8(1), int256(0), bytes32("ev"))
        );
    }

    function test_requestSettlement_rejectedBeforeDelay() public {
        uint256 id = _newMarket();
        vm.warp(expiryTime + market.SETTLEMENT_DELAY() - 1);
        vm.expectRevert(AmmMarket.TooEarly.selector);
        market.requestSettlement(id);
    }

    // --- fuzz ---------------------------------------------------------------

    /**
     * The rounding direction, fuzzed. A sale may never leave the pool shallower
     * than it found it — get this backwards and the pool pays out slightly too
     * much on every single trade.
     */
    function testFuzz_sellNeverShrinksTheProduct(uint96 buyAmount, uint8 sellPct, bool isYes)
        public
    {
        vm.assume(buyAmount > 1e6 && buyAmount < 50_000e6);

        uint256 id = _newMarket();
        uint256 shares = _buy(id, alice, isYes, buyAmount);
        uint256 toSell = (shares * (uint256(sellPct) % 100 + 1)) / 100;
        vm.assume(toSell > 0);

        (uint256 y0, uint256 n0,) = _pool(id);
        uint256 kBefore = y0 * n0;

        vm.prank(alice);
        market.sell(id, isYes, toSell, 0);

        (uint256 y1, uint256 n1,) = _pool(id);
        assertGe(y1 * n1, kBefore, "a sale must never drain the pool");
        _assertFullyCollateralised(id, _holders());
    }

    /**
     * No sequence of trades may mint value out of nothing: whatever alice ends
     * up holding plus whatever she sold back must never exceed what she put in,
     * as long as the market has not moved in her favour in between.
     */
    function testFuzz_roundTripIsNeverProfitableOnItsOwn(uint96 amount, bool isYes) public {
        vm.assume(amount > 1e6 && amount < 50_000e6);

        uint256 id = _newMarket();
        uint256 shares = _buy(id, alice, isYes, amount);

        vm.prank(alice);
        uint256 back = market.sell(id, isYes, shares, 0);

        assertLe(back, amount, "buying and selling back created money");
    }

    /**
     * Solvency under arbitrary trading. Any sequence of buys on either side
     * must leave every share backed, and must leave the contract able to pay
     * every claim against it.
     */
    function testFuzz_collateralisationSurvivesArbitraryTrades(
        uint96 a,
        uint96 b,
        uint96 c,
        bool sideA,
        bool sideB,
        bool sideC
    ) public {
        vm.assume(a > 0 && b > 0 && c > 0);
        vm.assume(a < 50_000e6 && b < 50_000e6 && c < 50_000e6);

        uint256 id = _newMarket();
        _buy(id, alice, sideA, a);
        _buy(id, bob, sideB, b);
        _buy(id, alice, sideC, c);

        _assertFullyCollateralised(id, _holders());
    }

    /**
     * The pool must never hand out shares it cannot back. Rounding is done so
     * that any error favours the pool, so the constant product may only ever
     * grow.
     */
    function testFuzz_productNeverShrinks(uint96 amount, bool isYes) public {
        vm.assume(amount > 0 && amount < 50_000e6);

        uint256 id = _newMarket();
        (uint256 yes0, uint256 no0,) = _pool(id);
        uint256 kBefore = yes0 * no0;

        _buy(id, alice, isYes, amount);

        (uint256 yes1, uint256 no1,) = _pool(id);
        assertGe(yes1 * no1, kBefore, "rounding must never favour the buyer");
    }

    /**
     * Whatever happens, everyone can be paid. Redeem every holder and the
     * maker, and assert the contract never reverts for want of funds.
     */
    function testFuzz_everyClaimIsPayable(uint96 a, uint96 b, bool sideA, bool sideB, uint8 result)
        public
    {
        vm.assume(a > 0 && b > 0);
        vm.assume(a < 50_000e6 && b < 50_000e6);

        // Void included deliberately: fuzzing only Yes/No is exactly what let
        // an insolvent void payout through the first time.
        AmmMarket.Outcome outcome = [
            AmmMarket.Outcome.Yes,
            AmmMarket.Outcome.No,
            AmmMarket.Outcome.Void
        ][result % 3];

        uint256 id = _newMarket();
        _buy(id, alice, sideA, a);
        _buy(id, bob, sideB, b);
        _settle(id, outcome);

        address[3] memory who = [alice, bob, maker];
        for (uint256 i = 0; i < who.length; i++) {
            uint256 yes = market.yesShares(id, who[i]);
            uint256 no = market.noShares(id, who[i]);
            uint256 owed = outcome == AmmMarket.Outcome.Void
                ? (yes + no) / 2
                : (outcome == AmmMarket.Outcome.Yes ? yes : no);
            if (owed == 0) continue;
            vm.prank(who[i]);
            market.redeem(id);
        }

        vm.prank(maker);
        market.withdrawMakerLiquidity(id);

        // Never short. Flooring on a void can strand a unit or two; it can
        // never leave a claim unpayable.
        assertLe(token.balanceOf(address(market)), 3, "left more than rounding dust");
    }
}
