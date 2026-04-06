import { BOARD_MANIFEST, BOARD_TIERS } from "../../src/shared/board";
import type { BoardApiResponse, BoardStats, SlotClaimRecord } from "../../src/shared/types";

export type SlotClaimRow = {
  slot_num: number;
  wallet: string;
  tx_hash: string;
  position_id: number;
  tier_key: string;
  gross_amount_wei: string;
  net_amount_wei: string;
  weight: string;
  activation_epoch: number;
  unlock_epoch: number;
  alias: string;
  display_type: string;
  display_value: string;
  display_color: string;
  project_name: string;
  project_description: string;
  twitter: string;
  farcaster: string;
  website: string;
  message: string;
  created_at: string;
  updated_at: string;
};

export function rowToClaim(row: SlotClaimRow): SlotClaimRecord {
  return {
    slotNum: row.slot_num,
    wallet: row.wallet,
    txHash: row.tx_hash,
    positionId: row.position_id,
    tierKey: row.tier_key as SlotClaimRecord["tierKey"],
    grossAmountWei: row.gross_amount_wei,
    netAmountWei: row.net_amount_wei,
    weight: row.weight,
    activationEpoch: row.activation_epoch,
    unlockEpoch: row.unlock_epoch,
    alias: row.alias,
    displayType: row.display_type as SlotClaimRecord["displayType"],
    displayValue: row.display_value,
    displayColor: row.display_color,
    projectName: row.project_name,
    projectDescription: row.project_description,
    twitter: row.twitter,
    farcaster: row.farcaster,
    website: row.website,
    message: row.message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadClaimRows(db: D1Database) {
  const query = await db.prepare("SELECT * FROM slot_claims ORDER BY slot_num ASC").all<SlotClaimRow>();
  return query.results ?? [];
}

export function buildBoardStats(claims: SlotClaimRecord[]): BoardStats {
  const claimedCount = claims.length;
  const totalNetLockedWei = claims.reduce((sum, claim) => sum + BigInt(claim.netAmountWei), 0n);
  const tierRemaining = Object.fromEntries(BOARD_TIERS.map((tier) => [tier.key, tier.slots])) as BoardStats["tierRemaining"];

  for (const claim of claims) {
    tierRemaining[claim.tierKey] -= 1;
  }

  const recentClaims = [...claims]
    .sort((left, right) => {
      if (left.createdAt === right.createdAt) {
        return right.slotNum - left.slotNum;
      }
      return right.createdAt.localeCompare(left.createdAt);
    })
    .slice(0, 10);

  return {
    claimedCount,
    slotsLeft: BOARD_MANIFEST.length - claimedCount,
    totalNetLockedWei: totalNetLockedWei.toString(),
    tierRemaining,
    recentClaims,
  };
}

export function buildBoardPayload(claimRows: SlotClaimRow[], excludedWallets: string[]): BoardApiResponse {
  const claims = claimRows.map(rowToClaim);
  const claimMap = new Map(claims.map((claim) => [claim.slotNum, claim]));

  return {
    slots: BOARD_MANIFEST.map((slot) => ({
      ...slot,
      claim: claimMap.get(slot.slotNum) ?? null,
    })),
    stats: buildBoardStats(claims),
    excludedWallets,
    generatedAt: new Date().toISOString(),
  };
}
