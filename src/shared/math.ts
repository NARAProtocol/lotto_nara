const WAD = 10n ** 18n;

export function computeGrossRequiredWei(netAmountWei: bigint, lockFeeBps: bigint) {
  const denominator = 10_000n - lockFeeBps;
  return (netAmountWei * 10_000n + denominator - 1n) / denominator;
}

export function computeNetAfterFeeWei(grossAmountWei: bigint, lockFeeBps: bigint) {
  return grossAmountWei - (grossAmountWei * lockFeeBps) / 10_000n;
}

export function projectWarmupFactorWad(currentWarmupWad: bigint, warmupRateWad: bigint, steps: number) {
  let warmup = currentWarmupWad;
  for (let step = 0; step < steps; step += 1) {
    warmup += (warmupRateWad * (WAD - warmup)) / WAD;
  }
  return warmup;
}

export function estimateWarmupEpochsToTarget(currentWarmupWad: bigint, warmupRateWad: bigint, targetWarmupWad = 990000000000000000n, maxSteps = 40000) {
  if (currentWarmupWad >= targetWarmupWad || warmupRateWad <= 0n) {
    return 0;
  }

  let warmup = currentWarmupWad;
  for (let step = 1; step <= maxSteps; step += 1) {
    warmup += (warmupRateWad * (WAD - warmup)) / WAD;
    if (warmup >= targetWarmupWad) {
      return step;
    }
  }

  return maxSteps;
}
