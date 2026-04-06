export type BoardTierKey = "t50" | "t100" | "t250" | "t500" | "t1000";

export type SlotDisplayType = "letter" | "emoji" | "image";

export type SlotProfileInput = {
  alias: string;
  displayType: SlotDisplayType;
  displayValue: string;
  displayColor: string;
  projectName: string;
  projectDescription: string;
  twitter: string;
  farcaster: string;
  website: string;
  message: string;
};

export type SlotClaimRecord = SlotProfileInput & {
  slotNum: number;
  wallet: string;
  txHash: string;
  positionId: number;
  tierKey: BoardTierKey;
  grossAmountWei: string;
  netAmountWei: string;
  weight: string;
  activationEpoch: number;
  unlockEpoch: number;
  createdAt: string;
  updatedAt: string;
};

export type BoardSlotManifest = {
  slotNum: number;
  row: number;
  col: number;
  tierKey: BoardTierKey;
};

export type BoardSlotView = BoardSlotManifest & {
  claim: SlotClaimRecord | null;
};

export type TierRemaining = Record<BoardTierKey, number>;

export type BoardStats = {
  claimedCount: number;
  slotsLeft: number;
  totalNetLockedWei: string;
  tierRemaining: TierRemaining;
  recentClaims: SlotClaimRecord[];
};

export type BoardApiResponse = {
  slots: BoardSlotView[];
  stats: BoardStats;
  excludedWallets: string[];
  generatedAt: string;
};

export type ClaimSlotRequest = {
  slotNum: number;
  wallet: string;
  txHash: string;
  profile: SlotProfileInput;
};

export type ClaimSlotSuccess = {
  ok: true;
  claim: SlotClaimRecord;
  stats: BoardStats;
};

export type ClaimSlotFailure = {
  ok: false;
  reason:
    | "slot_taken"
    | "wallet_exists"
    | "excluded_wallet"
    | "invalid_tx"
    | "invalid_duration"
    | "insufficient_tier"
    | "slot_not_found";
  message: string;
  eligibleSlots?: number[];
};

export type ClaimSlotResponse = ClaimSlotSuccess | ClaimSlotFailure;

export type RequestEditNonceRequest = {
  wallet: string;
};

export type RequestEditNonceResponse = {
  nonce: string;
  expiresAt: string;
  message: string;
};

export type UpdateSlotRequest = {
  wallet: string;
  nonce: string;
  signature: string;
  profile: SlotProfileInput;
};

export type UpdateSlotResponse = {
  ok: true;
  claim: SlotClaimRecord;
};

export type MarketApiResponse = {
  naraPriceUsd: number | null;
  ethPriceUsd: number | null;
  source: string;
  fetchedAt: string;
};

export type EngineStatusApiResponse = {
  currentEpoch: number;
  processedEpoch: number;
  epochBacklog: number;
  epochEndsAt: string;
  totalLocked: string;
  activeTotalWeight: string;
  pendingEthForNextEpoch: string;
  rewardReserveAvailable: string;
  totalRewardFundsAvailable: string;
};
