import { buildBoardPayload, loadClaimRows } from "../_lib/board";
import type { Env } from "../_lib/env";
import { getExcludedWalletSet } from "../_lib/env";
import { json } from "../_lib/response";

export const onRequestGet = async ({ env }: { env: Env }) => {
  const claimRows = await loadClaimRows(env.DB);
  const payload = buildBoardPayload(claimRows, Array.from(getExcludedWalletSet(env)));
  return json(payload);
};
