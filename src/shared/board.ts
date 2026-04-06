import type { BoardSlotManifest, BoardTierKey } from "./types";

export type TierConfig = {
  key: BoardTierKey;
  label: string;
  netAmount: number;
  slots: number;
  accent: string;
  background: string;
  border: string;
};

export const BOARD_TIERS: TierConfig[] = [
  {
    key: "t50",
    label: "50",
    netAmount: 50,
    slots: 25,
    accent: "#8f97ac",
    background: "#10141f",
    border: "#2c3448"
  },
  {
    key: "t100",
    label: "100",
    netAmount: 100,
    slots: 25,
    accent: "#59b7ff",
    background: "#0f1a25",
    border: "#244a68"
  },
  {
    key: "t250",
    label: "250",
    netAmount: 250,
    slots: 20,
    accent: "#7f77dd",
    background: "#17152d",
    border: "#3d3674"
  },
  {
    key: "t500",
    label: "500",
    netAmount: 500,
    slots: 15,
    accent: "#f7a84a",
    background: "#26180a",
    border: "#6d4315"
  },
  {
    key: "t1000",
    label: "1K",
    netAmount: 1000,
    slots: 15,
    accent: "#ff6d6d",
    background: "#2a1013",
    border: "#70313a"
  }
];

export const BOARD_ROWS = 10;
export const BOARD_COLS = 10;
const BOARD_SEED = 0x4e415241;

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: T[], seed: number) {
  const copy = [...items];
  const random = mulberry32(seed);
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function buildTierPool() {
  const tierPool: BoardTierKey[] = [];
  for (const tier of BOARD_TIERS) {
    for (let count = 0; count < tier.slots; count += 1) {
      tierPool.push(tier.key);
    }
  }
  return seededShuffle(tierPool, BOARD_SEED);
}

export const BOARD_MANIFEST: BoardSlotManifest[] = buildTierPool().map((tierKey, index) => ({
  slotNum: index + 1,
  row: Math.floor(index / BOARD_COLS),
  col: index % BOARD_COLS,
  tierKey,
}));

export const BOARD_TIER_BY_KEY = Object.fromEntries(
  BOARD_TIERS.map((tier) => [tier.key, tier]),
) as Record<BoardTierKey, TierConfig>;

export function getTierByKey(key: BoardTierKey) {
  return BOARD_TIER_BY_KEY[key];
}

export function tierNetAmountWei(key: BoardTierKey) {
  return BigInt(getTierByKey(key).netAmount) * 10n ** 18n;
}

export function getEligibleSlotNumbers(netAmountWei: bigint, claimedSlots: number[]) {
  const claimed = new Set(claimedSlots);
  return BOARD_MANIFEST.filter(
    (slot) => !claimed.has(slot.slotNum) && tierNetAmountWei(slot.tierKey) <= netAmountWei,
  ).map((slot) => slot.slotNum);
}
