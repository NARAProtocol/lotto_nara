import test from "node:test";
import assert from "node:assert/strict";

import { buildUniswapBuyUrl } from "./uniswap";
import { classifyPreflight } from "./preflight";
import { computeGrossRequiredWei, computeNetAfterFeeWei, estimateWarmupEpochsToTarget, projectWarmupFactorWad } from "../shared/math";
import { normalizeProfileInput } from "../shared/profile";

test("computes the exact gross needed for a 50 NARA OG tile at 2% fee", () => {
  const net = 50n * 10n ** 18n;
  const gross = computeGrossRequiredWei(net, 200n);
  assert.equal(gross, 51020408163265306123n);
  assert.ok(computeNetAfterFeeWei(gross, 200n) >= net);
});

test("classifies a wallet with no NARA as buy-nara after wallet, chain, and gas are ready", () => {
  const result = classifyPreflight({
    isConnected: true,
    chainId: 8453,
    nativeBalanceWei: 1n * 10n ** 15n,
    naraBalanceWei: 0n,
    allowanceWei: 0n,
    grossRequiredWei: 51020408163265306123n,
    lockFeeWei: 100000000000000n,
  });

  assert.equal(result.state, "buy-nara");
  assert.equal(result.shortfallWei, 51020408163265306123n);
});

test("classifies a ready wallet only after balance, chain, gas, and allowance all pass", () => {
  const result = classifyPreflight({
    isConnected: true,
    chainId: 8453,
    nativeBalanceWei: 1n * 10n ** 15n,
    naraBalanceWei: 60000000000000000000n,
    allowanceWei: 60000000000000000000n,
    grossRequiredWei: 51020408163265306123n,
    lockFeeWei: 100000000000000n,
  });

  assert.equal(result.state, "ready");
  assert.equal(result.shortfallWei, 0n);
});

test("builds the exact-output Base Uniswap URL for a 250 NARA OG tile", () => {
  assert.equal(
    buildUniswapBuyUrl(255102040816326530613n),
    "https://app.uniswap.org/swap?chain=base&exactField=output&outputCurrency=0xE444de61752bD13D1D37Ee59c31ef4e489bd727C&exactAmount=255.102040816326530613",
  );
});

test("sanitizes unsafe profile URLs while keeping valid https links", () => {
  const profile = normalizeProfileInput({
    alias: "OG",
    displayType: "image",
    displayValue: "javascript:alert(1)",
    website: "nara.build",
  });

  assert.equal(profile.displayValue, "");
  assert.equal(profile.website, "https://nara.build/");
});


test("projects protocol warmup and estimates epochs to near-full rate", () => {
  const rate = 1330000000000000n;
  const projected = projectWarmupFactorWad(0n, rate, 1);
  assert.equal(projected, rate);
  const steps = estimateWarmupEpochsToTarget(projected, rate);
  assert.ok(steps > 3000);
  assert.ok(steps < 4000);
});

