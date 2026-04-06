import { NARA_CHAIN_ID } from "../shared/nara";

export type PreflightState =
  | "connect"
  | "switch-chain"
  | "fund-base"
  | "buy-nara"
  | "approve"
  | "ready";

export type PreflightInput = {
  isConnected: boolean;
  chainId?: number;
  nativeBalanceWei?: bigint;
  naraBalanceWei?: bigint;
  allowanceWei?: bigint;
  grossRequiredWei: bigint;
  lockFeeWei: bigint;
};

export type PreflightResult = {
  state: PreflightState;
  shortfallWei: bigint;
};

export function classifyPreflight(input: PreflightInput): PreflightResult {
  if (!input.isConnected) {
    return { state: "connect", shortfallWei: input.grossRequiredWei };
  }

  if (input.chainId !== NARA_CHAIN_ID) {
    return { state: "switch-chain", shortfallWei: input.grossRequiredWei };
  }

  if ((input.nativeBalanceWei ?? 0n) < input.lockFeeWei) {
    return { state: "fund-base", shortfallWei: input.grossRequiredWei };
  }

  const naraBalanceWei = input.naraBalanceWei ?? 0n;
  if (naraBalanceWei < input.grossRequiredWei) {
    return {
      state: "buy-nara",
      shortfallWei: input.grossRequiredWei - naraBalanceWei,
    };
  }

  if ((input.allowanceWei ?? 0n) < input.grossRequiredWei) {
    return { state: "approve", shortfallWei: 0n };
  }

  return { state: "ready", shortfallWei: 0n };
}
