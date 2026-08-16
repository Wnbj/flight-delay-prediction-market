// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReceiverTemplate} from "./interfaces/ReceiverTemplate.sol";

/**
 * @title AmmMarket
 * @notice A binary prediction market priced by a constant-product automated
 *         market maker, instead of parimutuel pooling.
 *
 *  WHY THIS EXISTS ALONGSIDE ParimutuelMarket RATHER THAN REPLACING IT:
 *  in a parimutuel market you do not buy at a price, you join a pool. Your
 *  share of the pot is only fixed at settlement, so every later stake on your
 *  own side dilutes you — stake when the odds look good and they can be worse
 *  by the time the market closes, through nothing you did. Here, buying gives
 *  you a fixed number of shares, each redeemable for exactly one unit of
 *  collateral if you are right. Your price is whatever you paid per share, and
 *  nothing anyone does afterwards can change it. That is the whole difference,
 *  and it is a different product rather than a tuning of the old one.
 *
 *  HOW SOLVENCY IS GUARANTEED, not merely tested:
 *  collateral only ever enters by minting COMPLETE SETS — one unit in mints
 *  one YES and one NO. So at all times
 *
 *      totalYesShares == totalNoShares == collateral held for this market
 *
 *  and every share, wherever it sits, is backed by its own unit. Whichever
 *  side wins, the claims against the market are exactly the shares of that
 *  side, which is exactly the collateral. The AMM cannot be drained by a
 *  trade because trading only ever moves shares between the pool and a
 *  trader; it never mints a share without the unit behind it. The fuzz tests
 *  assert this invariant directly rather than sampling outcomes.
 *
 *  ONE LIQUIDITY PROVIDER PER MARKET, deliberately. Multi-LP accounting means
 *  LP share tokens, proportional withdrawal and impermanent-loss handling —
 *  a large surface where mistakes are silent and expensive. The creator seeds
 *  the market and is the counterparty; they redeem whatever of the winning
 *  side the pool still holds. That is a real, bounded risk they take on
 *  knowingly, and it is the honest version of "the house" in this design.
 *
 *  Settlement is deliberately event-compatible with CryptoMarket, so the same
 *  CRE workflow handler settles both — this contract's address is simply added
 *  to that trigger's address list.
 *
 *  NOT AUDITED. POC only.
 */
