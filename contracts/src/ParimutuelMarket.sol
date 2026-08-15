// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReceiverTemplate} from "./interfaces/ReceiverTemplate.sol";

/**
 * @title ParimutuelMarket
 * @notice Everything a binary parimutuel market needs that is not specific to
 *         what is being predicted: pools, stakes, settlement bookkeeping and
 *         payouts. A concrete market adds only its own question terms and the
 *         event its oracle workflow triggers on.
 *
 * Split out of FlightMarket, whose logic this reproduces. FlightMarket itself
 * is deliberately NOT migrated onto this base: it is already deployed, holds
 * live positions and is wired into the frontend by its exact ABI, so switching
 * it would mean a new address and orphaned markets for no functional gain. It
 * should inherit from here whenever it is next redeployed.
 *
 * Payout model is parimutuel, not an order book: there is no price locked in
 * at stake time. The winning side splits the entire pot in proportion to
 * stake, and a stake's share is only fixed once the market settles.
 *
 * NOT AUDITED. POC only.
 */
abstract contract ParimutuelMarket is ReceiverTemplate {
    using SafeERC20 for IERC20;

    // --- types -------------------------------------------------------------

    enum Status {
        Open,                 // accepting stakes
        Locked,               // past closeTime, awaiting settlement request
        SettlementRequested,  // event emitted, the oracle workflow is working
        Settled,              // outcome written, claims open
        Void                  // refunds open
    }

    enum Outcome { Unset, Yes, No, Void }

    /**
     * Fields every market has, whatever it is about. Question-specific terms
     * (a flight number, a strike price) live in the derived contract, keyed by
     * the same marketId.
     */
    struct Core {
        string  question;      // human readable, for the UI
        uint64  closeTime;     // no stakes after this
        uint64  settleAfter;   // earliest settlement request
        Status  status;
        Outcome outcome;
        bytes32 evidenceHash;  // keccak256 of the canonical evidence JSON
        int256  observedValue; // the settled figure; meaning is per-market
        uint256 yesPool;
        uint256 noPool;
    }

    // --- storage -----------------------------------------------------------

    IERC20 public immutable token;

    uint256 public marketCount;
    mapping(uint256 => Core) public core;
    mapping(uint256 => mapping(address => uint256)) public yesStake;
    mapping(uint256 => mapping(address => uint256)) public noStake;
    mapping(uint256 => mapping(address => bool))    public claimed;

    // --- events ------------------------------------------------------------

    event Staked(uint256 indexed marketId, address indexed user, bool isYes, uint256 amount);
    event Settled(uint256 indexed marketId, Outcome outcome, int256 observedValue, bytes32 evidenceHash);
    event Claimed(uint256 indexed marketId, address indexed user, uint256 amount);

    // --- errors ------------------------------------------------------------

    error BadStatus();
    error TooEarly();
    error TooLate();
    error NothingToClaim();
    error AlreadyClaimed();

    constructor(IERC20 _token, address _forwarder) ReceiverTemplate(_forwarder) {
        token = _token;
    }

    // --- lifecycle helpers for derived contracts ---------------------------

    function _createCore(
        string calldata question,
        uint64 closeTime,
        uint64 settleAfter
    ) internal returns (uint256 marketId) {
        marketId = marketCount++;
        Core storage c = core[marketId];
        c.question = question;
        c.closeTime = closeTime;
        c.settleAfter = settleAfter;
        c.status = Status.Open;
    }

    /// @dev Derived contracts call this, then emit their own trigger event.
    function _requestSettlement(uint256 marketId) internal {
        Core storage c = core[marketId];
        if (c.status != Status.Open && c.status != Status.Locked) revert BadStatus();
        if (block.timestamp < c.settleAfter) revert TooEarly();
        c.status = Status.SettlementRequested;
    }

    // --- staking -----------------------------------------------------------

    function stake(uint256 marketId, bool isYes, uint256 amount) external {
        Core storage c = core[marketId];
        if (c.status != Status.Open) revert BadStatus();
        if (block.timestamp >= c.closeTime) revert TooLate();

        token.safeTransferFrom(msg.sender, address(this), amount);

        if (isYes) {
            c.yesPool += amount;
            yesStake[marketId][msg.sender] += amount;
        } else {
            c.noPool += amount;
            noStake[marketId][msg.sender] += amount;
        }
        emit Staked(marketId, msg.sender, isYes, amount);
    }

    // --- oracle report receiver --------------------------------------------

    /**
     * @notice Business logic invoked by ReceiverTemplate.onReport() once
     *         forwarder, author and workflow-name checks have all passed.
     * @param report abi.encode(uint256 marketId, uint8 outcome, int256 observedValue, bytes32 evidenceHash)
     *
     * Shared across market types on purpose: the settlement envelope is the
     * same everywhere, only the meaning of `observedValue` changes.
     */
    function _processReport(bytes calldata report) internal override {
        (uint256 marketId, uint8 rawOutcome, int256 observedValue, bytes32 evidenceHash) =
            abi.decode(report, (uint256, uint8, int256, bytes32));

        Core storage c = core[marketId];
        if (c.status != Status.SettlementRequested) revert BadStatus();

        Outcome o = Outcome(rawOutcome);
        c.outcome = o;
        c.observedValue = observedValue;
        c.evidenceHash = evidenceHash;

        // A one-sided book is a void market: nobody to pay out against.
        if (o == Outcome.Void || c.yesPool == 0 || c.noPool == 0) {
            c.status = Status.Void;
        } else {
            c.status = Status.Settled;
        }

        emit Settled(marketId, c.outcome, observedValue, evidenceHash);
    }

    // --- payouts (pull pattern) -------------------------------------------

    function claim(uint256 marketId) external {
        Core storage c = core[marketId];
        if (claimed[marketId][msg.sender]) revert AlreadyClaimed();

        uint256 payout;

        if (c.status == Status.Void) {
            payout = yesStake[marketId][msg.sender] + noStake[marketId][msg.sender];
        } else if (c.status == Status.Settled) {
            uint256 total = c.yesPool + c.noPool;
            if (c.outcome == Outcome.Yes) {
                payout = (yesStake[marketId][msg.sender] * total) / c.yesPool;
            } else {
                payout = (noStake[marketId][msg.sender] * total) / c.noPool;
            }
        } else {
            revert BadStatus();
        }

        if (payout == 0) revert NothingToClaim();
        claimed[marketId][msg.sender] = true;
        token.safeTransfer(msg.sender, payout);
        emit Claimed(marketId, msg.sender, payout);
    }

    // --- escape hatch (POC only, remove before anything real) --------------

    function ownerVoid(uint256 marketId) external onlyOwner {
        core[marketId].status = Status.Void;
    }
}
