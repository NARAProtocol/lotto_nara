import {
  createPublicClient,
  decodeFunctionData,
  http,
  isAddress,
  parseEventLogs,
} from "viem";
import { base } from "viem/chains";

import { BOARD_MANIFEST, getEligibleSlotNumbers } from "../../src/shared/board";
import { engineAbi, NARA_ENGINE_ADDRESS, normalizeWallet } from "../../src/shared/nara";
import { normalizeProfileInput } from "../../src/shared/profile";
import type { ClaimSlotRequest } from "../../src/shared/types";
import { buildBoardPayload, loadClaimRows, rowToClaim, type SlotClaimRow } from "../_lib/board";
import type { Env } from "../_lib/env";
import { getExcludedWalletSet, getRpcUrl } from "../_lib/env";
import { json } from "../_lib/response";

function getMaxLockEpochs(config: unknown) {
  const candidate = config as { maxLockEpochs?: bigint } & readonly unknown[];
  const value = candidate.maxLockEpochs ?? candidate[17];
  return BigInt(value as bigint);
}

function toSafeSlotClaimRow(row: Record<string, unknown> | SlotClaimRow): SlotClaimRow {
  return {
    slot_num: Number(row.slot_num),
    wallet: String(row.wallet ?? ""),
    tx_hash: String(row.tx_hash ?? ""),
    position_id: Number(row.position_id),
    tier_key: String(row.tier_key ?? ""),
    gross_amount_wei: String(row.gross_amount_wei ?? "0"),
    net_amount_wei: String(row.net_amount_wei ?? "0"),
    weight: String(row.weight ?? "0"),
    activation_epoch: Number(row.activation_epoch),
    unlock_epoch: Number(row.unlock_epoch),
    alias: String(row.alias ?? ""),
    display_type: String(row.display_type ?? "letter"),
    display_value: String(row.display_value ?? ""),
    display_color: String(row.display_color ?? ""),
    project_name: String(row.project_name ?? ""),
    project_description: String(row.project_description ?? ""),
    twitter: String(row.twitter ?? ""),
    farcaster: String(row.farcaster ?? ""),
    website: String(row.website ?? ""),
    message: String(row.message ?? ""),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

async function buildSuccessResponse(env: Env, row: SlotClaimRow) {
  const board = buildBoardPayload(await loadClaimRows(env.DB), Array.from(getExcludedWalletSet(env)));
  return json({
    ok: true,
    claim: rowToClaim(row),
    stats: board.stats,
  });
}

function buildFallbackSuccessResponse(row: SlotClaimRow) {
  const claim = rowToClaim(row);
  const tierRemaining = {
    t50: 25,
    t100: 25,
    t250: 20,
    t500: 15,
    t1000: 15,
  };
  const tierKey = claim.tierKey as keyof typeof tierRemaining;
  if (tierKey in tierRemaining) {
    tierRemaining[tierKey] = Math.max(0, tierRemaining[tierKey] - 1);
  }
  return json({
    ok: true,
    claim,
    stats: {
      claimedCount: 1,
      slotsLeft: Math.max(0, BOARD_MANIFEST.length - 1),
      totalNetLockedWei: claim.netAmountWei,
      tierRemaining,
      recentClaims: [claim],
    },
  });
}

function buildClaimOnlySuccessResponse(row: SlotClaimRow) {
  return json({
    ok: true,
    claim: rowToClaim(row),
  });
}

async function safeBuildSuccessResponse(env: Env, row: SlotClaimRow) {
  try {
    return await buildSuccessResponse(env, row);
  } catch (error) {
    console.error("buildSuccessResponse failed", error);
    return buildFallbackSuccessResponse(row);
  }
}

export const onRequestPost = async ({ env, request }: { env: Env; request: Request }) => {
  try {
    const body = (await request.json()) as ClaimSlotRequest;
  const slotNum = Number(body.slotNum);
  const wallet = normalizeWallet(body.wallet ?? "");
  const txHash = body.txHash?.trim();

  if (!slotNum || !Number.isInteger(slotNum)) {
    return json({ ok: false, reason: "slot_not_found", message: "Invalid tile selection." }, { status: 400 });
  }

  if (!wallet || !isAddress(wallet)) {
    return json({ ok: false, reason: "invalid_tx", message: "A valid wallet is required." }, { status: 400 });
  }

  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return json({ ok: false, reason: "invalid_tx", message: "A valid transaction hash is required." }, { status: 400 });
  }

  const manifestSlot = BOARD_MANIFEST.find((slot) => slot.slotNum === slotNum);
  if (!manifestSlot) {
    return json({ ok: false, reason: "slot_not_found", message: "That tile does not exist." }, { status: 404 });
  }

  if (getExcludedWalletSet(env).has(wallet)) {
    return json({ ok: false, reason: "excluded_wallet", message: "That wallet is not eligible for a public OG tile." }, { status: 403 });
  }

  const existingTx = await env.DB.prepare("SELECT * FROM slot_claims WHERE tx_hash = ?1")
    .bind(txHash)
    .first<SlotClaimRow>();
  if (existingTx) {
    const safeExistingTx = toSafeSlotClaimRow(existingTx as Record<string, unknown>);
    if (normalizeWallet(safeExistingTx.wallet) !== wallet) {
      return json({ ok: false, reason: "invalid_tx", message: "That transaction is already tied to another wallet." }, { status: 403 });
    }
    return buildClaimOnlySuccessResponse(safeExistingTx);
  }

  const existingWallet = await env.DB.prepare("SELECT slot_num FROM slot_claims WHERE wallet = ?1")
    .bind(wallet)
    .first<{ slot_num: number }>();
  if (existingWallet) {
    return json({ ok: false, reason: "wallet_exists", message: "That wallet already claimed an OG tile." }, { status: 409 });
  }

  const publicClient = createPublicClient({
    chain: base,
    transport: http(getRpcUrl(env)),
  });

  let verifiedNetAmountWei = 0n;
  let eligibleSlotsForError: number[] = [];
  let insertedRowForResponse: SlotClaimRow | null = null;

  try {
    const [receipt, transaction, config] = await Promise.all([
      publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` }),
      publicClient.getTransaction({ hash: txHash as `0x${string}` }),
      publicClient.readContract({
        address: NARA_ENGINE_ADDRESS,
        abi: engineAbi,
        functionName: "config",
      }),
    ]);

    if (receipt.status !== "success") {
      return json({ ok: false, reason: "invalid_tx", message: "That transaction did not succeed." }, { status: 400 });
    }

    if (normalizeWallet(transaction.from) !== wallet) {
      return json({ ok: false, reason: "invalid_tx", message: "Transaction sender does not match the claiming wallet." }, { status: 403 });
    }

    if (!transaction.to || normalizeWallet(transaction.to) !== normalizeWallet(NARA_ENGINE_ADDRESS)) {
      return json({ ok: false, reason: "invalid_tx", message: "That transaction did not call the live NARA engine." }, { status: 400 });
    }

    const decoded = decodeFunctionData({ abi: engineAbi, data: transaction.input });
    if (decoded.functionName !== "lock") {
      return json({ ok: false, reason: "invalid_tx", message: "That transaction was not a lock call." }, { status: 400 });
    }

    const [grossAmountWei, durationEpochs] = decoded.args as readonly [bigint, bigint, bigint];
    if (BigInt(durationEpochs) !== getMaxLockEpochs(config)) {
      return json({ ok: false, reason: "invalid_duration", message: "OG tiles require a max-duration lock." }, { status: 400 });
    }

    const lockedEvents = parseEventLogs({
      abi: engineAbi,
      eventName: "Locked",
      logs: receipt.logs,
      strict: false,
    }) as unknown as Array<{ address: string; args: Record<string, unknown> }>; 

    const lockedEvent = lockedEvents
      .filter((log) => normalizeWallet(log.address) === normalizeWallet(NARA_ENGINE_ADDRESS))
      .find((event) => normalizeWallet(String(event.args.account ?? "")) === wallet);

    if (!lockedEvent) {
      return json({ ok: false, reason: "invalid_tx", message: "No qualifying lock event was found for that wallet." }, { status: 400 });
    }

    const lockedArgs = lockedEvent.args;
    const netAmountWei = BigInt(lockedArgs.amount as bigint);
    verifiedNetAmountWei = netAmountWei;
    const claimedRows = await loadClaimRows(env.DB);
    const claimedSlots = claimedRows.map((row) => row.slot_num);
    const eligibleSlots = getEligibleSlotNumbers(netAmountWei, claimedSlots);
    eligibleSlotsForError = eligibleSlots;

    if (!eligibleSlots.includes(slotNum)) {
      const slotTaken = claimedSlots.includes(slotNum);
      return json(
        {
          ok: false,
          reason: slotTaken ? "slot_taken" : "insufficient_tier",
          message: slotTaken
            ? "That tile was claimed before your transaction finished. Pick another eligible tile."
            : "That position does not qualify for the selected tile tier.",
          eligibleSlots,
        },
        { status: 409 },
      );
    }

    const profile = normalizeProfileInput(body.profile);

    await env.DB.prepare(
      `INSERT INTO slot_claims (
         slot_num,
         wallet,
         tx_hash,
         position_id,
         tier_key,
         gross_amount_wei,
         net_amount_wei,
         weight,
         activation_epoch,
         unlock_epoch,
         alias,
         display_type,
         display_value,
         display_color,
         project_name,
         project_description,
         twitter,
         farcaster,
         website,
         message
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)`
    )
      .bind(
        slotNum,
        wallet,
        txHash,
        Number(lockedArgs.positionId as bigint),
        manifestSlot.tierKey,
        grossAmountWei.toString(),
        netAmountWei.toString(),
        BigInt(lockedArgs.weight as bigint).toString(),
        Number(lockedArgs.activationEpoch as bigint),
        Number(lockedArgs.unlockEpoch as bigint),
        profile.alias,
        profile.displayType,
        profile.displayValue,
        profile.displayColor,
        profile.projectName,
        profile.projectDescription,
        profile.twitter,
        profile.farcaster,
        profile.website,
        profile.message,
      )
      .run();

    const now = new Date().toISOString();
    insertedRowForResponse = {
      slot_num: slotNum,
      wallet,
      tx_hash: txHash,
      position_id: Number(lockedArgs.positionId as bigint),
      tier_key: manifestSlot.tierKey,
      gross_amount_wei: grossAmountWei.toString(),
      net_amount_wei: netAmountWei.toString(),
      weight: BigInt(lockedArgs.weight as bigint).toString(),
      activation_epoch: Number(lockedArgs.activationEpoch as bigint),
      unlock_epoch: Number(lockedArgs.unlockEpoch as bigint),
      alias: profile.alias,
      display_type: profile.displayType,
      display_value: profile.displayValue,
      display_color: profile.displayColor,
      project_name: profile.projectName,
      project_description: profile.projectDescription,
      twitter: profile.twitter,
      farcaster: profile.farcaster,
      website: profile.website,
      message: profile.message,
      created_at: now,
      updated_at: now,
    };

    return safeBuildSuccessResponse(env, insertedRowForResponse);
  } catch (error) {
    console.error(error);

    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
      const existingTxAfter = await env.DB.prepare("SELECT * FROM slot_claims WHERE tx_hash = ?1")
        .bind(txHash)
        .first<SlotClaimRow>();
      if (existingTxAfter && normalizeWallet(existingTxAfter.wallet) === wallet) {
        return buildClaimOnlySuccessResponse(toSafeSlotClaimRow(existingTxAfter as Record<string, unknown>));
      }

      const claimedRowsAfter = await loadClaimRows(env.DB);
      const existingWalletAfter = claimedRowsAfter.find((row) => normalizeWallet(row.wallet) === wallet);
      if (existingWalletAfter) {
        return json({ ok: false, reason: "wallet_exists", message: "That wallet already claimed an OG tile." }, { status: 409 });
      }

      const claimedSlotsAfter = claimedRowsAfter.map((row) => row.slot_num);
      const eligibleSlotsAfter = verifiedNetAmountWei > 0n ? getEligibleSlotNumbers(verifiedNetAmountWei, claimedSlotsAfter) : eligibleSlotsForError;
      const slotTaken = claimedSlotsAfter.includes(slotNum);

      return json({
        ok: false,
        reason: slotTaken ? "slot_taken" : "invalid_tx",
        message: slotTaken ? "That tile was claimed first. Pick another eligible tile." : "Unable to verify that position transaction.",
        eligibleSlots: slotTaken ? eligibleSlotsAfter : undefined,
      }, { status: slotTaken ? 409 : 400 });
    }

    const detail = error instanceof Error ? error.message : String(error);
    const message = /over rate limit|rpc request failed/i.test(detail)
      ? "The board verifier is busy right now. Try the claim again in a moment."
      : "Unable to verify that position transaction.";
    return json({ ok: false, reason: "invalid_tx", message }, { status: 400 });
  }
  } catch (error) {
    console.error("claim-slot fatal", error);
    const message = error instanceof Error && error.message
      ? error.message
      : "The board claim failed unexpectedly. Refresh and try again.";
    return json({ ok: false, reason: "invalid_tx", message }, { status: 500 });
  }
};


