export const NARA_CHAIN_ID = 8453;
export const NARA_CHAIN_NAME = "Base";

export const NARA_TOKEN_ADDRESS = "0xE444de61752bD13D1D37Ee59c31ef4e489bd727C";
export const NARA_ENGINE_ADDRESS = "0x62250aEE40F37e2eb2cd300E5a429d7096C8868F";
export const NARA_TOKEN_TREASURY_WALLET = "0xfe3A8678A9c729438BB11718bD1391E7Ab491E8e";
export const NARA_ENGINE_TREASURY = "0x39139CA6cB1b2330a612D28691a0E66E0af69a40";
export const NARA_OWNER_WALLET = "0xC019Dc79412c4b20103ac4ce97B2615FF45D490d";
export const NARA_OPERATOR_WALLET = "0xcf222f05911e3AbeF77F2A552C623c122522F670";
export const NARA_LOCK_NFT_ADDRESS = "0x2654602d8b0A7e328dcEC553aC2d1D289fC3B5da";
export const NARA_LOTTO_POOL_ADDRESS = "0xca6909FB6Fcfe7cE37DDe6e62eaB21157734CD37";
export const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";

export const DEFAULT_EXCLUDED_WALLETS = [
  NARA_TOKEN_TREASURY_WALLET,
  NARA_ENGINE_TREASURY,
  NARA_OWNER_WALLET,
  NARA_OPERATOR_WALLET,
].map((wallet) => wallet.toLowerCase());

