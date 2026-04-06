import { isAddress } from "viem";

import { buildEditMessage } from "../../src/shared/auth";
import type { RequestEditNonceRequest } from "../../src/shared/types";
import type { Env } from "../_lib/env";
import { json } from "../_lib/response";

export const onRequestPost = async ({ env, request }: { env: Env; request: Request }) => {
  const body = (await request.json()) as RequestEditNonceRequest;
  const wallet = body.wallet?.trim().toLowerCase();

  if (!wallet || !isAddress(wallet)) {
    return json({ message: "A valid wallet is required." }, { status: 400 });
  }

  const nonce = crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO auth_nonces (wallet, nonce, expires_at)
     VALUES (?1, ?2, ?3)
     ON CONFLICT(wallet) DO UPDATE SET nonce = excluded.nonce, expires_at = excluded.expires_at, created_at = CURRENT_TIMESTAMP`,
  )
    .bind(wallet, nonce, expiresAt)
    .run();

  return json({
    nonce,
    expiresAt,
    message: buildEditMessage(wallet, nonce),
  });
};