contract AmmMarket is ReceiverTemplate {
    using SafeERC20 for IERC20;

    // --- types -------------------------------------------------------------

    enum Asset { BTC, ETH }
    enum Status { Open, SettlementRequested, Settled, Void }
    enum Outcome { Unset, Yes, No, Void }

    struct Market {
        string  question;
        Asset   asset;
        uint64  strikePrice;   // 8 decimals
        uint64  closeTime;     // no trading after this
        uint64  expiryTime;    // the price is measured here
        uint64  settleAfter;   // earliest settlement request
        Status  status;
        Outcome outcome;
        int256  observedValue;
        bytes32 evidenceHash;
        address maker;         // the sole liquidity provider
        uint256 yesReserve;    // YES shares held by the pool
        uint256 noReserve;     // NO shares held by the pool
        uint256 collateral;    // complete sets minted == token units held
        bool    makerWithdrawn;
    }

    // --- storage -----------------------------------------------------------

    IERC20 public immutable token;

    uint256 public marketCount;
    /**
     * Internal, with two narrow views below instead of one generated getter.
     * A public getter for a 15-field struct blows the stack even under via_ir,
     * and splitting it the way ParimutuelMarket splits core from terms is
     * better for callers anyway — the UI wants the pool numbers far more often
     * than it wants the question string.
     */
    mapping(uint256 => Market) internal marketData;
    mapping(uint256 => mapping(address => uint256)) public yesShares;
    mapping(uint256 => mapping(address => uint256)) public noShares;
    mapping(uint256 => mapping(address => bool))    public redeemed;

    /// Matches CryptoMarket, so the same oracle path can settle this contract.
    uint64 public constant SETTLEMENT_DELAY = 60;

    // --- events ------------------------------------------------------------

    event MarketCreated(
        uint256 indexed marketId,
        uint8   asset,
        uint64  strikePrice,
        uint64  expiryTime,
        uint256 liquidity
    );
    event Bought(
        uint256 indexed marketId,
        address indexed buyer,
        bool    isYes,
        uint256 collateralIn,
        uint256 sharesOut
    );
    event Settled(uint256 indexed marketId, Outcome outcome, int256 observedValue, bytes32 evidenceHash);
    event Redeemed(uint256 indexed marketId, address indexed holder, uint256 amount);

    /// @dev Byte-identical to CryptoMarket.SettlementRequested on purpose.
    event SettlementRequested(
        uint256 indexed marketId,
        uint8   asset,
        uint64  strikePrice,
        uint64  expiryTime
    );

    // --- errors ------------------------------------------------------------

    error BadStatus();
    error BadExpiry();
    error BadStrike();
    error NoLiquidity();
    error TooLate();
    error TooEarly();
    error NothingToRedeem();
    error AlreadyRedeemed();
    error SlippageTooHigh();

    constructor(IERC20 _token, address _forwarder) ReceiverTemplate(_forwarder) {
        token = _token;
    }

    // --- market lifecycle --------------------------------------------------

    /**
     * @param liquidity collateral the caller seeds the pool with. It mints an
     *                  equal number of YES and NO shares, so the market opens
     *                  at exactly even odds — the maker expresses no view, they
     *                  are providing the ability to trade.
     */
    function newMarket(
        string calldata question,
        Asset asset,
        uint64 strikePrice,
        uint64 closeTime,
        uint64 expiryTime,
        uint256 liquidity
    ) external returns (uint256 marketId) {
        if (strikePrice == 0) revert BadStrike();
        if (closeTime > expiryTime) revert BadExpiry();
        if (liquidity == 0) revert NoLiquidity();

        token.safeTransferFrom(msg.sender, address(this), liquidity);

        marketId = marketCount++;
        Market storage m = marketData[marketId];
        m.question = question;
        m.asset = asset;
        m.strikePrice = strikePrice;
        m.closeTime = closeTime;
        m.expiryTime = expiryTime;
        m.settleAfter = expiryTime + SETTLEMENT_DELAY;
        m.status = Status.Open;
        m.maker = msg.sender;
        // A complete set per unit: equal reserves, so price starts at 50%.
        m.yesReserve = liquidity;
        m.noReserve = liquidity;
        m.collateral = liquidity;

        emit MarketCreated(marketId, uint8(asset), strikePrice, expiryTime, liquidity);
    }

    // --- trading -----------------------------------------------------------

    /**
     * @notice Buy `isYes` shares with `collateralIn`, reverting if fewer than
     *         `minSharesOut` come back.
     *
     * Slippage protection is a required argument rather than an option: the
     * price moves with the size of the trade itself, so a caller who does not
     * state a bound has not been asked to think about one.
     */
    function buy(uint256 marketId, bool isYes, uint256 collateralIn, uint256 minSharesOut)
        external
        returns (uint256 sharesOut)
    {
        Market storage m = marketData[marketId];
        if (m.status != Status.Open) revert BadStatus();
        if (block.timestamp >= m.closeTime) revert TooLate();
        if (collateralIn == 0) revert NoLiquidity();

        token.safeTransferFrom(msg.sender, address(this), collateralIn);

        // The invariant is taken BEFORE the complete set is minted, and the
        // pool is returned to it afterwards. That difference is precisely the
        // shares the buyer receives.
        uint256 k = m.yesReserve * m.noReserve;

        uint256 yesAfter = m.yesReserve + collateralIn;
        uint256 noAfter = m.noReserve + collateralIn;
        m.collateral += collateralIn;

        if (isYes) {
            // Ceiling division keeps the product at or above k, so rounding
            // can only ever favour the pool — never the buyer.
            uint256 remaining = _ceilDiv(k, noAfter);
            sharesOut = yesAfter - remaining;
            m.yesReserve = remaining;
            m.noReserve = noAfter;
            yesShares[marketId][msg.sender] += sharesOut;
        } else {
            uint256 remaining = _ceilDiv(k, yesAfter);
            sharesOut = noAfter - remaining;
            m.noReserve = remaining;
            m.yesReserve = yesAfter;
            noShares[marketId][msg.sender] += sharesOut;
        }

        if (sharesOut < minSharesOut) revert SlippageTooHigh();

        emit Bought(marketId, msg.sender, isYes, collateralIn, sharesOut);
    }

    /**
     * @notice Marginal price of YES, in basis points (10000 = certainty).
     *
     * In a constant-product book the marginal price of an outcome is the
     * OPPOSITE reserve over the total: the scarcer YES is in the pool, the
     * more it costs. This is the number the UI shows as an implied
     * probability, and unlike a parimutuel pool ratio it is also the price a
     * small trade actually executes at.
     */
    function yesPriceBps(uint256 marketId) external view returns (uint256) {
        Market storage m = marketData[marketId];
        uint256 total = m.yesReserve + m.noReserve;
        if (total == 0) return 5_000;
        return (m.noReserve * 10_000) / total;
    }

    /// @notice Shares `collateralIn` would buy right now, without trading.
    function quote(uint256 marketId, bool isYes, uint256 collateralIn)
        external
        view
        returns (uint256)
    {
        Market storage m = marketData[marketId];
        if (collateralIn == 0) return 0;

        uint256 k = m.yesReserve * m.noReserve;
        uint256 yesAfter = m.yesReserve + collateralIn;
        uint256 noAfter = m.noReserve + collateralIn;

        return isYes ? yesAfter - _ceilDiv(k, noAfter) : noAfter - _ceilDiv(k, yesAfter);
    }

    // --- settlement --------------------------------------------------------

    function requestSettlement(uint256 marketId) external {
        Market storage m = marketData[marketId];
        if (m.status != Status.Open) revert BadStatus();
        if (block.timestamp < m.settleAfter) revert TooEarly();
        m.status = Status.SettlementRequested;
        emit SettlementRequested(marketId, uint8(m.asset), m.strikePrice, m.expiryTime);
    }

    /**
     * @param report abi.encode(uint256 marketId, uint8 outcome, int256 observedValue, bytes32 evidenceHash)
     *
     * Same envelope as every other market in this project, so one workflow
     * handler serves them all.
     */
    function _processReport(bytes calldata report) internal override {
        (uint256 marketId, uint8 rawOutcome, int256 observedValue, bytes32 evidenceHash) =
            abi.decode(report, (uint256, uint8, int256, bytes32));

        Market storage m = marketData[marketId];
        if (m.status != Status.SettlementRequested) revert BadStatus();

        Outcome o = Outcome(rawOutcome);
        m.outcome = o;
        m.observedValue = observedValue;
        m.evidenceHash = evidenceHash;
        // Unlike the parimutuel contracts there is no one-sided-book case to
        // rescue: every share is individually collateralised, so a market with
        // no trades at all still settles correctly — the maker simply gets
        // their liquidity back.
        m.status = o == Outcome.Void ? Status.Void : Status.Settled;

        emit Settled(marketId, o, observedValue, evidenceHash);
    }

    // --- redemption --------------------------------------------------------

    /**
     * @notice Redeem winning shares, one collateral unit each.
     *
     * A VOID PAYS HALF A UNIT PER SHARE, EITHER SIDE — not a full unit each.
     * The first version of this paid both sides in full, which is insolvent
     * on its face: one unit of collateral mints one YES *and* one NO, so
     * honouring both at par promises two units for every one held. A fuzz test
     * over Yes/No outcomes could not see it, because it only ever paid one
     * side; the void case had to be fuzzed for it to surface.
     *
     * Half each is the only split that both preserves the invariant
     * (0.5 * yes + 0.5 * no == collateral) and treats the two sides alike when
     * the question has no answer. It is NOT a refund: someone who bought YES
     * at 70 cents gets 50 back, and the difference is not recoverable from
     * share balances, which do not record what anyone paid. A void is a real
     * loss for whoever traded away from even odds, and that is a property of
     * pricing rather than a fault in the accounting.
     */
    function redeem(uint256 marketId) external {
        Market storage m = marketData[marketId];
        if (m.status != Status.Settled && m.status != Status.Void) revert BadStatus();
        if (redeemed[marketId][msg.sender]) revert AlreadyRedeemed();

        uint256 amount;
        if (m.status == Status.Void) {
            amount = (yesShares[marketId][msg.sender] + noShares[marketId][msg.sender]) / 2;
        } else if (m.outcome == Outcome.Yes) {
            amount = yesShares[marketId][msg.sender];
        } else {
            amount = noShares[marketId][msg.sender];
        }

        if (amount == 0) revert NothingToRedeem();
        redeemed[marketId][msg.sender] = true;
        token.safeTransfer(msg.sender, amount);
        emit Redeemed(marketId, msg.sender, amount);
    }

    /**
     * @notice The maker takes back whatever of the winning side the pool still
     *         holds — their liquidity plus or minus how the market moved
     *         against them.
     *
     * This is where the maker's risk lands. If traders bought the side that
     * won, the pool is left holding mostly the losing side and the maker
     * recovers less than they put in; that shortfall is exactly what funded
     * the traders' profit. It is a bounded loss — never more than the
     * liquidity seeded — and it is the cost of quoting a price at all.
     */
    function withdrawMakerLiquidity(uint256 marketId) external {
        Market storage m = marketData[marketId];
        if (m.status != Status.Settled && m.status != Status.Void) revert BadStatus();
        if (msg.sender != m.maker) revert BadStatus();
        if (m.makerWithdrawn) revert AlreadyRedeemed();

        uint256 amount;
        if (m.status == Status.Void) {
            amount = (m.yesReserve + m.noReserve) / 2;
        } else if (m.outcome == Outcome.Yes) {
            amount = m.yesReserve;
        } else {
            amount = m.noReserve;
        }

        if (amount == 0) revert NothingToRedeem();
        m.makerWithdrawn = true;
        token.safeTransfer(msg.sender, amount);
        emit Redeemed(marketId, msg.sender, amount);
    }

    // --- views -------------------------------------------------------------

    function terms(uint256 marketId)
        external
        view
        returns (
            string memory question,
            uint8 asset,
            uint64 strikePrice,
            uint64 closeTime,
            uint64 expiryTime,
            uint64 settleAfter
        )
    {
        Market storage m = marketData[marketId];
        return (m.question, uint8(m.asset), m.strikePrice, m.closeTime, m.expiryTime, m.settleAfter);
    }

    function pool(uint256 marketId)
        external
        view
        returns (
            uint8 status,
            uint8 outcome,
            int256 observedValue,
            bytes32 evidenceHash,
            address maker,
            uint256 yesReserve,
            uint256 noReserve,
            uint256 collateral
        )
    {
        Market storage m = marketData[marketId];
        return (
            uint8(m.status),
            uint8(m.outcome),
            m.observedValue,
            m.evidenceHash,
            m.maker,
            m.yesReserve,
            m.noReserve,
            m.collateral
        );
    }

    // --- internals ---------------------------------------------------------

    function _ceilDiv(uint256 a, uint256 b) private pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }
}
