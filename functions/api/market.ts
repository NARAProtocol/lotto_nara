import { NARA_TOKEN_ADDRESS } from "../../src/shared/nara";
import type { MarketApiResponse } from "../../src/shared/types";
import { json } from "../_lib/response";

type GeckoTokenResponse = {
  data?: {
    attributes?: {
      price_usd?: string | null;
    };
  };
};

const WETH_BASE_ADDRESS = "0x4200000000000000000000000000000000000006";

function geckoTokenUrl(address: string) {
  return `https://api.geckoterminal.com/api/v2/networks/base/tokens/${address.toLowerCase()}`;
}

async function fetchTokenPriceUsd(address: string) {
  try {
    const response = await fetch(geckoTokenUrl(address), {
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json<GeckoTokenResponse>();
    const rawPrice = payload.data?.attributes?.price_usd;
    const parsed = rawPrice ? Number(rawPrice) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch (error) {
    console.error("market fetch failed", error);
    return null;
  }
}

export const onRequestGet = async () => {
  const [naraPriceUsd, ethPriceUsd] = await Promise.all([
    fetchTokenPriceUsd(NARA_TOKEN_ADDRESS),
    fetchTokenPriceUsd(WETH_BASE_ADDRESS),
  ]);

  const payload: MarketApiResponse = {
    naraPriceUsd,
    ethPriceUsd,
    source: "geckoterminal",
    fetchedAt: new Date().toISOString(),
  };

  return json(payload, {
    headers: {
      "cache-control": "public, max-age=60, s-maxage=60",
    },
  });
};
