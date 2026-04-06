import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

import { engineAbi, NARA_ENGINE_ADDRESS } from "../../src/shared/nara";
import type { EngineStatusApiResponse } from "../../src/shared/types";
import type { Env } from "../_lib/env";
import { getRpcUrl } from "../_lib/env";
import { json } from "../_lib/response";

type EpochSnapshotShape = { epoch?: bigint } & Partial<ReadonlyArray<unknown>>;

function getProcessedEpoch(snapshot: EpochSnapshotShape) {
  if (typeof snapshot.epoch === 'bigint') return snapshot.epoch;
  const first = snapshot[0];
  return typeof first === 'bigint' ? first : 0n;
}

export const onRequestGet = async ({ env }: { env: Env }) => {
  try {
    const publicClient = createPublicClient({
      chain: base,
      transport: http(getRpcUrl(env)),
    });

    const [
      currentEpoch,
      epochState,
      totalLocked,
      activeTotalWeight,
      pendingEthForNextEpoch,
      rewardReserveAvailable,
      totalRewardFundsAvailable,
      genesisTimestamp,
      epochLength,
    ] = await Promise.all([
      publicClient.readContract({
        address: NARA_ENGINE_ADDRESS,
        abi: engineAbi,
        functionName: "currentEpoch",
      }),
      publicClient.readContract({
        address: NARA_ENGINE_ADDRESS,
        abi: engineAbi,
        functionName: "epochState",
      }),
      publicClient.readContract({
        address: NARA_ENGINE_ADDRESS,
        abi: engineAbi,
        functionName: "totalLocked",
      }),
      publicClient.readContract({
        address: NARA_ENGINE_ADDRESS,
        abi: engineAbi,
        functionName: "activeTotalWeight",
      }),
      publicClient.readContract({
        address: NARA_ENGINE_ADDRESS,
        abi: engineAbi,
        functionName: "pendingEthForNextEpoch",
      }),
      publicClient.readContract({
        address: NARA_ENGINE_ADDRESS,
        abi: engineAbi,
        functionName: "rewardReserveAvailable",
      }),
      publicClient.readContract({
        address: NARA_ENGINE_ADDRESS,
        abi: engineAbi,
        functionName: "totalRewardFundsAvailable",
      }),
      publicClient.readContract({
        address: NARA_ENGINE_ADDRESS,
        abi: engineAbi,
        functionName: "genesisTimestamp",
      }),
      publicClient.readContract({
        address: NARA_ENGINE_ADDRESS,
        abi: engineAbi,
        functionName: "epochLength",
      }),
    ]);

    const processedEpoch = getProcessedEpoch(epochState as unknown as EpochSnapshotShape);
    const epochBacklog = currentEpoch > processedEpoch ? currentEpoch - processedEpoch : 0n;
    const epochEndsAtMs = Number((genesisTimestamp + (currentEpoch + 1n) * epochLength) * 1000n);

    const payload: EngineStatusApiResponse = {
      currentEpoch: Number(currentEpoch),
      processedEpoch: Number(processedEpoch),
      epochBacklog: Number(epochBacklog),
      epochEndsAt: new Date(epochEndsAtMs).toISOString(),
      totalLocked: totalLocked.toString(),
      activeTotalWeight: activeTotalWeight.toString(),
      pendingEthForNextEpoch: pendingEthForNextEpoch.toString(),
      rewardReserveAvailable: rewardReserveAvailable.toString(),
      totalRewardFundsAvailable: totalRewardFundsAvailable.toString(),
    };

    return json(payload, {
      headers: {
        "cache-control": "public, max-age=30, s-maxage=30",
      },
    });
  } catch (error) {
    console.error("engine-status fetch failed", error);
    return json(
      {
        ok: false,
        message: "engine_status_unavailable",
      },
      {
        status: 500,
        headers: {
          "cache-control": "public, max-age=5, s-maxage=5",
        },
      },
    );
  }
};
