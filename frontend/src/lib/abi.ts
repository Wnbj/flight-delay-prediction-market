// GENERATED from contracts/out — do not edit by hand.
// Regenerate: see frontend/README.md

export const flightMarketAbi = [
  {
    "type": "function",
    "name": "claim",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimed",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getExpectedAuthor",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getExpectedWorkflowName",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes10",
        "internalType": "bytes10"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getForwarderAddress",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "marketCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "markets",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "question",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "flightIata",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "departureDate",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "thresholdMinutes",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "closeTime",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "settleAfter",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "status",
        "type": "uint8",
        "internalType": "enum FlightMarket.Status"
      },
      {
        "name": "outcome",
        "type": "uint8",
        "internalType": "enum FlightMarket.Outcome"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "observedDelay",
        "type": "int32",
        "internalType": "int32"
      },
      {
        "name": "yesPool",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "noPool",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "newMarket",
    "inputs": [
      {
        "name": "question",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "flightIata",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "departureDate",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "thresholdMinutes",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "closeTime",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "settleAfter",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "noStake",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "requestSettlement",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "stake",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "isYes",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "token",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "yesStake",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "Claimed",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MarketCreated",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "flightIata",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "departureDate",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "thresholdMinutes",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Settled",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "outcome",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum FlightMarket.Outcome"
      },
      {
        "name": "observedDelay",
        "type": "int32",
        "indexed": false,
        "internalType": "int32"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SettlementRequested",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "flightIata",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "departureDate",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "thresholdMinutes",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Staked",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "isYes",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyClaimed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadStatus",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAuthor",
    "inputs": [
      {
        "name": "received",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "expected",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidSender",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "expected",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidWorkflowName",
    "inputs": [
      {
        "name": "received",
        "type": "bytes10",
        "internalType": "bytes10"
      },
      {
        "name": "expected",
        "type": "bytes10",
        "internalType": "bytes10"
      }
    ]
  },
  {
    "type": "error",
    "name": "NothingToClaim",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OwnableUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "TooEarly",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TooLate",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WorkflowNameRequiresAuthorValidation",
    "inputs": []
  }
] as const;

export const cryptoMarketAbi = [
  {
    "type": "function",
    "name": "SETTLEMENT_DELAY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "claim",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimed",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "core",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "question",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "closeTime",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "settleAfter",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "status",
        "type": "uint8",
        "internalType": "enum ParimutuelMarket.Status"
      },
      {
        "name": "outcome",
        "type": "uint8",
        "internalType": "enum ParimutuelMarket.Outcome"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "observedValue",
        "type": "int256",
        "internalType": "int256"
      },
      {
        "name": "yesPool",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "noPool",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "marketCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "newMarket",
    "inputs": [
      {
        "name": "question",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "asset",
        "type": "uint8",
        "internalType": "enum CryptoMarket.Asset"
      },
      {
        "name": "strikePrice",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "closeTime",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "expiryTime",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "noStake",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "requestSettlement",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "stake",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "isYes",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "terms",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "asset",
        "type": "uint8",
        "internalType": "enum CryptoMarket.Asset"
      },
      {
        "name": "strikePrice",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "expiryTime",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "token",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "yesStake",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "Claimed",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MarketCreated",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "asset",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "strikePrice",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "expiryTime",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Settled",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "outcome",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum ParimutuelMarket.Outcome"
      },
      {
        "name": "observedValue",
        "type": "int256",
        "indexed": false,
        "internalType": "int256"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SettlementRequested",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "asset",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "strikePrice",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "expiryTime",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Staked",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "isYes",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyClaimed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadExpiry",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadStatus",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadStrike",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAuthor",
    "inputs": [
      {
        "name": "received",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "expected",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidSender",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "expected",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidWorkflowName",
    "inputs": [
      {
        "name": "received",
        "type": "bytes10",
        "internalType": "bytes10"
      },
      {
        "name": "expected",
        "type": "bytes10",
        "internalType": "bytes10"
      }
    ]
  },
  {
    "type": "error",
    "name": "NothingToClaim",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OwnableUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "TooEarly",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TooLate",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WorkflowNameRequiresAuthorValidation",
    "inputs": []
  }
] as const;

export const mockUsdcAbi = [
  {
    "type": "function",
    "name": "allowance",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "spender",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "approve",
    "inputs": [
      {
        "name": "spender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "decimals",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "mint",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "symbol",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "Approval",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "spender",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Transfer",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  }
] as const;

export const stockMarketAbi = [
    {
      "type": "function",
      "name": "SETTLEMENT_DELAY",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint64",
          "internalType": "uint64"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "claim",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "claimed",
      "inputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "core",
      "inputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "question",
          "type": "string",
          "internalType": "string"
        },
        {
          "name": "closeTime",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "settleAfter",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "status",
          "type": "uint8",
          "internalType": "enum ParimutuelMarket.Status"
        },
        {
          "name": "outcome",
          "type": "uint8",
          "internalType": "enum ParimutuelMarket.Outcome"
        },
        {
          "name": "evidenceHash",
          "type": "bytes32",
          "internalType": "bytes32"
        },
        {
          "name": "observedValue",
          "type": "int256",
          "internalType": "int256"
        },
        {
          "name": "yesPool",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "noPool",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "feedFor",
      "inputs": [
        {
          "name": "",
          "type": "string",
          "internalType": "string"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "marketCount",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "newMarket",
      "inputs": [
        {
          "name": "question",
          "type": "string",
          "internalType": "string"
        },
        {
          "name": "symbol",
          "type": "string",
          "internalType": "string"
        },
        {
          "name": "strikePrice",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "closeTime",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "expiryTime",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "maxStaleness",
          "type": "uint32",
          "internalType": "uint32"
        }
      ],
      "outputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "noStake",
      "inputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "requestSettlement",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "stake",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "isYes",
          "type": "bool",
          "internalType": "bool"
        },
        {
          "name": "amount",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "symbolFor",
      "inputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "string",
          "internalType": "string"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "terms",
      "inputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "feed",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "strikePrice",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "expiryTime",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "maxStaleness",
          "type": "uint32",
          "internalType": "uint32"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "token",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "contract IERC20"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "yesStake",
      "inputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "event",
      "name": "Claimed",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "indexed": true,
          "internalType": "uint256"
        },
        {
          "name": "user",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "amount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "MarketCreated",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "indexed": true,
          "internalType": "uint256"
        },
        {
          "name": "symbol",
          "type": "string",
          "indexed": false,
          "internalType": "string"
        },
        {
          "name": "feed",
          "type": "address",
          "indexed": false,
          "internalType": "address"
        },
        {
          "name": "strikePrice",
          "type": "uint64",
          "indexed": false,
          "internalType": "uint64"
        },
        {
          "name": "expiryTime",
          "type": "uint64",
          "indexed": false,
          "internalType": "uint64"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "Settled",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "indexed": true,
          "internalType": "uint256"
        },
        {
          "name": "outcome",
          "type": "uint8",
          "indexed": false,
          "internalType": "enum ParimutuelMarket.Outcome"
        },
        {
          "name": "observedValue",
          "type": "int256",
          "indexed": false,
          "internalType": "int256"
        },
        {
          "name": "evidenceHash",
          "type": "bytes32",
          "indexed": false,
          "internalType": "bytes32"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "SettlementRequested",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "indexed": true,
          "internalType": "uint256"
        },
        {
          "name": "feed",
          "type": "address",
          "indexed": false,
          "internalType": "address"
        },
        {
          "name": "strikePrice",
          "type": "uint64",
          "indexed": false,
          "internalType": "uint64"
        },
        {
          "name": "closeTime",
          "type": "uint64",
          "indexed": false,
          "internalType": "uint64"
        },
        {
          "name": "expiryTime",
          "type": "uint64",
          "indexed": false,
          "internalType": "uint64"
        },
        {
          "name": "maxStaleness",
          "type": "uint32",
          "indexed": false,
          "internalType": "uint32"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "Staked",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "indexed": true,
          "internalType": "uint256"
        },
        {
          "name": "user",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "isYes",
          "type": "bool",
          "indexed": false,
          "internalType": "bool"
        },
        {
          "name": "amount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "error",
      "name": "AlreadyClaimed",
      "inputs": []
    },
    {
      "type": "error",
      "name": "BadExpiry",
      "inputs": []
    },
    {
      "type": "error",
      "name": "BadStatus",
      "inputs": []
    },
    {
      "type": "error",
      "name": "BadStrike",
      "inputs": []
    },
    {
      "type": "error",
      "name": "FeedExists",
      "inputs": []
    },
    {
      "type": "error",
      "name": "InvalidAuthor",
      "inputs": [
        {
          "name": "received",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "expected",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "InvalidForwarderAddress",
      "inputs": []
    },
    {
      "type": "error",
      "name": "InvalidSender",
      "inputs": [
        {
          "name": "sender",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "expected",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "InvalidWorkflowId",
      "inputs": [
        {
          "name": "received",
          "type": "bytes32",
          "internalType": "bytes32"
        },
        {
          "name": "expected",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ]
    },
    {
      "type": "error",
      "name": "InvalidWorkflowName",
      "inputs": [
        {
          "name": "received",
          "type": "bytes10",
          "internalType": "bytes10"
        },
        {
          "name": "expected",
          "type": "bytes10",
          "internalType": "bytes10"
        }
      ]
    },
    {
      "type": "error",
      "name": "NothingToClaim",
      "inputs": []
    },
    {
      "type": "error",
      "name": "OwnableInvalidOwner",
      "inputs": [
        {
          "name": "owner",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "OwnableUnauthorizedAccount",
      "inputs": [
        {
          "name": "account",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "SafeERC20FailedOperation",
      "inputs": [
        {
          "name": "token",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "TooEarly",
      "inputs": []
    },
    {
      "type": "error",
      "name": "TooLate",
      "inputs": []
    },
    {
      "type": "error",
      "name": "UnknownFeed",
      "inputs": []
    },
    {
      "type": "error",
      "name": "WorkflowNameRequiresAuthorValidation",
      "inputs": []
    }
  ] as const;

export const reserveMarketAbi = [
    {
      "type": "function",
      "name": "SETTLEMENT_DELAY",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint64",
          "internalType": "uint64"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "claim",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "claimed",
      "inputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "core",
      "inputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "question",
          "type": "string",
          "internalType": "string"
        },
        {
          "name": "closeTime",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "settleAfter",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "status",
          "type": "uint8",
          "internalType": "enum ParimutuelMarket.Status"
        },
        {
          "name": "outcome",
          "type": "uint8",
          "internalType": "enum ParimutuelMarket.Outcome"
        },
        {
          "name": "evidenceHash",
          "type": "bytes32",
          "internalType": "bytes32"
        },
        {
          "name": "observedValue",
          "type": "int256",
          "internalType": "int256"
        },
        {
          "name": "yesPool",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "noPool",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "feedFor",
      "inputs": [
        {
          "name": "",
          "type": "string",
          "internalType": "string"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "marketCount",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "newMarket",
      "inputs": [
        {
          "name": "question",
          "type": "string",
          "internalType": "string"
        },
        {
          "name": "symbol",
          "type": "string",
          "internalType": "string"
        },
        {
          "name": "strikePrice",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "closeTime",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "expiryTime",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "maxStaleness",
          "type": "uint32",
          "internalType": "uint32"
        }
      ],
      "outputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "noStake",
      "inputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "requestSettlement",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "stake",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "isYes",
          "type": "bool",
          "internalType": "bool"
        },
        {
          "name": "amount",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "symbolFor",
      "inputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "string",
          "internalType": "string"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "terms",
      "inputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "feed",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "strikePrice",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "expiryTime",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "maxStaleness",
          "type": "uint32",
          "internalType": "uint32"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "token",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "contract IERC20"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "yesStake",
      "inputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "event",
      "name": "Claimed",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "indexed": true,
          "internalType": "uint256"
        },
        {
          "name": "user",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "amount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "MarketCreated",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "indexed": true,
          "internalType": "uint256"
        },
        {
          "name": "symbol",
          "type": "string",
          "indexed": false,
          "internalType": "string"
        },
        {
          "name": "feed",
          "type": "address",
          "indexed": false,
          "internalType": "address"
        },
        {
          "name": "strikePrice",
          "type": "uint64",
          "indexed": false,
          "internalType": "uint64"
        },
        {
          "name": "expiryTime",
          "type": "uint64",
          "indexed": false,
          "internalType": "uint64"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "Settled",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "indexed": true,
          "internalType": "uint256"
        },
        {
          "name": "outcome",
          "type": "uint8",
          "indexed": false,
          "internalType": "enum ParimutuelMarket.Outcome"
        },
        {
          "name": "observedValue",
          "type": "int256",
          "indexed": false,
          "internalType": "int256"
        },
        {
          "name": "evidenceHash",
          "type": "bytes32",
          "indexed": false,
          "internalType": "bytes32"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "SettlementRequested",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "indexed": true,
          "internalType": "uint256"
        },
        {
          "name": "feed",
          "type": "address",
          "indexed": false,
          "internalType": "address"
        },
        {
          "name": "strikePrice",
          "type": "uint64",
          "indexed": false,
          "internalType": "uint64"
        },
        {
          "name": "expiryTime",
          "type": "uint64",
          "indexed": false,
          "internalType": "uint64"
        },
        {
          "name": "maxStaleness",
          "type": "uint32",
          "indexed": false,
          "internalType": "uint32"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "Staked",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "indexed": true,
          "internalType": "uint256"
        },
        {
          "name": "user",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "isYes",
          "type": "bool",
          "indexed": false,
          "internalType": "bool"
        },
        {
          "name": "amount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "error",
      "name": "AlreadyClaimed",
      "inputs": []
    },
    {
      "type": "error",
      "name": "BadExpiry",
      "inputs": []
    },
    {
      "type": "error",
      "name": "BadStatus",
      "inputs": []
    },
    {
      "type": "error",
      "name": "BadStrike",
      "inputs": []
    },
    {
      "type": "error",
      "name": "FeedExists",
      "inputs": []
    },
    {
      "type": "error",
      "name": "InvalidAuthor",
      "inputs": [
        {
          "name": "received",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "expected",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "InvalidForwarderAddress",
      "inputs": []
    },
    {
      "type": "error",
      "name": "InvalidSender",
      "inputs": [
        {
          "name": "sender",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "expected",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "InvalidWorkflowId",
      "inputs": [
        {
          "name": "received",
          "type": "bytes32",
          "internalType": "bytes32"
        },
        {
          "name": "expected",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ]
    },
    {
      "type": "error",
      "name": "InvalidWorkflowName",
      "inputs": [
        {
          "name": "received",
          "type": "bytes10",
          "internalType": "bytes10"
        },
        {
          "name": "expected",
          "type": "bytes10",
          "internalType": "bytes10"
        }
      ]
    },
    {
      "type": "error",
      "name": "NothingToClaim",
      "inputs": []
    },
    {
      "type": "error",
      "name": "OwnableInvalidOwner",
      "inputs": [
        {
          "name": "owner",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "OwnableUnauthorizedAccount",
      "inputs": [
        {
          "name": "account",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "SafeERC20FailedOperation",
      "inputs": [
        {
          "name": "token",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "TooEarly",
      "inputs": []
    },
    {
      "type": "error",
      "name": "TooLate",
      "inputs": []
    },
    {
      "type": "error",
      "name": "UnknownFeed",
      "inputs": []
    },
    {
      "type": "error",
      "name": "WorkflowNameRequiresAuthorValidation",
      "inputs": []
    }
  ] as const;

export const ammMarketAbi = [
    {
      "type": "function",
      "name": "SETTLEMENT_DELAY",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint64",
          "internalType": "uint64"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "buy",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "isYes",
          "type": "bool",
          "internalType": "bool"
        },
        {
          "name": "collateralIn",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "minSharesOut",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "sharesOut",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "marketCount",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "newMarket",
      "inputs": [
        {
          "name": "question",
          "type": "string",
          "internalType": "string"
        },
        {
          "name": "asset",
          "type": "uint8",
          "internalType": "enum AmmMarket.Asset"
        },
        {
          "name": "strikePrice",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "closeTime",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "expiryTime",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "liquidity",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "noShares",
      "inputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "pool",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "status",
          "type": "uint8",
          "internalType": "uint8"
        },
        {
          "name": "outcome",
          "type": "uint8",
          "internalType": "uint8"
        },
        {
          "name": "observedValue",
          "type": "int256",
          "internalType": "int256"
        },
        {
          "name": "evidenceHash",
          "type": "bytes32",
          "internalType": "bytes32"
        },
        {
          "name": "maker",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "yesReserve",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "noReserve",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "collateral",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "quote",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "isYes",
          "type": "bool",
          "internalType": "bool"
        },
        {
          "name": "collateralIn",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "redeem",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "redeemed",
      "inputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "requestSettlement",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "terms",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "question",
          "type": "string",
          "internalType": "string"
        },
        {
          "name": "asset",
          "type": "uint8",
          "internalType": "uint8"
        },
        {
          "name": "strikePrice",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "closeTime",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "expiryTime",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "settleAfter",
          "type": "uint64",
          "internalType": "uint64"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "token",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "contract IERC20"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "withdrawMakerLiquidity",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "yesPriceBps",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "yesShares",
      "inputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "event",
      "name": "Bought",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "indexed": true,
          "internalType": "uint256"
        },
        {
          "name": "buyer",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "isYes",
          "type": "bool",
          "indexed": false,
          "internalType": "bool"
        },
        {
          "name": "collateralIn",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        },
        {
          "name": "sharesOut",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "MarketCreated",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "indexed": true,
          "internalType": "uint256"
        },
        {
          "name": "asset",
          "type": "uint8",
          "indexed": false,
          "internalType": "uint8"
        },
        {
          "name": "strikePrice",
          "type": "uint64",
          "indexed": false,
          "internalType": "uint64"
        },
        {
          "name": "expiryTime",
          "type": "uint64",
          "indexed": false,
          "internalType": "uint64"
        },
        {
          "name": "liquidity",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "Redeemed",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "indexed": true,
          "internalType": "uint256"
        },
        {
          "name": "holder",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "amount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "Settled",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "indexed": true,
          "internalType": "uint256"
        },
        {
          "name": "outcome",
          "type": "uint8",
          "indexed": false,
          "internalType": "enum AmmMarket.Outcome"
        },
        {
          "name": "observedValue",
          "type": "int256",
          "indexed": false,
          "internalType": "int256"
        },
        {
          "name": "evidenceHash",
          "type": "bytes32",
          "indexed": false,
          "internalType": "bytes32"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "SettlementRequested",
      "inputs": [
        {
          "name": "marketId",
          "type": "uint256",
          "indexed": true,
          "internalType": "uint256"
        },
        {
          "name": "asset",
          "type": "uint8",
          "indexed": false,
          "internalType": "uint8"
        },
        {
          "name": "strikePrice",
          "type": "uint64",
          "indexed": false,
          "internalType": "uint64"
        },
        {
          "name": "expiryTime",
          "type": "uint64",
          "indexed": false,
          "internalType": "uint64"
        }
      ],
      "anonymous": false
    },
    {
      "type": "error",
      "name": "AlreadyRedeemed",
      "inputs": []
    },
    {
      "type": "error",
      "name": "BadExpiry",
      "inputs": []
    },
    {
      "type": "error",
      "name": "BadStatus",
      "inputs": []
    },
    {
      "type": "error",
      "name": "BadStrike",
      "inputs": []
    },
    {
      "type": "error",
      "name": "InvalidAuthor",
      "inputs": [
        {
          "name": "received",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "expected",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "InvalidForwarderAddress",
      "inputs": []
    },
    {
      "type": "error",
      "name": "InvalidSender",
      "inputs": [
        {
          "name": "sender",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "expected",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "InvalidWorkflowId",
      "inputs": [
        {
          "name": "received",
          "type": "bytes32",
          "internalType": "bytes32"
        },
        {
          "name": "expected",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ]
    },
    {
      "type": "error",
      "name": "InvalidWorkflowName",
      "inputs": [
        {
          "name": "received",
          "type": "bytes10",
          "internalType": "bytes10"
        },
        {
          "name": "expected",
          "type": "bytes10",
          "internalType": "bytes10"
        }
      ]
    },
    {
      "type": "error",
      "name": "NoLiquidity",
      "inputs": []
    },
    {
      "type": "error",
      "name": "NothingToRedeem",
      "inputs": []
    },
    {
      "type": "error",
      "name": "OwnableInvalidOwner",
      "inputs": [
        {
          "name": "owner",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "OwnableUnauthorizedAccount",
      "inputs": [
        {
          "name": "account",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "SafeERC20FailedOperation",
      "inputs": [
        {
          "name": "token",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "SlippageTooHigh",
      "inputs": []
    },
    {
      "type": "error",
      "name": "TooEarly",
      "inputs": []
    },
    {
      "type": "error",
      "name": "TooLate",
      "inputs": []
    },
    {
      "type": "error",
      "name": "WorkflowNameRequiresAuthorValidation",
      "inputs": []
    }
  ] as const;
