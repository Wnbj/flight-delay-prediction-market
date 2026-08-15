// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ParimutuelMarket} from "./ParimutuelMarket.sol";

/**
 * @title StockMarket
 * @notice Parimutuel binary market on an equity or commodity price level:
 *         "will CSPX be at or above $X at time T?", settled from a Chainlink
 *         Data Feed rather than from exchange APIs.
 *
 *  WHY A DATA FEED HERE, WHEN CryptoMarket DELIBERATELY AVOIDS ONE:
 *  the objection to feeds was never feeds, it was cadence. Measured on Sepolia,
 *  BTC/USD publishes on a flat 60-minute heartbeat, so a 5-minute crypto market
 *  read from it compares a price against itself. CSPX/USD publishes about daily
 *  with deviation triggers on top, and an equity market's natural horizon is a
 *  session, not five minutes. Same instrument, opposite verdict, because the
 *  question being asked is on a different timescale.
 *
 *  THE HARD PART IS THE TRADING CALENDAR, NOT THE PRICE. A feed keeps
 *  publishing when the exchange behind it is shut — it simply republishes the
 *  last price with a fresh timestamp. Measured over a week of CSPX/USD, the
 *  answer changed on every weekday round and did not change once from Friday
 *  to Saturday; XAU/USD sat at exactly 4,377.25 for twelve consecutive hourly
 *  rounds across a Saturday. A market expiring while the exchange is closed is
 *  therefore decided the moment the bell rings, and anyone staking afterwards
 *  is betting on a known result.
 *
 *  The workflow's defence is stated in `SettlementRequested`: it is handed both
 *  `closeTime` and `expiryTime` and must void unless the feed's answer actually
 *  CHANGED between them. A market whose price never moved while it was live was
 *  not a prediction. This does not need an exchange calendar on chain, which
 *  the chain has no way to know.
 *
 *  FEEDS ARE ALLOWLISTED. `newMarket` is permissionless, so if the feed address
 *  were a caller-supplied parameter, anyone could create a real-looking market
 *  pointing at a contract they control and hand themselves the settlement
 *  price. The owner registers feeds; callers pick one by symbol.
 *
 *  Prices carry 8 decimals, matching both the feed and the rest of this
 *  codebase.
 *
 *  NOT AUDITED. POC only.
 */
contract StockMarket is ParimutuelMarket {
    // --- types -------------------------------------------------------------

    struct Terms {
        address feed;         // Chainlink aggregator proxy
        uint64  strikePrice;  // 8 decimals
        uint64  expiryTime;   // the price is read as of this timestamp
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
     * @dev THIS is the CRE log trigger, and it carries `closeTime` as well as
     *      `expiryTime` on purpose: the workflow needs both to check the price
     *      moved while the market was live. Everything the workflow needs is in
     *      the payload, so it never reads contract state.
     */
    event SettlementRequested(
        uint256 indexed marketId,
        address feed,
        uint64  strikePrice,
        uint64  closeTime,
        uint64  expiryTime,
        uint32  maxStaleness
    );

    // --- errors ------------------------------------------------------------

    error BadExpiry();
    error BadStrike();
    error UnknownFeed();
    error FeedExists();

    /**
     * Settlement is held back past expiry because a feed round is only
     * observable once it has been published. Unlike the one-minute candle in
     * CryptoMarket this is not a fixed lag — a daily feed may publish hours
     * after the session it prices — so the delay is per market, and generous.
     */
    uint64 public constant SETTLEMENT_DELAY = 30 minutes;

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

    /**
     * @param symbol       must already be registered by the owner
     * @param closeTime    no stakes after this; must not be after expiry
     * @param expiryTime   the moment the price is measured
     * @param maxStaleness how old the round in force at expiry may be. A daily
     *                     feed needs more than a day of tolerance; an hourly
     *                     one should be given far less, or a stalled feed goes
     *                     unnoticed.
     */
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
        // Staking must close no later than expiry, or the price could pass the
        // strike while the book is still open.
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
        emit SettlementRequested(
            marketId, t.feed, t.strikePrice, core[marketId].closeTime, t.expiryTime, t.maxStaleness
        );
    }
}
