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
    /// A second liquidity provider, so multi-LP paths have someone to be.
    address internal carol = address(0xCA401);

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

        for (uint256 i = 0; i < 4; i++) {
            address who = [maker, alice, bob, carol][i];
            token.mint(who, 100_000e6);
            vm.prank(who);
            token.approve(address(market), type(uint256).max);
        }
    }

    // --- helpers ------------------------------------------------------------

    function _newMarket() internal returns (uint256 id) {
        return _newMarketAt(5_000);
    }

    /**
     * Zero fee by default, deliberately: the arithmetic assertions throughout
     * this file are exact, and a default fee would quietly turn every one of
     * them into an approximation. Fee behaviour is tested by asking for it.
     */
    function _newMarketAt(uint256 openingBps) internal returns (uint256 id) {
        return _newMarketWithFee(openingBps, 0);
    }

    function _newMarketWithFee(uint256 openingBps, uint16 feeBps) internal returns (uint256 id) {
        vm.prank(maker);
        id = market.newMarket(
            "Will BTC be at or above $63,000?",
            AmmMarket.Asset.BTC,
            STRIKE,
            closeTime,
            expiryTime,
            LIQUIDITY,
            openingBps,
            feeBps
        );
    }

    function _addLiquidity(uint256 id, address who, uint256 amount) internal returns (uint256) {
        vm.prank(who);
        return market.addLiquidity(id, amount, 0);
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

    /**
     * Reads BY FIELD, not by position. The old positional destructure would
     * still have compiled against a reshaped tuple and silently read three
     * different numbers, which is exactly why the contract returns a struct.
     */
    function _pool(uint256 id)
        internal
        view
        returns (uint256 yesReserve, uint256 noReserve, uint256 collateral)
    {
        AmmMarket.PoolView memory p = market.poolState(id);
        return (p.yesReserve, p.noReserve, p.collateral);
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

        // An invariant of equal standing: the denominator every provider's
        // claim divides by must be exactly the shares actually issued. If it
        // drifts high, the last provider is short-changed; if it drifts low,
        // the pool pays out more than it holds.
        uint256 lpTotal;
        for (uint256 i = 0; i < holders.length; i++) {
            lpTotal += market.lpShares(id, holders[i]);
        }
        assertEq(lpTotal, market.poolState(id).totalLpShares, "LP shares do not sum to the total");
    }

    function _holders() internal view returns (address[] memory h) {
        h = new address[](4);
        h[0] = maker;
        h[1] = alice;
        h[2] = bob;
        h[3] = carol;
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
        (uint256 quoted,) = market.quote(id, true, 123e6);
        assertEq(_buy(id, alice, true, 123e6), quoted);
    }

    function test_buy_respectsSlippageBound() public {
        uint256 id = _newMarket();
        (uint256 quoted,) = market.quote(id, true, 100e6);

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
        market.withdrawLiquidity(id);

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
        market.withdrawLiquidity(id);

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
        market.withdrawLiquidity(id);

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
        market.withdrawLiquidity(id);

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
        market.withdrawLiquidity(id);

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
                "bad", AmmMarket.Asset.BTC, STRIKE, closeTime, expiryTime, LIQUIDITY, bad, 0
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
            market.withdrawLiquidity(id);
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

        (uint256 quoted,) = market.quoteSell(id, true, shares);
        vm.prank(alice);
        assertEq(market.sell(id, true, shares, 0), quoted);
    }

    function test_sell_respectsSlippageBound() public {
        uint256 id = _newMarket();
        uint256 shares = _buy(id, alice, true, 100e6);
        (uint256 quoted,) = market.quoteSell(id, true, shares);

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
        market.newMarket("bad", AmmMarket.Asset.BTC, STRIKE, closeTime, expiryTime, 0, 5_000, 0);
    }

    function test_newMarket_rejectsZeroStrike() public {
        vm.prank(maker);
        vm.expectRevert(AmmMarket.BadStrike.selector);
        market.newMarket("bad", AmmMarket.Asset.BTC, 0, closeTime, expiryTime, LIQUIDITY, 5_000, 0);
    }

    function test_newMarket_rejectsCloseAfterExpiry() public {
        vm.prank(maker);
        vm.expectRevert(AmmMarket.BadExpiry.selector);
        market.newMarket(
            "bad", AmmMarket.Asset.BTC, STRIKE, expiryTime + 1, expiryTime, LIQUIDITY, 5_000, 0
        );
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

    /// Holding shares is not the same as having provided liquidity.
    function test_withdraw_rejectedForNonProvider() public {
        uint256 id = _newMarket();
        _buy(id, alice, true, 100e6);
        _settle(id, AmmMarket.Outcome.Yes);
        vm.prank(alice);
        vm.expectRevert(AmmMarket.NotAnLp.selector);
        market.withdrawLiquidity(id);
    }

    function test_withdraw_rejectsSecondAttempt() public {
        uint256 id = _newMarketAt(7_000);
        _settle(id, AmmMarket.Outcome.Yes);

        vm.prank(maker);
        market.withdrawLiquidity(id);
        vm.prank(maker);
        vm.expectRevert(AmmMarket.AlreadyWithdrawn.selector);
        market.withdrawLiquidity(id);
    }

    function test_withdraw_rejectedWhileOpen() public {
        uint256 id = _newMarket();
        vm.prank(maker);
        vm.expectRevert(AmmMarket.BadStatus.selector);
        market.withdrawLiquidity(id);
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

    // --- multiple liquidity providers ---------------------------------------

    /**
     * The defining property of adding liquidity: depth goes up, price does not
     * move. If it moved, a deposit would be a trade against everyone already
     * holding — which is what scaling both reserves by a common factor avoids.
     */
    function test_addLiquidity_doesNotMoveThePrice() public {
        uint256[5] memory openings = [uint256(1_200), 2_500, 5_000, 7_000, 8_500];
        for (uint256 i = 0; i < openings.length; i++) {
            uint256 id = _newMarketAt(openings[i]);
            uint256 before = market.yesPriceBps(id);

            _addLiquidity(id, carol, 500e6);

            assertApproxEqAbs(market.yesPriceBps(id), before, 1, "deposit moved the price");
        }
    }

    /// Even after the book has been pushed around, a deposit is still neutral.
    function test_addLiquidity_doesNotMoveThePriceAfterTrading() public {
        uint256 id = _newMarket();
        _buy(id, alice, true, 300e6);
        uint256 before = market.yesPriceBps(id);

        _addLiquidity(id, carol, 750e6);

        assertApproxEqAbs(market.yesPriceBps(id), before, 1, "deposit moved the price");
    }

    /**
     * The surprising half of providing liquidity here. The pool can only take
     * the deposit in its own ratio, so what it cannot absorb stays with the
     * depositor as a real directional position — the same thing that happens
     * to a creator who opens away from even money.
     */
    function test_addLiquidity_handsTheDepositorTheResidualPosition() public {
        uint256 id = _newMarketAt(8_500);
        _addLiquidity(id, carol, 500e6);

        // Bullish book: the pool is short YES, so the depositor keeps YES.
        assertGt(market.yesShares(id, carol), 0, "no residual YES position");
        assertEq(market.noShares(id, carol), 0, "should not hold the deep side");
        _assertFullyCollateralised(id, _holders());
    }

    function test_addLiquidity_quoteMatchesWhatDepositingGives() public {
        uint256 id = _newMarketAt(7_000);
        (uint256 quotedShares, uint256 quotedYes, uint256 quotedNo) =
            market.quoteAddLiquidity(id, 400e6);

        uint256 minted = _addLiquidity(id, carol, 400e6);

        assertEq(minted, quotedShares, "quoted LP shares differ from minted");
        assertEq(market.yesShares(id, carol), quotedYes, "quoted YES residual differs");
        assertEq(market.noShares(id, carol), quotedNo, "quoted NO residual differs");
    }

    /// Depositing what the market was seeded with buys half of it.
    function test_addLiquidity_mintsProportionalLpShares() public {
        uint256 id = _newMarket();
        uint256 minted = _addLiquidity(id, carol, LIQUIDITY);

        AmmMarket.PoolView memory p = market.poolState(id);
        assertApproxEqAbs(minted, p.totalLpShares / 2, 1, "equal money should buy half the pool");
        assertEq(market.lpShares(id, maker), LIQUIDITY, "the creator's stake changed");
    }

    function test_addLiquidity_respectsMinLpSharesOut() public {
        uint256 id = _newMarket();
        (uint256 quoted,,) = market.quoteAddLiquidity(id, 100e6);

        vm.prank(carol);
        vm.expectRevert(AmmMarket.SlippageTooHigh.selector);
        market.addLiquidity(id, 100e6, quoted + 1);
    }

    /**
     * A deposit too small for the pool's skew would land on one side only,
     * moving the price — and it is the same condition that mints nothing, so
     * one revert covers both.
     */
    function test_addLiquidity_rejectsDustThatWouldMintZeroShares() public {
        uint256 id = _newMarketAt(9_900);
        vm.prank(carol);
        vm.expectRevert(AmmMarket.NoLiquidity.selector);
        market.addLiquidity(id, 1, 0);
    }

    function test_addLiquidity_rejectsZeroAmount() public {
        uint256 id = _newMarket();
        vm.prank(carol);
        vm.expectRevert(AmmMarket.NoLiquidity.selector);
        market.addLiquidity(id, 0, 0);
    }

    function test_addLiquidity_rejectedAfterTradingCloses() public {
        uint256 id = _newMarket();
        vm.warp(closeTime);
        vm.prank(carol);
        vm.expectRevert(AmmMarket.TooLate.selector);
        market.addLiquidity(id, 100e6, 0);
    }

    function test_addLiquidity_rejectedOnceSettled() public {
        uint256 id = _newMarket();
        _settle(id, AmmMarket.Outcome.Yes);
        vm.prank(carol);
        vm.expectRevert(AmmMarket.BadStatus.selector);
        market.addLiquidity(id, 100e6, 0);
    }

    /// Two providers, 2:1 money in, 2:1 out — and never more than the pool holds.
    function test_twoLpsSplitTheWinningReserveProRata() public {
        uint256 id = _newMarket();
        _addLiquidity(id, carol, LIQUIDITY / 2);
        _buy(id, alice, true, 200e6);
        _settle(id, AmmMarket.Outcome.No);

        (, uint256 noReserve,) = _pool(id);

        vm.prank(maker);
        uint256 makerOut = market.withdrawLiquidity(id);
        vm.prank(carol);
        uint256 carolOut = market.withdrawLiquidity(id);

        assertApproxEqAbs(makerOut, carolOut * 2, 2, "claims are not 2:1");
        assertLe(makerOut + carolOut, noReserve, "providers drew more than the pool held");
    }

    /**
     * A provider has two claims and two guards, and neither consumes the other.
     * Getting this wrong leaves money on chain permanently, since both flags
     * are irreversible.
     */
    function test_lpRedeemsResidualSharesSeparatelyFromTheirPoolClaim() public {
        uint256 id = _newMarketAt(8_500);
        _addLiquidity(id, carol, 500e6);
        _settle(id, AmmMarket.Outcome.Yes);

        uint256 before = token.balanceOf(carol);

        vm.prank(carol);
        uint256 poolClaim = market.withdrawLiquidity(id);
        vm.prank(carol);
        market.redeem(id);

        uint256 received = token.balanceOf(carol) - before;
        assertGt(poolClaim, 0, "pool claim was empty");
        assertGt(received, poolClaim, "redeeming the residual added nothing");
    }

    function test_lpPositionViewMatchesWhatWithdrawPays() public {
        uint256 id = _newMarketAt(3_000);
        _addLiquidity(id, carol, 400e6);
        _buy(id, alice, false, 150e6);
        _settle(id, AmmMarket.Outcome.No);

        (uint256 shares, uint256 total, bool withdrawn, uint256 claimable) =
            market.lpPosition(id, carol);
        assertGt(shares, 0);
        assertEq(total, market.poolState(id).totalLpShares);
        assertFalse(withdrawn);

        vm.prank(carol);
        assertEq(market.withdrawLiquidity(id), claimable, "view disagreed with the payout");
        (,, bool after_,) = market.lpPosition(id, carol);
        assertTrue(after_, "withdrawal not reflected");
    }

    /// The creator is the first provider and nothing more.
    function test_creatorHasNoSpecialPowers() public {
        uint256 id = _newMarket();
        _addLiquidity(id, carol, 300e6);
        _settle(id, AmmMarket.Outcome.Yes);

        // The creator cannot reach anyone else's stake; they draw their own.
        vm.prank(maker);
        uint256 makerOut = market.withdrawLiquidity(id);
        vm.prank(carol);
        uint256 carolOut = market.withdrawLiquidity(id);

        assertGt(carolOut, 0, "a non-creator provider could not withdraw");
        (uint256 yesReserve,,) = _pool(id);
        assertLe(makerOut + carolOut, yesReserve, "drew more than the pool held");
    }

    function test_newMarket_rejectsLiquidityBelowMinimum() public {
        vm.prank(maker);
        vm.expectRevert(AmmMarket.NoLiquidity.selector);
        market.newMarket(
            "dust", AmmMarket.Asset.BTC, STRIKE, closeTime, expiryTime, 1e6 - 1, 5_000, 0
        );
    }

    // --- the trading fee ----------------------------------------------------

    function test_newMarket_rejectsFeeAboveBound() public {
        vm.prank(maker);
        vm.expectRevert(AmmMarket.BadFee.selector);
        market.newMarket(
            "greedy", AmmMarket.Asset.BTC, STRIKE, closeTime, expiryTime, LIQUIDITY, 5_000, 501
        );
    }

    /**
     * The fee is retained as complete sets rather than moved anywhere, so it
     * shows up as a product that grows on both a buy and a sell. That growth
     * IS the LP's income; there is no separate balance to distribute.
     */
    function test_feeMakesTheProductGrowStrictly() public {
        uint256 id = _newMarketWithFee(5_000, 100);

        (uint256 y0, uint256 n0,) = _pool(id);
        uint256 shares = _buy(id, alice, true, 200e6);
        (uint256 y1, uint256 n1,) = _pool(id);
        assertGt(y1 * n1, y0 * n0, "a buy did not grow the product");

        vm.prank(alice);
        market.sell(id, true, shares / 2, 0);
        (uint256 y2, uint256 n2,) = _pool(id);
        assertGt(y2 * n2, y1 * n1, "a sale did not grow the product");

        _assertFullyCollateralised(id, _holders());
    }

    function test_quoteMirrorsTheFee() public {
        uint256 id = _newMarketWithFee(5_000, 250);
        (uint256 quoted, uint256 fee) = market.quote(id, true, 100e6);

        assertEq(fee, 2.5e6, "fee is not 2.5% of the amount");
        assertEq(_buy(id, alice, true, 100e6), quoted, "quote and fill disagree");
    }

    function test_quoteSellMirrorsTheFee() public {
        uint256 id = _newMarketWithFee(5_000, 250);
        uint256 shares = _buy(id, alice, true, 100e6);

        (uint256 quoted, uint256 fee) = market.quoteSell(id, true, shares);
        assertGt(fee, 0, "no fee charged on the exit");

        vm.prank(alice);
        assertEq(market.sell(id, true, shares, 0), quoted, "quote and fill disagree");
    }

    /**
     * THE LOAD-BEARING TEST FOR THE WHOLE FEE DESIGN. Fees inflate the reserves
     * without minting LP shares, so a later provider's money buys proportionally
     * fewer shares — they are buying in at the already-earned price. Nothing
     * checkpoints this; it falls out of minting against the current reserves.
     */
    function test_lateLpDoesNotShareEarlierFees() public {
        uint256 id = _newMarketWithFee(5_000, 500);

        // Volume before the second provider arrives.
        for (uint256 i = 0; i < 5; i++) {
            uint256 got = _buy(id, alice, true, 100e6);
            vm.prank(alice);
            market.sell(id, true, got, 0);
        }

        _addLiquidity(id, carol, LIQUIDITY);
        _settle(id, AmmMarket.Outcome.Yes);

        vm.prank(maker);
        uint256 makerOut = market.withdrawLiquidity(id);
        vm.prank(carol);
        uint256 carolOut = market.withdrawLiquidity(id);

        assertGt(makerOut, carolOut, "a late provider collected fees earned before they arrived");
    }

    /**
     * Retained sets sit in BOTH reserves, so the fee comes back whichever side
     * wins — and on a void, where each side is halved, `(f + f) / 2` is still f.
     */
    function test_feeAccruesToLpsWhicheverSideWins() public {
        AmmMarket.Outcome[3] memory outcomes =
            [AmmMarket.Outcome.Yes, AmmMarket.Outcome.No, AmmMarket.Outcome.Void];

        for (uint256 i = 0; i < outcomes.length; i++) {
            // Each pass settles, which warps the clock past this market's own
            // expiry; the next pass needs to start from the top again.
            vm.warp(1_700_000_000);
            uint256 id = _newMarketWithFee(5_000, 500);

            // Round trips leave the book where it started, so anything the sole
            // provider recovers above the seed is fee income and nothing else.
            for (uint256 j = 0; j < 4; j++) {
                uint256 got = _buy(id, alice, j % 2 == 0, 100e6);
                vm.prank(alice);
                market.sell(id, j % 2 == 0, got, 0);
            }

            _settle(id, outcomes[i]);

            // Opened at even money, so the provider holds no residual shares:
            // the pool claim alone is the whole of what they get back, and
            // anything above the seed is fee income.
            vm.prank(maker);
            uint256 recovered = market.withdrawLiquidity(id);

            assertGt(recovered, LIQUIDITY, "fees did not reach the provider");
        }
    }

    /**
     * The exact fill this contract produced on Sepolia, pinned so a refactor
     * that changes behaviour at zero fee cannot pass quietly: opened at 5000
     * bps on a 10 mUSDC seed, a 3 mUSDC buy returned 5,307,692 shares and left
     * the price at 6282 bps.
     */
    function test_zeroFeeReproducesTheKnownSepoliaFill() public {
        vm.prank(maker);
        uint256 id = market.newMarket(
            "Will BTC be at or above $63,000?",
            AmmMarket.Asset.BTC,
            STRIKE,
            closeTime,
            expiryTime,
            10e6,
            5_000,
            0
        );

        assertEq(_buy(id, alice, true, 3e6), 5_307_692, "fill changed");
        assertEq(market.yesPriceBps(id), 6_282, "resulting price changed");
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
        market.withdrawLiquidity(id);

        // Never short. Flooring on a void can strand a unit or two; it can
        // never leave a claim unpayable.
        assertLe(token.balanceOf(address(market)), 3, "left more than rounding dust");
    }

    /// A deposit of any size into any book leaves the price where it found it.
    function testFuzz_addLiquidityNeverMovesThePrice(
        uint96 deposit,
        uint16 openingBps,
        uint96 tradeBefore
    ) public {
        vm.assume(deposit > 1e6 && deposit < 50_000e6);
        vm.assume(tradeBefore < 50_000e6);
        uint256 opening = 100 + (uint256(openingBps) % 9_800);

        uint256 id = _newMarketAt(opening);
        if (tradeBefore > 1e6) _buy(id, alice, tradeBefore % 2 == 0, tradeBefore);

        uint256 before = market.yesPriceBps(id);
        _addLiquidity(id, carol, deposit);

        assertApproxEqAbs(market.yesPriceBps(id), before, 1, "deposit moved the price");
    }

    /// Deposits interleaved with trades never break the backing of a share.
    function testFuzz_collateralisationSurvivesLiquidityAndTrades(
        uint96 a,
        uint96 deposit,
        uint96 b,
        bool sideA,
        bool sideB,
        uint16 feeBps
    ) public {
        // Bounded rather than assumed: three narrow windows over uint96 are
        // rare enough together that the fuzzer runs out of rejections before
        // it finds enough valid cases.
        uint256 amountA = bound(a, 1e6, 50_000e6);
        uint256 amountB = bound(b, 1e6, 50_000e6);
        uint256 provided = bound(deposit, 1e6, 50_000e6);

        uint256 id = _newMarketWithFee(5_000, uint16(feeBps % 501));
        _buy(id, alice, sideA, amountA);
        _assertFullyCollateralised(id, _holders());

        _addLiquidity(id, carol, provided);
        _assertFullyCollateralised(id, _holders());

        _buy(id, bob, sideB, amountB);
        _assertFullyCollateralised(id, _holders());
    }

    /**
     * The multi-LP descendant of the test that caught the insolvent void.
     * VOID IS IN THE ROTATION DELIBERATELY: the pro-rata claim has its own way
     * to go wrong there — halving the reserves and then dividing by the share
     * total is not the same expression as doing it the other way round, and
     * any ceiling that creeps into either makes the last claimant unpayable.
     */
    function testFuzz_everyClaimIsPayableWithMultipleLps(
        uint96 a,
        uint96 b,
        uint96 deposit,
        uint8 result
    ) public {
        uint256 amountA = bound(a, 1e6, 50_000e6);
        uint256 amountB = bound(b, 1e6, 50_000e6);
        uint256 provided = bound(deposit, 1e6, 50_000e6);

        AmmMarket.Outcome outcome = [
            AmmMarket.Outcome.Yes,
            AmmMarket.Outcome.No,
            AmmMarket.Outcome.Void
        ][result % 3];

        uint256 id = _newMarketWithFee(5_000, 30);
        _addLiquidity(id, carol, provided);
        _buy(id, alice, true, amountA);
        _buy(id, bob, false, amountB);
        _settle(id, outcome);

        address[4] memory who = [alice, bob, maker, carol];
        for (uint256 i = 0; i < who.length; i++) {
            uint256 yes = market.yesShares(id, who[i]);
            uint256 no = market.noShares(id, who[i]);
            uint256 owed = outcome == AmmMarket.Outcome.Void
                ? (yes + no) / 2
                : (outcome == AmmMarket.Outcome.Yes ? yes : no);
            if (owed > 0) {
                vm.prank(who[i]);
                market.redeem(id);
            }
        }

        vm.prank(maker);
        market.withdrawLiquidity(id);
        vm.prank(carol);
        market.withdrawLiquidity(id);

        // One floored division per claimant, so at most one unit each can be
        // stranded — four claimants here, plus the void's own halving. The
        // bound is derived, not raised until it passed.
        assertLe(token.balanceOf(address(market)), 6, "left more than rounding dust");
    }

    /// Providers can never collectively draw more than the pool actually holds.
    function testFuzz_lpWithdrawalsNeverExceedTheWinningReserve(
        uint96 deposit,
        uint96 trade,
        bool side
    ) public {
        vm.assume(deposit > 1e6 && deposit < 50_000e6);
        vm.assume(trade > 1e6 && trade < 50_000e6);

        uint256 id = _newMarketWithFee(5_000, 30);
        _addLiquidity(id, carol, deposit);
        _buy(id, alice, side, trade);
        _settle(id, AmmMarket.Outcome.Yes);

        (uint256 yesReserve,,) = _pool(id);

        vm.prank(maker);
        uint256 makerOut = market.withdrawLiquidity(id);
        vm.prank(carol);
        uint256 carolOut = market.withdrawLiquidity(id);

        assertLe(makerOut + carolOut, yesReserve, "providers drew more than the reserve");
    }

    /// Whatever the fee, the quote is what the trade actually does.
    function testFuzz_quoteEqualsExecutionUnderAnyFee(uint96 amount, uint16 feeBps, bool isYes)
        public
    {
        vm.assume(amount > 1e6 && amount < 50_000e6);

        uint256 id = _newMarketWithFee(5_000, uint16(feeBps % 501));

        (uint256 quotedBuy,) = market.quote(id, isYes, amount);
        uint256 got = _buy(id, alice, isYes, amount);
        assertEq(got, quotedBuy, "buy quote drifted from the fill");

        (uint256 quotedSell,) = market.quoteSell(id, isYes, got);
        vm.prank(alice);
        assertEq(market.sell(id, isYes, got, 0), quotedSell, "sell quote drifted from the fill");
    }

    /// The fee can only ever add depth, never take it.
    function testFuzz_feeNeverShrinksTheProduct(uint96 amount, uint16 feeBps, bool isYes) public {
        vm.assume(amount > 1e6 && amount < 50_000e6);

        uint256 id = _newMarketWithFee(5_000, uint16(feeBps % 501));

        (uint256 y0, uint256 n0,) = _pool(id);
        uint256 got = _buy(id, alice, isYes, amount);
        (uint256 y1, uint256 n1,) = _pool(id);
        assertGe(y1 * n1, y0 * n0, "the buy shrank the product");

        vm.prank(alice);
        market.sell(id, isYes, got, 0);
        (uint256 y2, uint256 n2,) = _pool(id);
        assertGe(y2 * n2, y1 * n1, "the sale shrank the product");
    }
}
