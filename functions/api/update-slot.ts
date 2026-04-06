import { isAddress, verifyMessage } from "viem";

import { buildEditMessage } from "../../src/shared/auth";
import { normalizeProfileInput } from "../../src/shared/profile";
import type { UpdateSlotRequest } from "../../src/shared/types";
import { rowToClaim, type SlotClaimRow } from "../_lib/board";
import type { Env } from "../_lib/env";
import { json } from "../_lib/response";

export const onRequestPost = async ({ env, request }: { env: Env; request: Request }) => {
  const body = (await request.json()) as UpdateSlotRequest;
  const wallet = body.wallet?.trim().toLowerCase();

  if (!wallet || !isAddress(wallet)) {
    return json({ message: "A valid wallet is required." }, { status: 400 });
  }

  const nonceQuery = await env.DB.prepare("SELECT nonce, expires_at FROM auth_nonces WHERE wallet = ?1")
    .bind(wallet)
    .first<{ nonce: string; expires_at: string }>();

  if (!nonceQuery || nonceQuery.nonce !== body.nonce) {
    return json({ message: "Missing or invalid edit nonce." }, { status: 403 });
  }

  if (Date.parse(nonceQuery.expires_at) < Date.now()) {
    return json({ message: "Edit nonce expired. Request a new signature." }, { status: 403 });
  }

  const verified = await verifyMessage({
    address: wallet,
    message: buildEditMessage(wallet, body.nonce),
    signature: body.signature as `0x${string}`,
  });

  if (!verified) {
    return json({ message: "Invalid signature." }, { status: 403 });
  }

  const profile = normalizeProfileInput(body.profile);
  const existing = await env.DB.prepare("SELECT * FROM slot_claims WHERE wallet = ?1")
    .bind(wallet)
    .first<SlotClaimRow>();

  if (!existing) {
    return json({ message: "No OG tile found for that wallet." }, { status: 404 });
  }

  await env.DB.prepare(
    `UPDATE slot_claims
     SET alias = ?2,
         display_type = ?3,
         display_value = ?4,
         display_color = ?5,
         project_name = ?6,
         project_description = ?7,
         twitter = ?8,
         farcaster = ?9,
         website = ?10,
         message = ?11,
         updated_at = CURRENT_TIMESTAMP
     WHERE wallet = ?1`,
  )
    .bind(
      wallet,
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

  await env.DB.prepare("DELETE FROM auth_nonces WHERE wallet = ?1").bind(wallet).run();

  const updated = await env.DB.prepare("SELECT * FROM slot_claims WHERE wallet = ?1")
    .bind(wallet)
    .first<SlotClaimRow>();

  return json({
    ok: true,
    claim: rowToClaim(updated!),
  });
};