export const tokenAbi = [
  {
    type: "function",
    stateMutability: "view",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

// Single canonical engineAbi — no duplicates
export const engineAbi = [
  {
    type: "function",
    stateMutability: "payable",
    name: "lock",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "durationEpochs", type: "uint64" },
      { name: "minWeight", type: "uint256" },
    ],
    outputs: [{ name: "positionId", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "lockFeeBps",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "claimFeeBps",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "lockFeeWei",
    inputs: [],
    outputs: [{ name: "", type: "uint96" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "unlockFeeWei",
    inputs: [],
    outputs: [{ name: "", type: "uint96" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "previewWeight",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "durationEpochs", type: "uint64" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "currentEpoch",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "epochState",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "epoch", type: "uint64" },
          { name: "timestamp", type: "uint64" },
          { name: "circulatingSupply", type: "uint256" },
          { name: "totalLocked", type: "uint256" },
          { name: "activeTotalWeight", type: "uint256" },
          { name: "weightedLockShareWad", type: "uint256" },
          { name: "stressWad", type: "uint256" },
          { name: "betaWad", type: "uint256" },
          { name: "horizon", type: "uint256" },
          { name: "retentionWad", type: "uint256" },
          { name: "baseEmission", type: "uint256" },
          { name: "emission", type: "uint256" },
          { name: "admittedSupply", type: "uint256" },
          { name: "distributedNara", type: "uint256" },
          { name: "distributedEth", type: "uint256" },
          { name: "treasuryAmount", type: "uint256" },
          { name: "warmupFactorWad", type: "uint256" },
          { name: "bootstrapWeight", type: "uint256" },
          { name: "heartbeat", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "config",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "eMax", type: "uint256" },
          { name: "beta0Wad", type: "uint256" },
          { name: "mWad", type: "uint256" },
          { name: "aWad", type: "uint256" },
          { name: "bWad", type: "uint256" },
          { name: "cWad", type: "uint256" },
          { name: "dWad", type: "uint256" },
          { name: "dripSplitWad", type: "uint256" },
          { name: "durationLinearWad", type: "uint256" },
          { name: "durationQuadraticWad", type: "uint256" },
          { name: "growthFactorWad", type: "uint256" },
          { name: "minBaseEmission", type: "uint256" },
          { name: "maxBaseEmission", type: "uint256" },
          { name: "warmupRateWad", type: "uint256" },
          { name: "bootstrapInitialWeight", type: "uint256" },
          { name: "bootstrapDecayWad", type: "uint256" },
          { name: "activationDelayEpochs", type: "uint64" },
          { name: "maxLockEpochs", type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "advanceEpoch",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "epoch", type: "uint64" },
          { name: "timestamp", type: "uint64" },
          { name: "circulatingSupply", type: "uint256" },
          { name: "totalLocked", type: "uint256" },
          { name: "activeTotalWeight", type: "uint256" },
          { name: "weightedLockShareWad", type: "uint256" },
          { name: "stressWad", type: "uint256" },
          { name: "betaWad", type: "uint256" },
          { name: "horizon", type: "uint256" },
          { name: "retentionWad", type: "uint256" },
          { name: "baseEmission", type: "uint256" },
          { name: "emission", type: "uint256" },
          { name: "admittedSupply", type: "uint256" },
          { name: "distributedNara", type: "uint256" },
          { name: "distributedEth", type: "uint256" },
          { name: "treasuryAmount", type: "uint256" },
          { name: "warmupFactorWad", type: "uint256" },
          { name: "bootstrapWeight", type: "uint256" },
          { name: "heartbeat", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "advanceEpochs",
    inputs: [{ name: "maxSteps", type: "uint256" }],
    outputs: [
      { name: "stepsAdvanced", type: "uint256" },
      {
        name: "lastSnapshot",
        type: "tuple",
        components: [
          { name: "epoch", type: "uint64" },
          { name: "timestamp", type: "uint64" },
          { name: "circulatingSupply", type: "uint256" },
          { name: "totalLocked", type: "uint256" },
          { name: "activeTotalWeight", type: "uint256" },
          { name: "weightedLockShareWad", type: "uint256" },
          { name: "stressWad", type: "uint256" },
          { name: "betaWad", type: "uint256" },
          { name: "horizon", type: "uint256" },
          { name: "retentionWad", type: "uint256" },
          { name: "baseEmission", type: "uint256" },
          { name: "emission", type: "uint256" },
          { name: "admittedSupply", type: "uint256" },
          { name: "distributedNara", type: "uint256" },
          { name: "distributedEth", type: "uint256" },
          { name: "treasuryAmount", type: "uint256" },
          { name: "warmupFactorWad", type: "uint256" },
          { name: "bootstrapWeight", type: "uint256" },
          { name: "heartbeat", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "genesisTimestamp",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "epochLength",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "totalLocked",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "activeTotalWeight",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "pendingEthForNextEpoch",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "rewardReserveAvailable",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "totalRewardFundsAvailable",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "claimableRewards",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "naraAmount", type: "uint256" },
      { name: "ethAmount", type: "uint256" },
    ],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "positionsLength",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "positionAt",
    inputs: [
      { name: "account", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "amount", type: "uint128" },
          { name: "weight", type: "uint128" },
          { name: "createdEpoch", type: "uint64" },
          { name: "activationEpoch", type: "uint64" },
          { name: "unlockEpoch", type: "uint64" },
          { name: "naraDebtRay", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "advanceAndClaimRewards",
    inputs: [
      { name: "to", type: "address" },
      { name: "maxSteps", type: "uint256" },
    ],
    outputs: [
      { name: "stepsAdvanced", type: "uint256" },
      { name: "naraAmount", type: "uint256" },
      { name: "ethAmount", type: "uint256" },
    ],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "extend",
    inputs: [
      { name: "positionId", type: "uint256" },
      { name: "additionalEpochs", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "event",
    anonymous: false,
    name: "Locked",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "positionId", type: "uint256", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "activationEpoch", type: "uint64", indexed: false },
      { name: "unlockEpoch", type: "uint64", indexed: false },
      { name: "weight", type: "uint256", indexed: false },
    ],
  },
] as const;

export const lockNftAbi = [
  {
    type: "function",
    stateMutability: "payable",
    name: "mintAndLock",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "durationEpochs", type: "uint64" },
      { name: "minWeight", type: "uint256" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "payable",
    name: "extendLock",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "additionalEpochs", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "mintFeeWei",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "extendFeeWei",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const lottoPoolAbi = [
  { name: "potNara", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "potEth", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "participantCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "participantAddresses", type: "function", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ type: "address" }] },
  { name: "lastDrawEpoch", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { name: "launchEpoch", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { name: "pendingDrawRequestId", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    name: "userToParticipant",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      {
        components: [
          { name: "user", type: "address" },
          { name: "cloneAddress", type: "address" },
          { name: "activationEpoch", type: "uint64" },
          { name: "weight", type: "uint128" },
          { name: "isActive", type: "bool" },
        ],
        type: "tuple",
      },
    ],
  },
  {
    name: "userWinningsNara",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "userWinningsEth",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "config",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        components: [
          { name: "minDepositAmount", type: "uint256" },
          { name: "maxDepositAmount", type: "uint256" },
          { name: "lockDurationEpochs", type: "uint64" },
          { name: "drawFrequencyEpochs", type: "uint64" },
          { name: "maxParticipants", type: "uint64" },
          { name: "maxSyncSteps", type: "uint64" },
          { name: "minDrawPotNara", type: "uint256" },
          { name: "minDrawPotEth", type: "uint256" },
        ],
        type: "tuple",
      },
    ],
  },
  {
    name: "getPoolState",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      {
        components: [
          { name: "liveEpoch", type: "uint64" },
          { name: "settledEpoch", type: "uint64" },
          { name: "engineBacklog", type: "uint64" },
          { name: "nextDrawEpoch", type: "uint64" },
          { name: "drawPending", type: "bool" },
          { name: "drawReadyByTime", type: "bool" },
          { name: "drawReadyByPrize", type: "bool" },
          { name: "participantCount", type: "uint256" },
          { name: "liveParticipantCount", type: "uint256" },
          { name: "liveLottoWeight", type: "uint256" },
          { name: "userWeight", type: "uint256" },
          { name: "userOddsBps", type: "uint256" },
          { name: "isParticipant", type: "bool" },
          { name: "canWithdraw", type: "bool" },
          { name: "unlockEpoch", type: "uint64" },
          { name: "potNara", type: "uint256" },
          { name: "potEth", type: "uint256" },
          { name: "pendingDrawPotNara", type: "uint256" },
          { name: "pendingDrawPotEth", type: "uint256" },
          { name: "userWinningsNara", type: "uint256" },
          { name: "userWinningsEth", type: "uint256" },
        ],
        type: "tuple",
      },
    ],
  },
  {
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  { name: "drawWinner", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { name: "claimWinnings", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    name: "WinnerDrawn",
    type: "event",
    inputs: [
      { name: "winner", type: "address", indexed: true },
      { name: "potNara", type: "uint256", indexed: false },
      { name: "potEth", type: "uint256", indexed: false },
      { name: "protocolCutEth", type: "uint256", indexed: false },
    ],
  },
] as const;

export function normalizeWallet(wallet: string) {
  return wallet.trim().toLowerCase();
}

export function getExcludedWallets(extraRaw?: string) {
  const extra = (extraRaw ?? "")
    .split(",")
    .map((wallet) => wallet.trim().toLowerCase())
    .filter(Boolean);
  return [...DEFAULT_EXCLUDED_WALLETS, ...extra];
}
