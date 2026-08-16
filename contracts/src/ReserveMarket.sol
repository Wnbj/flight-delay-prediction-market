// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ParimutuelMarket} from "./ParimutuelMarket.sol";

/**
 * @title ReserveMarket
 * @notice Parimutuel binary market on a Proof-of-Reserve or fund-NAV level:
 *         "will stETH reserves be at or above X at time T?", settled from a
 *         Chainlink reserve feed.
 *
 *  WHY THIS IS NOT JUST A StockMarket WITH A DIFFERENT FEED:
 *  StockMarket voids unless the feed's answer CHANGED between the book closing
 *  and expiry. That rule is right for an equity: a feed keeps publishing while
 *  the exchange behind it is shut, repeating the last price with a fresh
 *  timestamp, so an unchanged answer over a session means the session never
 *  happened and the outcome was fixed before the last stake was placed.
 *
 *  A reserve has no session. Deposits and redemptions can land at any hour,
 *  and reserves sitting perfectly still for a day is ordinary rather than
 *  evidence that nothing could have happened. Applying the equity rule here
 *  would void honest markets for the crime of a quiet day. So this contract
 *  does not carry `closeTime` into its settlement event at all — the workflow
 *  cannot apply a movement check it has no data for, which is a stronger
 *  guarantee than asking it not to.
 *
 *  WHAT STILL GUARDS IT: staleness. A feed that has stopped publishing keeps
 *  answering with its last value forever — measured on Sepolia, EUTBL NAV was
 *  four months stale and still responding. `maxStaleness` is therefore the
 *  load-bearing parameter here, and should be set tight relative to the feed's
 *  heartbeat rather than generously.
 *
 *  SCALE: reserve feeds do not use 8 decimals. stETH Proof of Reserves
 *  publishes 18, and its raw answer does not fit in a uint64 at all. Strikes
 *  here are quoted at 8 decimals like everything else in this codebase, and
 *  the workflow rescales the feed's answer using the feed's own `decimals()`
 *  before comparing.
 *
 *  Feeds are allowlisted for the same reason as in StockMarket: `newMarket` is
 *  permissionless, so a caller-supplied feed address would let anyone point a
 *  real-looking market at a contract they control.
 *
 *  NOT AUDITED. POC only.
 */
contract ReserveMarket is ParimutuelMarket {
    // --- types -------------------------------------------------------------

    struct Terms {
        address feed;         // Chainlink reserve / NAV aggregator proxy
        uint64  strikePrice;  // 8 decimals, whatever the feed's own scale is
        uint64  expiryTime;   // the moment the level is measured
        uint32  maxStaleness; // how old the round at expiry may be, in seconds
    }

    // --- storage -----------------------------------------------------------

    mapping(uint256 => Terms) public terms;

    /// Symbol -> feed. The registry doubles as the allowlist.
    mapping(string => address) public feedFor;
    /// Feed -> symbol, so the UI can label a market without a second lookup.
    mapping(address => string) public symbolFor;

    // --- events ------------------------------------------------------------

    event FeedRegistered(string symbol, address feed);
    event FeedRemoved(string symbol, address feed);

    event MarketCreated(
        uint256 indexed marketId,
        string  symbol,
        address feed,
        uint64  strikePrice,
        uint64  expiryTime
    );

    /**
     * @dev The CRE log trigger. Deliberately carries NO `closeTime`: there is
     *      no movement check to perform here, and withholding the input is a
     *      better guarantee than documenting that it should be ignored.
     */
    event SettlementRequested(
        uint256 indexed marketId,
        address feed,
        uint64  strikePrice,
        uint64  expiryTime,
        uint32  maxStaleness
    );

    // --- errors ------------------------------------------------------------

    error BadExpiry();
    error BadStrike();
    error UnknownFeed();
    error FeedExists();

    /**
     * Reserve and NAV feeds publish slowly — daily heartbeats are common, and
     * some of the tokenized-fund feeds on Sepolia run to 27 hours. An hour is
     * a floor, not a wait sized to any particular feed; `maxStaleness` is the
     * parameter that actually has to match the feed.
     */
    uint64 public constant SETTLEMENT_DELAY = 1 hours;

    constructor(IERC20 _token, address _forwarder) ParimutuelMarket(_token, _forwarder) {}

    // --- feed registry -----------------------------------------------------

    function registerFeed(string calldata symbol, address feed) external onlyOwner {
        if (feed == address(0)) revert UnknownFeed();
        if (feedFor[symbol] != address(0)) revert FeedExists();
        feedFor[symbol] = feed;
        symbolFor[feed] = symbol;
        emit FeedRegistered(symbol, feed);
    }

    function removeFeed(string calldata symbol) external onlyOwner {
        address feed = feedFor[symbol];
        if (feed == address(0)) revert UnknownFeed();
        delete feedFor[symbol];
        delete symbolFor[feed];
        emit FeedRemoved(symbol, feed);
    }

    // --- market lifecycle --------------------------------------------------

    function newMarket(
        string calldata question,
        string calldata symbol,
        uint64 strikePrice,
        uint64 closeTime,
        uint64 expiryTime,
        uint32 maxStaleness
    ) external returns (uint256 marketId) {
        address feed = feedFor[symbol];
        if (feed == address(0)) revert UnknownFeed();
        if (strikePrice == 0) revert BadStrike();
        // Staking still must close no later than expiry, even without a
        // movement check: otherwise the level could cross the strike while the
        // book is open and anyone watching could stake on a known result.
        if (closeTime > expiryTime) revert BadExpiry();
        if (maxStaleness == 0) revert BadExpiry();

        marketId = _createCore(question, closeTime, expiryTime + SETTLEMENT_DELAY);
        terms[marketId] =
            Terms({feed: feed, strikePrice: strikePrice, expiryTime: expiryTime, maxStaleness: maxStaleness});

        emit MarketCreated(marketId, symbol, feed, strikePrice, expiryTime);
    }

    /// @notice Anyone may fire this once the settle-after time has passed.
    function requestSettlement(uint256 marketId) external {
        _requestSettlement(marketId);
        Terms storage t = terms[marketId];
        emit SettlementRequested(marketId, t.feed, t.strikePrice, t.expiryTime, t.maxStaleness);
    }
}
