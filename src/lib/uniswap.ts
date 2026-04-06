import { formatUnits } from "viem";

import { NARA_TOKEN_ADDRESS } from "../shared/nara";

const UNISWAP_SWAP_BASE = "https://app.uniswap.org/swap?chain=base&exactField=output";

export function buildUniswapBuyUrl(outputAmountWei: bigint) {
  const url = new URL(UNISWAP_SWAP_BASE);
  url.searchParams.set("outputCurrency", NARA_TOKEN_ADDRESS);
  url.searchParams.set("exactAmount", formatUnits(outputAmountWei, 18));
  return url.toString();
}
