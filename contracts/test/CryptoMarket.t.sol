// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CryptoMarket} from "../src/CryptoMarket.sol";
import {ParimutuelMarket} from "../src/ParimutuelMarket.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ReceiverTemplate} from "../src/interfaces/ReceiverTemplate.sol";

contract CryptoMarketTest is Test {
    CryptoMarket internal market;
    MockUSDC internal token;

    address internal forwarder = address(0xF0);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    string internal constant WF_NAME_STR = "crypto-settlement-staging";
    address internal wfAuthor;
    bytes10 internal wfName;

    // $63,000.00 at 8 decimals — the Chainlink/exchange convention.
    uint64 internal constant STRIKE = 6_300_000_000_000;

    uint64 internal closeTime;
    uint64 internal expiryTime;

    event SettlementRequested(
        uint256 indexed marketId, uint8 asset, uint64 strikePrice, uint64 expiryTime
    );
    event Settled(
        uint256 indexed marketId,
        ParimutuelMarket.Outcome outcome,
        int256 observedValue,
        bytes32 evidenceHash
    );

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new MockUSDC();
        market = new CryptoMarket(IERC20(address(token)), forwarder);

        wfAuthor = address(this);
        market.setExpectedAuthor(wfAuthor);
        market.setExpectedWorkflowName(WF_NAME_STR);
        wfName = market.getExpectedWorkflowName();

        closeTime = uint64(block.timestamp + 5 minutes);
        expiryTime = uint64(block.timestamp + 5 minutes);

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
            "Will BTC be at or above $63,000?", CryptoMarket.Asset.BTC, STRIKE, closeTime, expiryTime
        );
    }

    function _metadata(bytes10 name, address authorAddr) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes32(0), name, authorAddr);
    }

    function _validMetadata() internal view returns (bytes memory) {
        return _metadata(wfName, wfAuthor);
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

    function _requestSettlement(uint256 id) internal {
        vm.warp(expiryTime + market.SETTLEMENT_DELAY());
        market.requestSettlement(id);
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

    // --- creation -----------------------------------------------------------

    function test_newMarket_storesTermsAndOpens() public {
        uint256 id = _newMarket();
        (CryptoMarket.Asset asset, uint64 strike, uint64 expiry) = market.terms(id);

        assertEq(uint8(asset), uint8(CryptoMarket.Asset.BTC));
        assertEq(strike, STRIKE);
        assertEq(expiry, expiryTime);
        assertEq(uint8(_status(id)), uint8(ParimutuelMarket.Status.Open));
        assertEq(market.marketCount(), 1);
    }

    function test_newMarket_rejectsZeroStrike() public {
        vm.expectRevert(CryptoMarket.BadStrike.selector);
        market.newMarket("bad", CryptoMarket.Asset.BTC, 0, closeTime, expiryTime);
    }

    /// Staking must not stay open past expiry, or the result is knowable while
    /// the book is still taking bets.
    function test_newMarket_rejectsCloseAfterExpiry() public {
        vm.expectRevert(CryptoMarket.BadExpiry.selector);
        market.newMarket(
            "bad", CryptoMarket.Asset.BTC, STRIKE, expiryTime + 1 minutes, expiryTime
        );
    }

    function test_newMarket_allowsEthAsset() public {
        uint256 id = market.newMarket(
            "Will ETH be at or above $1,900?",
            CryptoMarket.Asset.ETH,
            190_000_000_000,
            closeTime,
            expiryTime
        );
        (CryptoMarket.Asset asset,,) = market.terms(id);
        assertEq(uint8(asset), uint8(CryptoMarket.Asset.ETH));
    }

    // --- staking ------------------------------------------------------------

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
        vm.expectRevert(ParimutuelMarket.TooLate.selector);
        market.stake(id, true, 100e6);
    }

    // --- settlement request -------------------------------------------------

    function test_requestSettlement_revertsBeforeExpiry() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 100e6);
        vm.expectRevert(ParimutuelMarket.TooEarly.selector);
        market.requestSettlement(id);
    }

    /**
     * The settlement price is the close of the one-minute candle containing
     * expiry, which is not published until that minute ends. Settling exactly
     * at expiry would ask the oracle for data that does not exist yet and void
     * the market for no real reason.
     */
    function test_requestSettlement_heldBackUntilCandleCloses() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 100e6);

        vm.warp(expiryTime);
        vm.expectRevert(ParimutuelMarket.TooEarly.selector);
        market.requestSettlement(id);

        vm.warp(expiryTime + market.SETTLEMENT_DELAY());
        market.requestSettlement(id);
        assertEq(uint8(_status(id)), uint8(ParimutuelMarket.Status.SettlementRequested));
    }

    /// This is the exact log the CRE workflow triggers on.
    function test_requestSettlement_emitsTriggerEvent() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 100e6);
        vm.warp(expiryTime + market.SETTLEMENT_DELAY());

        vm.expectEmit(true, false, false, true, address(market));
        emit SettlementRequested(id, uint8(CryptoMarket.Asset.BTC), STRIKE, expiryTime);
        market.requestSettlement(id);
    }

    // --- report handling ----------------------------------------------------

    function test_onReport_settlesYesWhenPriceAtOrAboveStrike() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 300e6);
        _requestSettlement(id);

        bytes32 evidence = keccak256("evidence");
        vm.prank(forwarder);
        market.onReport(_validMetadata(), _report(id, 1, int256(uint256(STRIKE)), evidence));

        (ParimutuelMarket.Status s, ParimutuelMarket.Outcome o, int256 observed) = _settlement(id);
        assertEq(uint8(s), uint8(ParimutuelMarket.Status.Settled));
        assertEq(uint8(o), uint8(ParimutuelMarket.Outcome.Yes));
        assertEq(observed, int256(uint256(STRIKE)));
    }

    function test_onReport_settlesNoBelowStrike() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 300e6);
        _requestSettlement(id);

        vm.prank(forwarder);
        market.onReport(_validMetadata(), _report(id, 2, 6_299_000_000_000, bytes32(0)));

        (, ParimutuelMarket.Outcome o,) = _settlement(id);
        assertEq(uint8(o), uint8(ParimutuelMarket.Outcome.No));
    }

    function test_onReport_voidOnSourceDisagreement() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 300e6);
        _requestSettlement(id);

        vm.prank(forwarder);
        market.onReport(_validMetadata(), _report(id, 3, 0, bytes32(0)));

        assertEq(uint8(_status(id)), uint8(ParimutuelMarket.Status.Void));
    }

    /// A one-sided book cannot pay out, so it must void even on a decisive price.
    function test_onReport_oneSidedBookVoids() public {
        uint256 id = _newMarket();
        vm.prank(alice);
        market.stake(id, true, 100e6);
        _requestSettlement(id);

        vm.prank(forwarder);
        market.onReport(_validMetadata(), _report(id, 1, int256(uint256(STRIKE)), bytes32(0)));

        assertEq(uint8(_status(id)), uint8(ParimutuelMarket.Status.Void));
    }

    function test_onReport_revertsForNonForwarder() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 100e6);
        _requestSettlement(id);

        bytes memory metadata = _validMetadata();
        bytes memory report = _report(id, 1, int256(uint256(STRIKE)), bytes32(0));
        vm.expectPartialRevert(ReceiverTemplate.InvalidSender.selector);
        market.onReport(metadata, report);
    }

    function test_onReport_revertsForWrongAuthor() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 100e6);
        _requestSettlement(id);

        bytes memory metadata = _metadata(wfName, alice);
        bytes memory report = _report(id, 1, int256(uint256(STRIKE)), bytes32(0));
        vm.prank(forwarder);
        vm.expectPartialRevert(ReceiverTemplate.InvalidAuthor.selector);
        market.onReport(metadata, report);
    }

    function test_onReport_revertsIfNotAwaitingSettlement() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 100e6);

        vm.prank(forwarder);
        vm.expectRevert(ParimutuelMarket.BadStatus.selector);
        market.onReport(_validMetadata(), _report(id, 1, int256(uint256(STRIKE)), bytes32(0)));
    }

    /// Prices are large numbers; the report field must carry them without
    /// truncating. int32 would overflow at ~$21.47 with 8 decimals.
    function test_onReport_handlesLargePrices() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 100e6);
        _requestSettlement(id);

        int256 bigPrice = 12_345_678_900_000_000; // $123,456,789.00
        vm.prank(forwarder);
        market.onReport(_validMetadata(), _report(id, 1, bigPrice, bytes32(0)));

        (,, int256 observed) = _settlement(id);
        assertEq(observed, bigPrice);
    }

    // --- claims -------------------------------------------------------------

    function test_claim_parimutuelPayoutToWinner() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 300e6);
        _requestSettlement(id);

        vm.prank(forwarder);
        market.onReport(_validMetadata(), _report(id, 1, int256(uint256(STRIKE)), bytes32(0)));

        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        market.claim(id);
        assertEq(token.balanceOf(alice) - before, 400e6);
    }

    function test_claim_loserGetsNothing() public {
        uint256 id = _newMarket();
        _stakeBoth(id, 100e6, 300e6);
        _requestSettlement(id);

        vm.prank(forwarder);
        market.onReport(_validMetadata(), _report(id, 1, int256(uint256(STRIKE)), bytes32(0)));

        vm.prank(bob);
        vm.expectRevert(ParimutuelMarket.NothingToClaim.selector);
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
        market.onReport(_validMetadata(), _report(id, 1, int256(uint256(STRIKE)), bytes32(0)));

        vm.startPrank(alice);
        market.claim(id);
        vm.expectRevert(ParimutuelMarket.AlreadyClaimed.selector);
        market.claim(id);
        vm.stopPrank();
    }

    // --- access control -----------------------------------------------------

    function test_ownerVoid_onlyOwner() public {
        uint256 id = _newMarket();
        vm.prank(alice);
        vm.expectPartialRevert(Ownable.OwnableUnauthorizedAccount.selector);
        market.ownerVoid(id);
    }

    // --- fuzz ---------------------------------------------------------------

    /// The pot must always be fully payable and never over-payable.
    function testFuzz_payoutsNeverExceedPot(uint96 yesAmt, uint96 noAmt) public {
        yesAmt = uint96(bound(yesAmt, 1e6, 500e6));
        noAmt = uint96(bound(noAmt, 1e6, 500e6));

        uint256 id = _newMarket();
        _stakeBoth(id, yesAmt, noAmt);
        _requestSettlement(id);

        vm.prank(forwarder);
        market.onReport(_validMetadata(), _report(id, 1, int256(uint256(STRIKE)), bytes32(0)));

        uint256 pot = uint256(yesAmt) + uint256(noAmt);
        assertEq(token.balanceOf(address(market)), pot);

        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        market.claim(id);
        uint256 paid = token.balanceOf(alice) - before;

        assertEq(paid, pot);
        assertEq(token.balanceOf(address(market)), 0);

        vm.prank(bob);
        vm.expectRevert(ParimutuelMarket.NothingToClaim.selector);
        market.claim(id);
    }
}
