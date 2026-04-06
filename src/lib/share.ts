import { formatUnits } from "viem";

import { getTierByKey } from "../shared/board";
import type { BoardStats, SlotClaimRecord } from "../shared/types";

const SITE_URL = "https://www.naraprotocol.io/lotto";
const DEFAULT_ALIAS_PATTERN = /^0x[a-f0-9]{4}\.\.\.[a-f0-9]{4}$/i;

function formatTokenAmount(rawWei: string) {
  const value = Number.parseFloat(formatUnits(BigInt(rawWei), 18));
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatWeight(rawWeightWei: string) {
  const weight = Number.parseFloat(formatUnits(BigInt(rawWeightWei), 18));
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(weight));
}

function formatMultiplier(rawWeightWei: string, rawNetWei: string) {
  const weight = Number.parseFloat(formatUnits(BigInt(rawWeightWei), 18));
  const amount = Number.parseFloat(formatUnits(BigInt(rawNetWei), 18));
  if (!Number.isFinite(weight) || !Number.isFinite(amount) || amount <= 0) {
    return "1x";
  }

  const multiplier = Math.round((weight / amount) * 10) / 10;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: multiplier % 1 === 0 ? 0 : 1 }).format(multiplier)}x`;
}

function resolveShareIdentity(claim: SlotClaimRecord) {
  const alias = claim.alias.trim();
  const project = claim.projectName.trim();
  const customAlias = alias && !DEFAULT_ALIAS_PATTERN.test(alias);

  if (project && customAlias && project.toLowerCase() !== alias.toLowerCase()) {
    return `${project} (${alias})`;
  }

  if (project) {
    return project;
  }

  if (customAlias) {
    return alias;
  }

  return "";
}

function tierEmoji(tierKey: SlotClaimRecord["tierKey"]) {
  switch (tierKey) {
    case "t1000":
      return "ðŸ‘‘";
    case "t500":
      return "ðŸ”¥";
    case "t250":
      return "âš¡";
    case "t100":
      return "ðŸ”’";
    case "t50":
    default:
      return "ðŸ§±";
  }
}

function tierScarcityLine(claim: SlotClaimRecord, stats: BoardStats) {
  const tier = getTierByKey(claim.tierKey);
  const left = stats.tierRemaining[claim.tierKey];

  if (claim.tierKey === "t1000") {
    return `Only ${left} of ${tier.slots} 1K founder slots remain.`;
  }

  if (claim.tierKey === "t500") {
    return `Only ${left} of ${tier.slots} premium 500 $NARA slots remain.`;
  }

  return `Only ${left} of ${tier.slots} ${tier.label} $NARA slots remain.`;
}

export function buildXShareText(claim: SlotClaimRecord, stats: BoardStats) {
  const slotLabel = String(claim.slotNum).padStart(2, "0");
  const amount = formatTokenAmount(claim.netAmountWei);
  const weight = formatWeight(claim.weight);
  const multiplier = formatMultiplier(claim.weight, claim.netAmountWei);
  const identity = resolveShareIdentity(claim);
  const opener = identity
    ? `${tierEmoji(claim.tierKey)} ${identity} locked Founding Locker #${slotLabel} on @NARA_protocol.`
    : `${tierEmoji(claim.tierKey)} Founding Locker #${slotLabel} on @NARA_protocol is locked.`;

  return [
    opener,
    "",
    `${amount} $NARA. Lock weight: ${weight} (${multiplier} multiplier).`,
    tierScarcityLine(claim, stats),
    "",
    "Lockers earn ETH + NARA every 15 min from the sealed 700k reserve.",
    "No governance. Just math.",
    "",
    SITE_URL,
    "",
    "$NARA #Base #DeFi",
  ].join("\n");
}

export function buildWarpcastShareText(claim: SlotClaimRecord, stats: BoardStats) {
  const slotLabel = String(claim.slotNum).padStart(2, "0");
  const amount = formatTokenAmount(claim.netAmountWei);
  const weight = formatWeight(claim.weight);
  const multiplier = formatMultiplier(claim.weight, claim.netAmountWei);
  const identity = resolveShareIdentity(claim);
  const opener = identity
    ? `${tierEmoji(claim.tierKey)} ${identity} locked Founding Locker #${slotLabel} on NARA.`
    : `${tierEmoji(claim.tierKey)} I locked Founding Locker #${slotLabel} on NARA.`;

  return [
    opener,
    "",
    `${amount} $NARA. Weight: ${weight} (${multiplier}).`,
    "ETH + NARA drop every 15 min from the sealed 700k reserve.",
    tierScarcityLine(claim, stats),
    "",
    "$NARA #Base",
  ].join("\n");
}

export function buildXShareUrl(text: string) {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

export function buildWarpcastShareUrl(text: string) {
  const params = new URLSearchParams();
  params.set("text", text);
  params.append("embeds[]", SITE_URL);
  return `https://warpcast.com/~/compose?${params.toString()}`;
}
