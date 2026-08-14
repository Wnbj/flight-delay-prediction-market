// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReceiverTemplate} from "./interfaces/ReceiverTemplate.sol";

/**
 * @title FlightMarket
 * @notice Parimutuel binary prediction market on flight delays.
 *         Adapted from smartcontractkit/cre-gcp-prediction-market-demo (SimpleMarket.sol).
 *
 *  Resolution rules are encoded ON-CHAIN so the CRE workflow has zero discretion:
 *    YES  = actual arrival delay >= thresholdMinutes, OR flight cancelled/diverted
 *    NO   = actual arrival delay <  thresholdMinutes
 *    VOID = data unavailable or sources disagree -> everyone refunded
 *
 *  Report receipt (forwarder auth, workflow author/name checks) is handled by
 *  ReceiverTemplate. Call setExpectedAuthor() and setExpectedWorkflowName()
 *  after deployment — name-only validation is insecure at 40-bit (bytes10)
 *  length, so ReceiverTemplate requires author validation to be enabled too.
 *
 *  NOT AUDITED. POC only.
 */
contract FlightMarket is ReceiverTemplate {
    using SafeERC20 for IERC20;

    // --- types -------------------------------------------------------------

    enum Status {
        Open,                 // accepting stakes
        Locked,               // past closeTime, awaiting settlement request
        SettlementRequested,  // event emitted, CRE is working
        Settled,              // outcome written, claims open
        Void                  // refunds open
    }

    enum Outcome { Unset, Yes, No, Void }

    struct Market {
        string  question;          // human readable, for the UI
        string  flightIata;        // e.g. "LH1428"
        uint32  departureDate;     // YYYYMMDD, scheduled departure date (UTC)
        uint16  thresholdMinutes;  // delay threshold that makes YES true
        uint64  closeTime;         // no stakes after this
        uint64  settleAfter;       // earliest settlement request (sched. arrival + buffer)
        Status  status;
        Outcome outcome;
        bytes32 evidenceHash;      // keccak256 of the canonical evidence JSON
        int32   observedDelay;     // minutes, as agreed by the DON; for display
        uint256 yesPool;
        uint256 noPool;
    }

    // --- storage -----------------------------------------------------------

    IERC20 public immutable token;

    uint256 public marketCount;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => uint256)) public yesStake;
    mapping(uint256 => mapping(address => uint256)) public noStake;
    mapping(uint256 => mapping(address => bool))    public claimed;

    // --- events ------------------------------------------------------------

    event MarketCreated(uint256 indexed marketId, string flightIata, uint32 departureDate, uint16 thresholdMinutes);
    event Staked(uint256 indexed marketId, address indexed user, bool isYes, uint256 amount);

    /// @dev THIS is the CRE log trigger. Everything the workflow needs is indexed
    ///      or in the payload, so the workflow never has to read contract state.
    event SettlementRequested(
        uint256 indexed marketId,
        string  flightIata,
        uint32  departureDate,
        uint16  thresholdMinutes
    );

    event Settled(uint256 indexed marketId, Outcome outcome, int32 observedDelay, bytes32 evidenceHash);
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

    // --- market lifecycle --------------------------------------------------

    function newMarket(
        string calldata question,
        string calldata flightIata,
        uint32 departureDate,
        uint16 thresholdMinutes,
        uint64 closeTime,
        uint64 settleAfter
    ) external returns (uint256 marketId) {
        marketId = marketCount++;
        Market storage m = markets[marketId];
        m.question = question;
        m.flightIata = flightIata;
        m.departureDate = departureDate;
        m.thresholdMinutes = thresholdMinutes;
        m.closeTime = closeTime;
        m.settleAfter = settleAfter;
        m.status = Status.Open;
        emit MarketCreated(marketId, flightIata, departureDate, thresholdMinutes);
    }

    function stake(uint256 marketId, bool isYes, uint256 amount) external {
        Market storage m = markets[marketId];
        if (m.status != Status.Open) revert BadStatus();
        if (block.timestamp >= m.closeTime) revert TooLate();

        token.safeTransferFrom(msg.sender, address(this), amount);

        if (isYes) {
            m.yesPool += amount;
            yesStake[marketId][msg.sender] += amount;
        } else {
            m.noPool += amount;
            noStake[marketId][msg.sender] += amount;
        }
        emit Staked(marketId, msg.sender, isYes, amount);
    }

    /// @notice Anyone may fire this once the flight should have landed.
    ///         Emitting the event is what wakes up the CRE workflow.
    function requestSettlement(uint256 marketId) external {
        Market storage m = markets[marketId];
        if (m.status != Status.Open && m.status != Status.Locked) revert BadStatus();
        if (block.timestamp < m.settleAfter) revert TooEarly();

        m.status = Status.SettlementRequested;
        emit SettlementRequested(marketId, m.flightIata, m.departureDate, m.thresholdMinutes);
    }

    // --- CRE report receiver ----------------------------------------------

    /**
     * @notice Business logic invoked by ReceiverTemplate.onReport() once forwarder,
     *         author, and workflow-name checks have all passed.
     * @param report abi.encode(uint256 marketId, uint8 outcome, int32 delayMinutes, bytes32 evidenceHash)
     */
    function _processReport(bytes calldata report) internal override {
        (uint256 marketId, uint8 rawOutcome, int32 delayMinutes, bytes32 evidenceHash) =
            abi.decode(report, (uint256, uint8, int32, bytes32));

        Market storage m = markets[marketId];
        if (m.status != Status.SettlementRequested) revert BadStatus();

        Outcome o = Outcome(rawOutcome);
        m.outcome = o;
        m.observedDelay = delayMinutes;
        m.evidenceHash = evidenceHash;

        // A one-sided book is a void market: nobody to pay out against.
        if (o == Outcome.Void || m.yesPool == 0 || m.noPool == 0) {
            m.status = Status.Void;
        } else {
            m.status = Status.Settled;
        }

        emit Settled(marketId, m.outcome, delayMinutes, evidenceHash);
    }

    // --- payouts (pull pattern) -------------------------------------------

    function claim(uint256 marketId) external {
        Market storage m = markets[marketId];
        if (claimed[marketId][msg.sender]) revert AlreadyClaimed();

        uint256 payout;

        if (m.status == Status.Void) {
            payout = yesStake[marketId][msg.sender] + noStake[marketId][msg.sender];
        } else if (m.status == Status.Settled) {
            uint256 total = m.yesPool + m.noPool;
            if (m.outcome == Outcome.Yes) {
                payout = (yesStake[marketId][msg.sender] * total) / m.yesPool;
            } else {
                payout = (noStake[marketId][msg.sender] * total) / m.noPool;
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
        markets[marketId].status = Status.Void;
    }
}
