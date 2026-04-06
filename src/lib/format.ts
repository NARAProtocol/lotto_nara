import { formatUnits } from "viem";

export function formatNaraDisplay(value: bigint | string, fractionDigits = 3) {
  const bigintValue = typeof value === "string" ? BigInt(value) : value;
  return Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(Number(bigintValue) / 1e18);
}

export function formatEthDisplay(value: bigint | string, fractionDigits = 6) {
  const bigintValue = typeof value === "string" ? BigInt(value) : value;
  return Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(Number(bigintValue) / 1e18);
}

export function formatPercent(bps: number | bigint) {
  const bpsValue = typeof bps === "bigint" ? Number(bps) : bps;
  return `${(bpsValue / 100).toFixed(2)}%`;
}

export function shortAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function formatEpochCountdown(epochDelta: number) {
  const minutes = epochDelta * 15;
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = minutes / 60;
  if (hours < 24) {
    return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  }
  const days = hours / 24;
  return `${days.toFixed(days < 10 ? 1 : 0)}d`;
}

export function naraWeiToNumber(value: bigint | string) {
  const bigintValue = typeof value === "string" ? BigInt(value) : value;
  return Number(formatUnits(bigintValue, 18));
}

export function ethWeiToNumber(value: bigint | string) {
  const bigintValue = typeof value === "string" ? BigInt(value) : value;
  return Number(formatUnits(bigintValue, 18));
}

export function formatUsdAmount(value: number) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  const abs = Math.abs(value);
  const maximumFractionDigits = abs === 0 ? 2 : abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : abs >= 0.1 ? 2 : 3;
  const minimumFractionDigits = abs >= 1000 ? 0 : abs >= 100 ? 1 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

export function formatUsdPrice(value: number) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  const abs = Math.abs(value);
  const maximumFractionDigits = abs >= 100 ? 2 : abs >= 1 ? 2 : abs >= 0.1 ? 3 : 4;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: maximumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

export function formatNaraUsdApprox(value: bigint | string, priceUsd: number | null | undefined) {
  if (priceUsd == null) {
    return null;
  }
  return formatUsdAmount(naraWeiToNumber(value) * priceUsd);
}

export function formatEthUsdApprox(value: bigint | string, priceUsd: number | null | undefined) {
  if (priceUsd == null) {
    return null;
  }
  return formatUsdAmount(ethWeiToNumber(value) * priceUsd);
}

export function formatNaraWithUsdText(value: bigint | string, priceUsd: number | null | undefined) {
  const base = `${formatNaraDisplay(value)} NARA`;
  const usd = formatNaraUsdApprox(value, priceUsd);
  return usd ? `${base} (${usd})` : base;
}

export function formatEthWithUsdText(value: bigint | string, priceUsd: number | null | undefined) {
  const base = `${formatEthDisplay(value)} ETH`;
  const usd = formatEthUsdApprox(value, priceUsd);
  return usd ? `${base} (${usd})` : base;
}
