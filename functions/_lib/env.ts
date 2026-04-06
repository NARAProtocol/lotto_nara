import { DEFAULT_BASE_RPC_URL, getExcludedWallets } from "../../src/shared/nara";

export type Env = {
  DB: D1Database;
  BASE_RPC_URL?: string;
  EXCLUDED_WALLETS?: string;
};

export function getRpcUrl(env: Env) {
  return env.BASE_RPC_URL || DEFAULT_BASE_RPC_URL;
}

export function getExcludedWalletSet(env: Env) {
  return new Set(getExcludedWallets(env.EXCLUDED_WALLETS));
}
