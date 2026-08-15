// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ParimutuelMarket} from "./ParimutuelMarket.sol";

/**
 * @title CryptoMarket
 * @notice Parimutuel binary market on a crypto price at a point in time:
 *         "will BTC be at or above $X at time T?"
 *
 *  Resolution rules are encoded ON-CHAIN so the oracle has zero discretion:
 *    YES  = observed price >= strikePrice at expiry
 *    NO   = observed price <  strikePrice
 *    VOID = sources disagree or data unavailable -> everyone refunded
 *
 *  Prices use 8 decimals, matching the Chainlink feed convention, so a
 *  $63,000.00 strike is 6_300_000_000_000.
 *
 *  WHY A STRIKE RATHER THAN "will it go up?": the strike is a market
 *  parameter, fixed and visible before anyone stakes, so no one has to trust
 *  an oracle reading for the starting point — the oracle only ever reports the
 *  final price. A "higher than at the start" market would need an oracle call
 *  at creation too, and that opening price would set the terms of a bet people
 *  had already placed.
 *
 *  WHY NOT CHAINLINK PRICE FEEDS: measured on Sepolia, BTC/USD and ETH/USD
 *  update on a flat 60-minute heartbeat with no deviation trigger. A 5-minute
 *  market read from them would compare a price against itself roughly 92% of
 *  the time. Sub-hour horizons need real-time exchange data, which is what the
 *  CRE workflow fetches and reaches consensus on.
 *
 *  NOT AUDITED. POC only.
 */
contract CryptoMarket is ParimutuelMarket {
    // --- types -------------------------------------------------------------

    enum Asset { BTC, ETH }

    struct Terms {
        Asset  asset;
        uint64 strikePrice;  // 8 decimals
        uint64 expiryTime;   // price is read as of this timestamp
    }

    // --- storage -----------------------------------------------------------

    /// Question-specific terms, keyed by the same marketId as `core`.
    mapping(uint256 => Terms) public terms;

    // --- events ------------------------------------------------------------

    event MarketCreated(
        uint256 indexed marketId,
        uint8   asset,
        uint64  strikePrice,
        uint64  expiryTime
    );

    /// @dev THIS is the CRE log trigger. Everything the workflow needs is in
    ///      the payload, so it never has to read contract state.
    event SettlementRequested(
        uint256 indexed marketId,
        uint8   asset,
        uint64  strikePrice,
        uint64  expiryTime
    );

    // --- errors ------------------------------------------------------------

    error BadExpiry();
    error BadStrike();

    /**
     * Settlement is held back one minute past expiry.
     *
     * The oracle settles on the close of the one-minute candle containing
     * expiry, and that candle does not exist until the minute is over. Letting
     * a settlement request through at expiry itself would send the workflow
     * looking for data that has not been published yet, and the market would
     * void for no reason other than being asked too early.
     */
    uint64 public constant SETTLEMENT_DELAY = 60;

    constructor(IERC20 _token, address _forwarder) ParimutuelMarket(_token, _forwarder) {}

    // --- market lifecycle --------------------------------------------------

    /**
     * @param closeTime  no stakes after this; must not be after expiry, or
     *                   stakes could be placed on an already-decided outcome
     * @param expiryTime the moment the price is measured, and the earliest a
     *                   settlement request is accepted
     */
    function newMarket(
        string calldata question,
        Asset asset,
        uint64 strikePrice,
        uint64 closeTime,
        uint64 expiryTime
    ) external returns (uint256 marketId) {
        if (strikePrice == 0) revert BadStrike();
        // Staking must close no later than expiry. Otherwise the price could
        // pass the strike while the book is still open and anyone watching
        // could stake on a known result.
        if (closeTime > expiryTime) revert BadExpiry();

        marketId = _createCore(question, closeTime, expiryTime + SETTLEMENT_DELAY);
        terms[marketId] = Terms({asset: asset, strikePrice: strikePrice, expiryTime: expiryTime});

        emit MarketCreated(marketId, uint8(asset), strikePrice, expiryTime);
    }

    /// @notice Anyone may fire this once expiry has passed. Emitting the event
    ///         is what wakes up the CRE workflow.
    function requestSettlement(uint256 marketId) external {
        _requestSettlement(marketId);
        Terms storage t = terms[marketId];
        emit SettlementRequested(marketId, uint8(t.asset), t.strikePrice, t.expiryTime);
    }
}
