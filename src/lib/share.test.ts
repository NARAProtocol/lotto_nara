import test from "node:test";
import assert from "node:assert/strict";

import { buildWarpcastShareUrl, buildXShareText } from "./share";
import type { BoardStats, SlotClaimRecord } from "../shared/types";

const sampleClaim: SlotClaimRecord = {
  slotNum: 4,
  wallet: "0xabc",
  txHash: "0xhash",
  positionId: 0,
  tierKey: "t500",
  grossAmountWei: "510204081632653061225",
  netAmountWei: "500000000000000000000",
  weight: "1500000000000000000000",
  activationEpoch: 1,
  unlockEpoch: 2,
  alias: "WolfDeFi",
  displayType: "letter",
  displayValue: "WD",
  displayColor: "#1F6FF2",
  projectName: "WolfDeFi",
  projectDescription: "",
  twitter: "",
  farcaster: "",
  website: "",
  message: "",
  createdAt: "2026-03-22T00:00:00.000Z",
  updatedAt: "2026-03-22T00:00:00.000Z",
};

const sampleStats: BoardStats = {
  claimedCount: 28,
  slotsLeft: 72,
  totalNetLockedWei: "0",
  tierRemaining: {
    t50: 20,
    t100: 20,
    t250: 14,
    t500: 3,
    t1000: 10,
  },
  recentClaims: [],
};

test("builds X share copy with weight and tier scarcity", () => {
  const text = buildXShareText(sampleClaim, sampleStats);
  assert.match(text, /WolfDeFi locked Founding Locker #04/i);
  assert.match(text, /500 \$NARA\. Lock weight: 1,500 \(3x multiplier\)\./i);
  assert.match(text, /Only 3 of 15 premium 500 \$NARA slots remain\./i);
});

test("builds Warpcast share URL with embed card", () => {
  const url = buildWarpcastShareUrl("hello world");
  assert.match(url, /text=hello\+world/);
  assert.match(url, /embeds%5B%5D=https%3A%2F%2Fwww\.naraprotocol\.io%2Fmine/);
});