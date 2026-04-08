import { useState, useEffect, useCallback } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  useBalance,
  useReadContract,
  useWriteContract,
  usePublicClient,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { formatEther, parseEther, type Hash } from "viem";

import {
  NARA_CHAIN_ID,
  NARA_CHAIN_NAME,
  NARA_TOKEN_ADDRESS,
  NARA_LOTTO_POOL_ADDRESS,
  NARA_ENGINE_ADDRESS,
  tokenAbi,
  lottoPoolAbi,
  engineAbi,
} from "./shared/nara";

// Types

type FlashTone = "neutral" | "error" | "success" | "winner" | "draw-ready";

type Flash = {
  tone: FlashTone;
  text: string;
  txHash?: Hash;
};

type DrawRecord = {
  winner: string;
  potNara: bigint;
  potEth: bigint;
  txHash: string;
  blockNumber: bigint;
};

const MIN_ACTIVE_PLAYERS = 1;
const DRAW_SKIPPED_PRIZE_TOPIC = "0xe6dcf7e022617b5021f6fccd776b41ef2507d9d79f822160f704c9f7b84dac75";

// Helpers

function shortAddress(addr: string): string {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function formatAssetAmount(wei: bigint, standardDigits: number, smallDigits: number): string {
  if (wei === 0n) return "0";
  const value = Number(formatEther(wei));
  if (value > 0 && value < 0.01) {
    return value.toLocaleString(undefined, { maximumFractionDigits: smallDigits });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: standardDigits });
}

function formatNara(wei: bigint): string {
  return formatAssetAmount(wei, 2, 6);
}

function formatEth(wei: bigint): string {
  return formatAssetAmount(wei, 4, 8);
}

function formatBps(bps: bigint): string {
  return `${(Number(bps) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function txUrl(hash: Hash): string {
  return `https://basescan.org/tx/${hash}`;
}

function epochsToTime(epochs: number): string {
  const totalMinutes = epochs * 15;
  if (totalMinutes < 60) return `${totalMinutes}m`;
  if (totalMinutes < 1440) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(totalMinutes / 1440);
  const h = Math.floor((totalMinutes % 1440) / 60);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

function epochsToDate(baseEpoch: number, epochsFromNow: number): string {
  const msFromNow = epochsFromNow * 15 * 60 * 1000;
  return new Date(Date.now() + msFromNow).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function collectErrorText(error: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  function visit(value: unknown, depth = 0) {
    if (!value || depth > 4 || seen.has(value)) return;
    seen.add(value);
    if (typeof value === "string") { parts.push(value); return; }
    if (value instanceof Error) parts.push(value.message);
    if (typeof value === "object") {
      const r = value as Record<string, unknown>;
      for (const key of ["shortMessage", "message", "details", "reason"]) {
        if (typeof r[key] === "string") parts.push(r[key] as string);
      }
      visit(r.cause, depth + 1);
      visit(r.error, depth + 1);
    }
  }
  visit(error);
  return parts.filter(Boolean).join("\n");
}

function describeTxError(label: string, error: unknown): string {
  const rawText = collectErrorText(error);
  const raw = rawText.toLowerCase();
  if (/user rejected|user denied|action_rejected|denied transaction/.test(raw)) {
    return `${label} was cancelled in your wallet.`;
  }
  if (/insufficient funds|exceeds the balance/.test(raw)) {
    return "Not enough ETH for gas + protocol fee.";
  }
  if (/erc20insufficientbalance|transfer amount exceeds balance/.test(raw)) {
    return "Not enough NARA in your wallet.";
  }
  if (/erc20insufficientallowance|insufficient allowance/.test(raw)) {
    return "Approval amount is too low. Approve again.";
  }
  if (/enginebacklogtoolarge/.test(raw)) {
    return "The pool timer is too far behind for one transaction. Try again later or ask the team to run an epoch catch-up.";
  }
  if (/epochstale|epochnotready|failed_would_revert|would revert/.test(raw)) {
    return "The pool timer moved while the wallet was estimating. Refresh and try again; V2 syncs inside the action.";
  }
  if (/principalstilllocked|positionnotmatured/.test(raw)) {
    return "This lock is not withdrawable yet. Refresh and check the unlock epoch again.";
  }
  if (/invaliddepositamount/.test(raw)) {
    return "Entry amount is outside the pool's min/max range.";
  }
  if (/alreadyparticipating/.test(raw)) {
    return "This wallet already has an active entry. Withdraw it before joining again.";
  }
  if (/maxparticipantsreached/.test(raw)) {
    return "The pool is full right now. Wait for a spot to open.";
  }
  if (/drawnotready/.test(raw)) {
    return "The draw is not ready yet. Wait for the draw timer and at least one live entry.";
  }
  if (/drawalreadypending/.test(raw)) {
    return "A draw is already pending. Wait for Chainlink VRF to finish.";
  }
  if (/nativefeetransferfailed|insufficientfee/.test(raw)) {
    return "The ETH protocol fee is missing or too low. Check your Base ETH balance and try again.";
  }
  if (/nothingtoclaim|notparticipant/.test(raw)) {
    return label + " found nothing claimable for this wallet. Refresh and check the position again.";
  }
  if (/smart transaction failed|transaction receipt with hash .* could not be found|could not be found|originaltransactionstatus|cancelled|canceled/.test(raw)) {
    return "The wallet dropped this request before Base accepted it. Refresh and retry.";
  }
  const first = rawText.split("\n")[0];
  return first || `${label} failed. Try again.`;
}

// Components

function CaretIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="nb-wallet-caret">
      <path d="M2.25 4.5L6 8.25L9.75 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WalletHeroButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, authenticationStatus, openAccountModal, openChainModal, openConnectModal }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected = ready && account && chain && (!authenticationStatus || authenticationStatus === "authenticated");

        if (!ready) {
          return <div className="nb-wallet-trigger ghost" aria-hidden="true">Loading</div>;
        }
        if (!connected) {
          return <button type="button" className="nb-wallet-trigger" onClick={openConnectModal}>Connect Wallet</button>;
        }
        if (chain.unsupported) {
          return <button type="button" className="nb-wallet-trigger" onClick={openChainModal}>{`Switch to ${NARA_CHAIN_NAME}`}</button>;
        }
        return (
          <button type="button" className="nb-wallet-hero-btn" onClick={openAccountModal}>
            {account.displayBalance ? <span className="nb-wallet-balance">{account.displayBalance}</span> : null}
            <span className="nb-wallet-chip">
              {account.ensAvatar
                ? <img className="nb-wallet-avatar" src={account.ensAvatar} alt={account.displayName} />
                : <span className="nb-wallet-avatar-fallback">{account.displayName.slice(0, 1).toUpperCase()}</span>}
              <span className="nb-wallet-address">{shortAddress(account.address)}</span>
              <CaretIcon />
            </span>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

function WalletActionButton({
  className = "nb-btn-primary",
  connectLabel = "Connect Wallet",
  switchLabel = `Switch to ${NARA_CHAIN_NAME}`,
}: {
  className?: string;
  connectLabel?: string;
  switchLabel?: string;
}) {
  return (
    <ConnectButton.Custom>
      {({ mounted, authenticationStatus, chain, openConnectModal, openChainModal }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const label = !ready ? "Loading..." : chain?.unsupported ? switchLabel : connectLabel;
        const onClick = chain?.unsupported ? openChainModal : openConnectModal;

        return (
          <button type="button" className={className} onClick={onClick} disabled={!ready}>
            {label}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

function WalletSetupCard({
  title,
  body,
  connectLabel = "Connect Wallet",
  switchLabel = `Switch to ${NARA_CHAIN_NAME}`,
}: {
  title: string;
  body: string;
  connectLabel?: string;
  switchLabel?: string;
}) {
  return (
    <div className="nb-wallet-help">
      <p className="nb-wallet-help-title">{title}</p>
      <p className="nb-wallet-help-text">{body}</p>
      <WalletActionButton connectLabel={connectLabel} switchLabel={switchLabel} />
    </div>
  );
}

// Main App

export default function App() {
  const { address, chainId, isConnected } = useAccount();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [depositAmount, setDepositAmount] = useState("");
  const [flash, setFlash] = useState<Flash | null>(null);
  const [txStep, setTxStep] = useState<"idle" | "approving" | "depositing" | "withdrawing" | "drawing" | "claiming">("idle");
  const [drawHistory] = useState<DrawRecord[]>([]);
  const [liveParticipantCount, setLiveParticipantCount] = useState<number | null>(null);
  const [liveParticipantWeight, setLiveParticipantWeight] = useState<bigint | null>(null);
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);

  const isWrongNetwork = Boolean(isConnected && chainId != null && chainId !== NARA_CHAIN_ID);

  // Contract reads

  const potNaraRead = useReadContract({
    address: NARA_LOTTO_POOL_ADDRESS,
    abi: lottoPoolAbi,
    functionName: "potNara",
  });

  const potEthRead = useReadContract({
    address: NARA_LOTTO_POOL_ADDRESS,
    abi: lottoPoolAbi,
    functionName: "potEth",
  });

  const participantCountRead = useReadContract({
    address: NARA_LOTTO_POOL_ADDRESS,
    abi: lottoPoolAbi,
    functionName: "participantCount",
  });

  const lastDrawEpochRead = useReadContract({
    address: NARA_LOTTO_POOL_ADDRESS,
    abi: lottoPoolAbi,
    functionName: "lastDrawEpoch",
  });

  const pendingDrawRequestIdRead = useReadContract({
    address: NARA_LOTTO_POOL_ADDRESS,
    abi: lottoPoolAbi,
    functionName: "pendingDrawRequestId",
  });

  const poolConfigRead = useReadContract({
    address: NARA_LOTTO_POOL_ADDRESS,
    abi: lottoPoolAbi,
    functionName: "config",
  });

  const participantDataRead = useReadContract({
    address: NARA_LOTTO_POOL_ADDRESS,
    abi: lottoPoolAbi,
    functionName: "userToParticipant",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const pData = participantDataRead.data as any;
  const participantCloneAddress = (pData?.cloneAddress ?? pData?.[1]) as `0x${string}` | undefined;

  const participantPositionRead = useReadContract({
    address: NARA_ENGINE_ADDRESS,
    abi: engineAbi,
    functionName: 'positionAt',
    args: participantCloneAddress ? [participantCloneAddress, 0n] : undefined,
    query: { enabled: Boolean(participantCloneAddress && !isWrongNetwork) },
  });

  const winningsNaraRead = useReadContract({
    address: NARA_LOTTO_POOL_ADDRESS,
    abi: lottoPoolAbi,
    functionName: "userWinningsNara",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const winningsEthRead = useReadContract({
    address: NARA_LOTTO_POOL_ADDRESS,
    abi: lottoPoolAbi,
    functionName: "userWinningsEth",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const tokenAllowanceRead = useReadContract({
    address: NARA_TOKEN_ADDRESS,
    abi: tokenAbi,
    functionName: "allowance",
    args: address ? [address, NARA_LOTTO_POOL_ADDRESS as `0x${string}`] : undefined,
    query: { enabled: Boolean(address) },
  });

  const tokenBalanceRead = useReadContract({
    address: NARA_TOKEN_ADDRESS,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && !isWrongNetwork) },
  });

  const nativeBalanceRead = useBalance({
    address,
    chainId: NARA_CHAIN_ID,
    query: { enabled: Boolean(address && !isWrongNetwork) },
  });

  const lockFeeBpsRead = useReadContract({
    address: NARA_ENGINE_ADDRESS,
    abi: engineAbi,
    functionName: "lockFeeBps",
  });

  const claimFeeBpsRead = useReadContract({
    address: NARA_ENGINE_ADDRESS,
    abi: engineAbi,
    functionName: "claimFeeBps",
  });

  const lockFeeWeiRead = useReadContract({
    address: NARA_ENGINE_ADDRESS,
    abi: engineAbi,
    functionName: "lockFeeWei",
  });

  const unlockFeeWeiRead = useReadContract({
    address: NARA_ENGINE_ADDRESS,
    abi: engineAbi,
    functionName: "unlockFeeWei",
  });

  const currentEpochRead = useReadContract({
    address: NARA_ENGINE_ADDRESS,
    abi: engineAbi,
    functionName: "currentEpoch",
  });

  const epochStateRead = useReadContract({
    address: NARA_ENGINE_ADDRESS,
    abi: engineAbi,
    functionName: "epochState",
  });

  // Preview weight when amount is entered
  const poolConfig = poolConfigRead.data as any;
  const lockDurationEpochs = poolConfig ? BigInt(poolConfig.lockDurationEpochs ?? 0n) : 0n;

  const parsedDepositAmount = (() => {
    const raw = depositAmount.trim().replace(/,(\d{3})/g, "$1");
    const normalized = raw.replace(",", ".");
    if (!normalized) return { amountWei: 0n, invalid: false };
    try { return { amountWei: parseEther(normalized), invalid: false }; } catch { return { amountWei: 0n, invalid: true }; }
  })();

  const amountWei = parsedDepositAmount.amountWei;
  const amountInputInvalid = parsedDepositAmount.invalid;

  const previewWeightRead = useReadContract({
    address: NARA_ENGINE_ADDRESS,
    abi: engineAbi,
    functionName: "previewWeight",
    args: amountWei > 0n && lockDurationEpochs > 0n ? [amountWei, lockDurationEpochs] : undefined,
    query: { enabled: amountWei > 0n && lockDurationEpochs > 0n },
  });

  // Derived values

  const epochStateData = epochStateRead.data as any;
  const liveEpoch = Number(BigInt(currentEpochRead.data ?? 0));
  const settledEpoch = Number(epochStateData?.[0] ?? epochStateData?.epoch ?? 0n);
  const currentEpoch = liveEpoch > 0 ? liveEpoch : settledEpoch;
  const backlog = Math.max(0, currentEpoch - settledEpoch);
  const engineSyncRequired = backlog > 0;

  const potNara = BigInt((potNaraRead.data as any) ?? 0);
  const potEth = BigInt((potEthRead.data as any) ?? 0);
  const prizePoolIsEmpty = potNara === 0n && potEth === 0n;
  const participantCount = Number(BigInt((participantCountRead.data as any) ?? 0));
  const lastDrawEpoch = Number(BigInt((lastDrawEpochRead.data as any) ?? 0));
  const pendingDrawRequestId = BigInt((pendingDrawRequestIdRead.data as any) ?? 0);
  const maxParticipants = poolConfig ? Number(BigInt(poolConfig.maxParticipants ?? 100)) : 100;
  const drawFrequencyEpochs = poolConfig ? Number(BigInt(poolConfig.drawFrequencyEpochs ?? 0)) : 0;
  const minDepositAmount = poolConfig ? BigInt(poolConfig.minDepositAmount ?? 0) : 0n;
  const maxDepositAmount = poolConfig ? BigInt(poolConfig.maxDepositAmount ?? 0) : 0n;
  const minDrawPotNara = poolConfig ? BigInt(poolConfig.minDrawPotNara ?? 0) : 0n;
  const minDrawPotEth = poolConfig ? BigInt(poolConfig.minDrawPotEth ?? 0) : 0n;
  const minPrizeLabel = minDrawPotNara > 0n && minDrawPotEth > 0n
    ? `${formatNara(minDrawPotNara)} NARA or ${formatEth(minDrawPotEth)} ETH`
    : minDrawPotNara > 0n
      ? `${formatNara(minDrawPotNara)} NARA`
      : `${formatEth(minDrawPotEth)} ETH`;
  const openSpots = Math.max(0, maxParticipants - participantCount);
  const liveEntriesKnown = liveParticipantCount !== null && liveParticipantWeight !== null;
  const liveEntries = liveParticipantCount ?? 0;
  const liveLottoWeight = liveParticipantWeight ?? 0n;

  const isParticipant = Boolean(pData?.isActive ?? (pData && pData[4] === true));
  const userWeight = isParticipant ? BigInt(pData?.weight ?? pData?.[3] ?? 0n) : 0n;
  const activationEpoch = isParticipant ? Number(pData?.activationEpoch ?? pData?.[2] ?? 0n) : 0;
  const positionData = participantPositionRead.data as any;
  const participantNetAmount = isParticipant ? BigInt(positionData?.amount ?? positionData?.[0] ?? 0n) : 0n;
  const positionUnlockEpoch = isParticipant ? Number(positionData?.unlockEpoch ?? positionData?.[4] ?? 0n) : 0;
  const unlockEpoch = isParticipant ? (positionUnlockEpoch > 0 ? positionUnlockEpoch : activationEpoch + Number(lockDurationEpochs)) : 0;
  const entryStartsInEpochs = isParticipant ? Math.max(0, activationEpoch - settledEpoch) : 0;
  const entryIsLive = isParticipant && entryStartsInEpochs === 0;
  const unlocksInEpochs = isParticipant ? Math.max(0, unlockEpoch - settledEpoch) : 0;

  const winningsNara = BigInt(winningsNaraRead.data ?? 0);
  const winningsEth = BigInt(winningsEthRead.data ?? 0);
  const hasWinnings = winningsNara > 0n || winningsEth > 0n;

  const userOddsPercent = entryIsLive && liveEntriesKnown && liveLottoWeight > 0n && userWeight > 0n
    ? Number((userWeight * 10000n) / liveLottoWeight) / 100
    : entryIsLive && liveEntriesKnown && liveEntries === 1
      ? 100
      : 0;

  const allowance = BigInt(tokenAllowanceRead.data ?? 0);
  const naraBalance = BigInt(tokenBalanceRead.data ?? 0);
  const nativeBalance = BigInt(nativeBalanceRead.data?.value ?? 0);
  const lockFeeWei = BigInt(lockFeeWeiRead.data ?? 0);
  const unlockFeeWei = BigInt(unlockFeeWeiRead.data ?? 0);
  const lockFeeBps = BigInt(lockFeeBpsRead.data ?? 0);
  const claimFeeBps = BigInt(claimFeeBpsRead.data ?? 0);
  const claimFeeLabel = claimFeeBpsRead.data == null ? 'loading' : formatBps(claimFeeBps);
  const naraBalanceKnown = tokenBalanceRead.data != null;
  const nativeBalanceKnown = nativeBalanceRead.data?.value != null;
  const lockFeeNara = amountWei > 0n ? (amountWei * lockFeeBps) / 10000n : 0n;
  const netLockAmount = amountWei > lockFeeNara ? amountWei - lockFeeNara : 0n;
  const hasNaraShortfall = amountWei > 0n && naraBalanceKnown && naraBalance < amountWei;
  const hasLockEthShortfall = amountWei > 0n && nativeBalanceKnown && lockFeeWei > 0n && nativeBalance < lockFeeWei;
  const isApproved = amountWei > 0n && allowance >= amountWei;

  const drawTimerFinished = pendingDrawRequestId === 0n
    && participantCount > 0
    && drawFrequencyEpochs > 0
    && settledEpoch >= lastDrawEpoch + drawFrequencyEpochs;

  const drawPending = pendingDrawRequestId !== 0n;
  const drawReady = drawTimerFinished && liveEntriesKnown && liveEntries > 0;
  const drawWaitingForLiveEntry = drawTimerFinished && liveEntriesKnown && liveEntries === 0;
  const nextDrawEpoch = drawFrequencyEpochs > 0 ? lastDrawEpoch + drawFrequencyEpochs : 0;

  const epochsUntilDraw = drawFrequencyEpochs > 0
    ? Math.max(0, nextDrawEpoch - settledEpoch)
    : 0;

  const canDeposit = !isParticipant
    && Boolean(poolConfig)
    && !amountInputInvalid
    && amountWei >= minDepositAmount
    && (maxDepositAmount === 0n || amountWei <= maxDepositAmount)
    && participantCount < maxParticipants
    && !hasNaraShortfall
    && !hasLockEthShortfall;

  const lockProgressPct = isParticipant && lockDurationEpochs > 0n
    ? Math.min(100, Math.max(0, Math.round(((settledEpoch - activationEpoch) / Number(lockDurationEpochs)) * 100)))
    : 0;

  const canWithdraw = isParticipant && settledEpoch >= unlockEpoch;
  const canWithdrawAfterSync = isParticipant && !canWithdraw && engineSyncRequired && liveEpoch >= unlockEpoch;
  const withdrawActionReady = canWithdraw || canWithdrawAfterSync;
  const hasUnlockEthShortfall = withdrawActionReady && nativeBalanceKnown && unlockFeeWei > 0n && nativeBalance < unlockFeeWei;

  const previewWeight = BigInt(previewWeightRead.data ?? 0);
  const previewTotalWeight = liveLottoWeight + previewWeight;
  const previewOdds = liveEntriesKnown && previewWeight > 0n && previewTotalWeight > 0n
    ? Number((previewWeight * 10000n) / previewTotalWeight) / 100
    : 0;

  const amountError = amountInputInvalid
    ? "Enter a valid NARA amount like 100 or 100.5."
    : amountWei > 0n
      ? amountWei < minDepositAmount
        ? `Minimum entry is ${formatNara(minDepositAmount)} NARA.`
        : maxDepositAmount > 0n && amountWei > maxDepositAmount
          ? `Maximum entry is ${formatNara(maxDepositAmount)} NARA.`
          : openSpots === 0
            ? "The pool is full right now. Please wait for an open spot."
            : hasNaraShortfall
              ? `Wallet has ${formatNara(naraBalance)} NARA. You need ${formatNara(amountWei)} NARA.`
              : hasLockEthShortfall
                ? `You need at least ${formatEth(lockFeeWei)} ETH on Base for the join fee, plus gas.`
                : null
      : null;

  // Draw history fetch

  // Draw history via getLogs is disabled — no draws have occurred yet
  // and the Alchemy free-tier RPC rejects getLogs calls with 400.
  // Re-enable when the first VRF draw completes.
  const fetchDrawHistory = useCallback(() => {}, []);

  useEffect(() => {
    let cancelled = false;

    async function loadLiveParticipantCount() {
      if (!publicClient) {
        return;
      }

      if (participantCountRead.data == null) {
        if (!cancelled) {
          setLiveParticipantCount(null);
          setLiveParticipantWeight(null);
        }
        return;
      }

      if (participantCount === 0) {
        if (!cancelled) {
          setLiveParticipantCount(0);
          setLiveParticipantWeight(0n);
        }
        return;
      }

      setLiveParticipantCount(null);
      setLiveParticipantWeight(null);

      try {
        const BATCH_SIZE = 25;
        const addressContracts = Array.from({ length: participantCount }, (_, index) => ({
          address: NARA_LOTTO_POOL_ADDRESS as `0x${string}`,
          abi: lottoPoolAbi,
          functionName: "participantAddresses",
          args: [BigInt(index)] as const,
        }));
        const addressResults: Array<{ status: string; result?: unknown }> = [];
        for (let i = 0; i < addressContracts.length; i += BATCH_SIZE) {
          const batch = addressContracts.slice(i, i + BATCH_SIZE);
          const batchResults = await publicClient.multicall({ allowFailure: true, contracts: batch }) as Array<{ status: string; result?: unknown }>;
          addressResults.push(...batchResults);
        }

        const participantAddresses = addressResults.flatMap((result) =>
          result.status === "success" && typeof result.result === "string" ? [result.result as `0x${string}`] : [],
        );

        if (participantAddresses.length === 0) {
          if (!cancelled) {
            setLiveParticipantCount(0);
            setLiveParticipantWeight(0n);
          }
          return;
        }

        const participantContracts = participantAddresses.map((participantAddress) => ({
          address: NARA_LOTTO_POOL_ADDRESS as `0x${string}`,
          abi: lottoPoolAbi,
          functionName: "userToParticipant",
          args: [participantAddress] as const,
        }));
        const participantResults: Array<{ status: string; result?: unknown }> = [];
        for (let i = 0; i < participantContracts.length; i += BATCH_SIZE) {
          const batch = participantContracts.slice(i, i + BATCH_SIZE);
          const batchResults = await publicClient.multicall({ allowFailure: true, contracts: batch }) as Array<{ status: string; result?: unknown }>;
          participantResults.push(...batchResults);
        }

        let nextLiveCount = 0;
        let nextLiveWeight = 0n;
        for (const result of participantResults) {
          if (result.status !== "success") continue;
          const participant = result.result as any;
          const active = Boolean(participant?.isActive ?? participant?.[4] ?? false);
          const activation = Number(participant?.activationEpoch ?? participant?.[2] ?? 0n);
          const weight = BigInt(participant?.weight ?? participant?.[3] ?? 0n);
          if (active && weight > 0n && settledEpoch >= activation) {
            nextLiveCount += 1;
            nextLiveWeight += weight;
          }
        }

        if (!cancelled) {
          setLiveParticipantCount(nextLiveCount);
          setLiveParticipantWeight(nextLiveWeight);
        }
      } catch {
        if (!cancelled) {
          setLiveParticipantCount(null);
          setLiveParticipantWeight(null);
        }
      }
    }

    void loadLiveParticipantCount();

    return () => {
      cancelled = true;
    };
  }, [participantCount, participantCountRead.data, publicClient, settledEpoch]);

  // Invalidate queries helper

  const invalidateLotto = useCallback(() => {
    queryClient.invalidateQueries();
  }, [queryClient]);

  const ensureWalletReady = useCallback((action: string) => {
    if (!isConnected) {
      setFlash({ tone: "error", text: `Connect your wallet to ${action}.` });
      return false;
    }

    if (isWrongNetwork) {
      setFlash({ tone: "error", text: `Switch your wallet to ${NARA_CHAIN_NAME} before you ${action}.` });
      return false;
    }

    return true;
  }, [isConnected, isWrongNetwork]);

  const ensureTransactionReady = useCallback((action: string) => {
    if (!ensureWalletReady(action)) return false;
    if (!publicClient) {
      setFlash({ tone: "error", text: "Base RPC is not ready yet. Wait a moment and try again." });
      return false;
    }
    return true;
  }, [ensureWalletReady, publicClient]);

  const waitForConfirmation = useCallback(async (hash: Hash, label: string) => {
    if (!publicClient) throw new Error("Base RPC is not ready yet.");
    setFlash({ tone: "neutral", text: `${label} submitted. Waiting for Base confirmation.`, txHash: hash });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      throw new Error(`${label} reverted on Base.`);
    }
    return receipt;
  }, [publicClient]);

  // Tx handlers

  const handleApprove = async () => {
    if (!ensureTransactionReady("approve NARA") || !depositAmount || amountWei === 0n || amountError) return;
    setTxStep("approving");
    setFlash({ tone: "neutral", text: `Step 1 of 2 - Approve ${formatNara(amountWei)} NARA for the prize pool. Confirm in your wallet.` });
    try {
      const hash = await writeContractAsync({
        address: NARA_TOKEN_ADDRESS,
        abi: tokenAbi,
        functionName: "approve",
        args: [NARA_LOTTO_POOL_ADDRESS as `0x${string}`, amountWei],
      });
      await waitForConfirmation(hash, "Approval");
      setFlash({ tone: "success", text: `${formatNara(amountWei)} NARA approval confirmed for the prize pool.`, txHash: hash });
      await tokenAllowanceRead.refetch();
      invalidateLotto();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Approval", err) });
    } finally {
      setTxStep("idle");
    }
  };

  const handleDeposit = async () => {
    if (!ensureTransactionReady("enter the draw") || !depositAmount || lockFeeWeiRead.data == null || amountError) return;
    setTxStep("depositing");
    setFlash({ tone: "neutral", text: `Step 2 of 2 - Joining with ${formatNara(amountWei)} NARA. This sends ${formatEth(lockFeeWei)} ETH fee plus gas. V2 syncs the engine inside this transaction if needed.` });
    try {
      const hash = await writeContractAsync({
        address: NARA_LOTTO_POOL_ADDRESS,
        abi: lottoPoolAbi,
        functionName: "deposit",
        args: [amountWei],
        value: lockFeeWei,
      });
      await waitForConfirmation(hash, "Join pool");
      setFlash({
        tone: "success",
        text: drawTimerFinished
          ? "You joined the prize pool. Your entry is warming up, so the draw should wait until it goes live."
          : "You joined the prize pool. Your entry starts counting after a short warm-up.",
        txHash: hash,
      });
      setDepositAmount("");
      invalidateLotto();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Deposit", err) });
    } finally {
      setTxStep("idle");
    }
  };

  const handleWithdraw = async () => {
    if (!ensureTransactionReady("withdraw principal") || unlockFeeWeiRead.data == null) return;
    if (hasUnlockEthShortfall) {
      setFlash({ tone: "error", text: `You need at least ${formatEth(unlockFeeWei)} ETH on Base for the unlock fee, plus gas.` });
      return;
    }
    setTxStep("withdrawing");
    setFlash({ tone: "neutral", text: `Withdrawing your net locked NARA. V2 syncs the engine and moves your clone yield into the jackpot before unlock. This sends ${formatEth(unlockFeeWei)} ETH unlock fee plus gas.` });
    try {
      const hash = await writeContractAsync({
        address: NARA_LOTTO_POOL_ADDRESS,
        abi: lottoPoolAbi,
        functionName: "withdraw",
        value: unlockFeeWei,
      });
      await waitForConfirmation(hash, "Withdrawal");
      setFlash({ tone: "success", text: "Withdrawal confirmed. Your net locked NARA was sent back to your wallet.", txHash: hash });
      invalidateLotto();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Withdrawal", err) });
    } finally {
      setTxStep("idle");
    }
  };

  const handleDrawWinner = async () => {
    if (!ensureTransactionReady("trigger the draw")) return;
    setTxStep("drawing");
    setFlash({ tone: "neutral", text: "Running the draw check. V2 syncs the engine and moves available yield into the jackpot first; Chainlink VRF starts only if the jackpot meets the minimum." });
    try {
      const hash = await writeContractAsync({
        address: NARA_LOTTO_POOL_ADDRESS,
        abi: lottoPoolAbi,
        functionName: "drawWinner",
      });
      const receipt = await waitForConfirmation(hash, "Draw request");
      const skippedForSmallPrize = receipt.logs.some((log) =>
        log.address.toLowerCase() === NARA_LOTTO_POOL_ADDRESS.toLowerCase()
        && log.topics[0] === DRAW_SKIPPED_PRIZE_TOPIC,
      );
      setFlash({
        tone: skippedForSmallPrize ? "success" : "neutral",
        text: skippedForSmallPrize
          ? `Draw check confirmed. V2 moved any available yield, but the jackpot is still below the ${minPrizeLabel} minimum, so no VRF draw started yet.`
          : "Prize draw request confirmed. Waiting for Chainlink VRF randomness.",
        txHash: hash,
      });
      invalidateLotto();
      fetchDrawHistory();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Draw trigger", err) });
    } finally {
      setTxStep("idle");
    }
  };

  const handleClaimWinnings = async () => {
    if (!ensureTransactionReady("claim winnings")) return;
    setTxStep("claiming");
    setFlash({ tone: "neutral", text: "Claiming your prize. Confirm in your wallet." });
    try {
      const hash = await writeContractAsync({
        address: NARA_LOTTO_POOL_ADDRESS,
        abi: lottoPoolAbi,
        functionName: "claimWinnings",
      });
      await waitForConfirmation(hash, "Prize claim");
      setFlash({ tone: "success", text: "Winnings claim confirmed and sent to your wallet.", txHash: hash });
      invalidateLotto();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Claim", err) });
    } finally {
      setTxStep("idle");
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedAddr(text);
      setTimeout(() => setCopiedAddr(null), 1500);
    });
  };

  const isBusy = txStep !== "idle";

  // Preset amounts derived from pool config
  const presetAmounts = poolConfig
    ? [
        minDepositAmount,
        minDepositAmount * 2n > 0n ? minDepositAmount * 2n : null,
        maxDepositAmount > 0n && maxDepositAmount !== minDepositAmount ? maxDepositAmount / 2n : null,
        maxDepositAmount > 0n ? maxDepositAmount : null,
      ].filter((v): v is bigint => v !== null && v > 0n)
        .filter((v, i, arr) => arr.findIndex(x => x === v) === i)
        .slice(0, 4)
    : [];

  // Render

  return (
    <>
    <a href="#main-content" className="nb-skip-link">Skip to main content</a>

    {/* Draw drama overlay — shown when Chainlink VRF is running */}
    {drawPending && (
      <div className="nb-draw-overlay" role="status" aria-live="polite">
        <div className="nb-draw-overlay-orb" aria-hidden="true" />
        <p className="nb-draw-overlay-title">Picking The Winner</p>
        <p className="nb-draw-overlay-sub">Chainlink VRF on-chain &mdash; randomness incoming</p>
      </div>
    )}

    <main id="main-content">
    <div className="nb-shell">

      {/* Nav */}
      <header className="nb-nav">
        <div className="nb-nav-brand">
          <h1><span className="nb-brand-accent">NARA</span> Lucky Epoch</h1>
          <div className="nb-epoch-pill">
            <span className="nb-epoch-dot" />
            <span>Epoch</span>
            <span className="nb-epoch-num">{currentEpoch > 0 ? currentEpoch.toLocaleString() : "..."}</span>
          </div>
        </div>
        <div className="nb-nav-actions">
          <WalletHeroButton />
        </div>
      </header>

      {/* ── HERO: jackpot billboard top, join panel below ── */}
      <section className="nb-hero" aria-label="Prize pool and entry">

        {/* Jackpot billboard — weight 10 HERO, dark inverted card */}
        <div className="nb-jackpot">
          <div className="nb-jackpot-ring" aria-hidden="true" />
          <div className="nb-jackpot-ring nb-jackpot-ring--2" aria-hidden="true" />
          <p className="nb-jackpot-label">Jackpot</p>
          <div className="nb-jackpot-stack">
            <div className="nb-jackpot-row">
              <span className="nb-jackpot-num">{formatNara(potNara)}</span>
              <span className="nb-jackpot-ticker">NARA</span>
            </div>
            <div className="nb-jackpot-sep">
              <span className="nb-jackpot-sep-line" />
              <span className="nb-jackpot-sep-plus">+</span>
              <span className="nb-jackpot-sep-line" />
            </div>
            <div className="nb-jackpot-row nb-jackpot-row--eth">
              <span className="nb-jackpot-num nb-jackpot-num--eth">{formatEth(potEth)}</span>
              <span className="nb-jackpot-ticker">ETH</span>
            </div>
          </div>
          <div className="nb-jackpot-foot">
            <span className="nb-jackpot-badge">
              <span className="nb-live-dot" />
              Live on Base
            </span>
            <span className="nb-jackpot-badge">No-Loss</span>
            <span className="nb-jackpot-badge">Chainlink VRF</span>
          </div>
        </div>

        {/* Join CTA */}
        <div className="nb-join-panel">
          <h2 className="nb-join-title">Enter The Draw</h2>
          <p className="nb-join-sub">
            Lock NARA, keep your principal, one entry wins the yield.
            {poolConfig ? ` Lock period: ${epochsToTime(Number(lockDurationEpochs))}.` : ""}
          </p>

          {!isConnected ? (
            <div className="nb-wallet-help">
              <p className="nb-wallet-help-title">Connect to enter</p>
              <p className="nb-wallet-help-text">MetaMask or any supported wallet on Base.</p>
              <WalletActionButton connectLabel="Connect Wallet" />
            </div>
          ) : isWrongNetwork ? (
            <div className="nb-wallet-help">
              <p className="nb-wallet-help-title">Switch to {NARA_CHAIN_NAME}</p>
              <p className="nb-wallet-help-text">Approvals and joins only work on Base.</p>
              <WalletActionButton />
            </div>
          ) : isParticipant ? (
            <div className="nb-already-joined">
              <span className="nb-badge warming">Already In</span>
              <p className="nb-info-text">Your entry is in the pool. Check status below.</p>
            </div>
          ) : (
            <>
              {/* Quick-select presets */}
              {presetAmounts.length > 0 && (
                <div className="nb-presets" role="group" aria-label="Quick amounts">
                  {presetAmounts.map((amt) => (
                    <button
                      key={String(amt)}
                      type="button"
                      className={`nb-preset-btn${amountWei === amt ? " active" : ""}`}
                      onClick={() => setDepositAmount(formatEther(amt))}
                      disabled={isBusy}
                    >
                      {formatNara(amt)}
                    </button>
                  ))}
                </div>
              )}

              {(txStep === "approving" || txStep === "depositing") && (
                <div className="nb-step-indicator">
                  <span className="nb-step-dot" />
                  {txStep === "approving" ? "Step 1 of 2 — Approve NARA" : "Step 2 of 2 — Joining pool"}
                </div>
              )}

              <div className="nb-input-wrap">
                <label htmlFor="deposit-amount" className="nb-input-label">Amount (NARA)</label>
                <input
                  id="deposit-amount"
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[.,]?[0-9]*"
                  className="nb-input"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder={minDepositAmount > 0n ? formatNara(minDepositAmount) : "0"}
                  disabled={isBusy}
                />
                {amountError && <p className="nb-input-error">{amountError}</p>}
              </div>

              {/* Odds preview — only shown when amount is entered */}
              {amountWei > 0n && (
                <div className="nb-odds-strip">
                  <span className="nb-odds-label">Your odds if you join now</span>
                  <span className="nb-odds-value">
                    {previewWeight > 0n ? previewOdds.toFixed(2) + "%" : "..."}
                  </span>
                </div>
              )}

              {/* Fee summary — collapsed, not over-explained */}
              {amountWei > 0n && (
                <div className="nb-fee-block">
                  <div className="nb-fee-row">
                    <span>Net locked</span>
                    <span className="nb-fee-val">{formatNara(netLockAmount)} NARA</span>
                  </div>
                  <div className="nb-fee-row">
                    <span>Join fee</span>
                    <span className="nb-fee-val">{formatEth(lockFeeWei)} ETH + gas</span>
                  </div>
                  <div className="nb-fee-row">
                    <span>Unlocks</span>
                    <span className="nb-fee-val">{epochsToDate(currentEpoch, Number(lockDurationEpochs))}</span>
                  </div>
                </div>
              )}

              {engineSyncRequired && (
                <div className="nb-soft-note">
                  Engine {backlog} epoch{backlog === 1 ? "" : "s"} behind — V2 auto-syncs inside join.
                </div>
              )}

              {hasNaraShortfall && amountWei > 0n ? (
                <div className="nb-button-row">
                  <a
                    href={`https://app.uniswap.org/swap?chain=base&outputCurrency=0xE444de61752bD13D1D37Ee59c31ef4e489bd727C`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="nb-btn-primary nb-btn-get-nara"
                  >
                    Get NARA on Uniswap ↗
                  </a>
                </div>
              ) : (
                <>
                  <p className="nb-wallet-action-note">2 wallet popups: approve, then join.</p>
                  <div className="nb-button-row">
                    <button
                      type="button"
                      className="nb-btn-secondary"
                      onClick={handleApprove}
                      disabled={isBusy || amountWei === 0n || isApproved || !canDeposit}
                      aria-disabled={!canDeposit || isApproved || isBusy}
                      aria-busy={txStep === "approving"}
                    >
                      {txStep === "approving" ? (
                        <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Approving...</span>Approving...</>
                      ) : isApproved ? "Approved" : "Approve"}
                    </button>

                    <button
                      type="button"
                      className="nb-btn-primary"
                      onClick={handleDeposit}
                      disabled={isBusy || !isApproved || !canDeposit || amountWei === 0n}
                      aria-disabled={!canDeposit || !isApproved || isBusy}
                      aria-busy={txStep === "depositing"}
                    >
                      {txStep === "depositing" ? (
                        <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Joining...</span>Joining...</>
                      ) : "Join Pool"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </section>

      {/* ── Stats strip — 3 cards, draw timer dominant ── */}
      <section className="nb-stats-strip" aria-label="Pool stats">
        <div className={`nb-stat-card${drawReady ? " is-ready" : ""}${drawPending ? " is-pending" : ""}`}>
          <p className="nb-stat-label">Draw</p>
          {drawPending ? (
            <><p className="nb-stat-value is-vrf">VRF</p><p className="nb-stat-sub">winner being picked</p></>
          ) : drawWaitingForLiveEntry ? (
            <><p className="nb-stat-value is-wait">Warm-up</p><p className="nb-stat-sub">timer done, waiting for live entry</p></>
          ) : drawReady ? (
            <><p className="nb-stat-value is-gold">Ready</p><p className="nb-stat-sub">draw can run now</p></>
          ) : (
            <>
              <p className="nb-stat-value">{epochsUntilDraw > 0 ? epochsToTime(epochsUntilDraw) : "—"}</p>
              <p className="nb-stat-sub">epoch {nextDrawEpoch > 0 ? nextDrawEpoch : "—"}</p>
            </>
          )}
        </div>

        <div className="nb-stat-card">
          <p className="nb-stat-label">Entries</p>
          <p className="nb-stat-value">{participantCount}<span className="nb-stat-value-max"> / {maxParticipants}</span></p>
          <div className="nb-stat-prog-track">
            <div className="nb-stat-prog-fill" style={{ width: `${maxParticipants > 0 ? Math.round((participantCount / maxParticipants) * 100) : 0}%` }} />
          </div>
          <p className="nb-stat-sub">
            {liveEntriesKnown ? `${liveEntries} live · ${openSpots} open` : `${openSpots} open`}
          </p>
        </div>

        <div className="nb-stat-card">
          <p className="nb-stat-label">Your Odds</p>
          {isConnected && !isWrongNetwork && isParticipant && entryIsLive ? (
            <><p className="nb-stat-value is-live">{userOddsPercent.toFixed(2)}<span className="nb-stat-value-max">%</span></p><p className="nb-stat-sub"><span className="nb-live-dot" /> live</p></>
          ) : (
            <><p className="nb-stat-value">—</p><p className="nb-stat-sub">{!isConnected ? "connect" : isWrongNetwork ? "switch network" : isParticipant ? "warming up" : "join to see"}</p></>
          )}
        </div>
      </section>

      {/* Flash banners */}
      {hasWinnings && (
        <div className="nb-flash winner">
          <span className="nb-flash-text">Prize ready — {formatNara(winningsNara)} NARA + {formatEth(winningsEth)} ETH</span>
        </div>
      )}
      {!hasWinnings && drawReady && !drawPending && (
        <div className="nb-flash draw-ready">
          <span className="nb-flash-text">Timer finished · live entry exists · draw can run now</span>
        </div>
      )}
      {!hasWinnings && drawWaitingForLiveEntry && !drawPending && (
        <div className="nb-flash neutral">
          <span className="nb-flash-text">Timer done but no live entry yet. Wait for warm-up to finish.</span>
        </div>
      )}
      {isWrongNetwork && (
        <div className="nb-flash error">
          <span className="nb-flash-text">Switch to {NARA_CHAIN_NAME} to join, claim, or withdraw.</span>
        </div>
      )}
      {flash && (
        <div className={`nb-flash ${flash.tone}`} role="alert" aria-live="polite">
          <span className="nb-flash-text">
            {flash.text}
            {flash.txHash && (
              <a href={txUrl(flash.txHash)} target="_blank" rel="noopener noreferrer" className="nb-flash-link"> View tx</a>
            )}
          </span>
          <button type="button" className="nb-flash-close" onClick={() => setFlash(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* ── Action zone: how it works + your entry ── */}
      <div className="nb-action-zone">

        {/* How it works — 4 clean tiles */}
        <div className="nb-panel">
          <h2 className="nb-panel-header">How It Works</h2>
          <div className="nb-how-strip">
            <div className="nb-how-item">
              <span className="nb-how-num">1</span>
              <p className="nb-how-title">Lock NARA</p>
              <p className="nb-how-copy">{poolConfig ? `${formatNara(minDepositAmount)}–${formatNara(maxDepositAmount)} NARA. Principal stays yours.` : "Loading..."}</p>
            </div>
            <div className="nb-how-item">
              <span className="nb-how-num">2</span>
              <p className="nb-how-title">Warm-up</p>
              <p className="nb-how-copy">Entry goes live after a short delay. Then it counts in every draw.</p>
            </div>
            <div className="nb-how-item">
              <span className="nb-how-num">3</span>
              <p className="nb-how-title">Draw fires</p>
              <p className="nb-how-copy">Timer hits, yield moves to jackpot, Chainlink VRF picks one winner.</p>
            </div>
            <div className="nb-how-item">
              <span className="nb-how-num">4</span>
              <p className="nb-how-title">Withdraw</p>
              <p className="nb-how-copy">After {poolConfig ? epochsToTime(Number(lockDurationEpochs)) : "the lock period"}, withdraw your net locked NARA.</p>
            </div>
          </div>
        </div>

        {/* Your entry — right panel */}
        <div className="nb-entry-panel">
          <h2 className="nb-panel-header">Your Entry</h2>

          {!isConnected ? (
            <div className="nb-wallet-help">
              <p className="nb-wallet-help-title">Connect to see your entry</p>
              <p className="nb-wallet-help-text">Same wallet you joined with.</p>
              <WalletActionButton connectLabel="Connect Wallet" />
            </div>
          ) : isWrongNetwork ? (
            <div className="nb-wallet-help">
              <p className="nb-wallet-help-title">Switch to {NARA_CHAIN_NAME}</p>
              <p className="nb-wallet-help-text">Reconnect on Base to see your entry.</p>
              <WalletActionButton />
            </div>
          ) : (
            <>
              {hasWinnings && (
                <div className="nb-winner-callout">
                  <p className="nb-winner-callout-title">Prize Ready</p>
                  <p className="nb-winner-callout-amounts">
                    {formatNara(winningsNara)} NARA + {formatEth(winningsEth)} ETH
                  </p>
                  <button
                    type="button"
                    className="nb-btn-gold"
                    onClick={handleClaimWinnings}
                    disabled={isBusy}
                    aria-busy={txStep === "claiming"}
                  >
                    {txStep === "claiming" ? (
                      <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Claiming...</span>Claiming...</>
                    ) : "Claim Prize"}
                  </button>
                </div>
              )}

              {isParticipant ? (
                <>
                  {drawWaitingForLiveEntry && !entryIsLive && (
                    <div className="nb-soft-note">Timer finished but your entry is still warming up.</div>
                  )}
                  <div className="nb-entry-topline">
                    <span className={"nb-badge " + (entryIsLive ? "in-draw" : "warming")}>
                      {entryIsLive ? "Live" : "Warming Up"}
                    </span>
                    <p className="nb-entry-caption">
                      {entryIsLive ? "Active in the next draw." : `Live in ${epochsToTime(entryStartsInEpochs)}.`}
                    </p>
                  </div>

                  <div className="nb-status-grid">
                    <div className="nb-status-card">
                      <span className="nb-status-label">Odds</span>
                      <strong className="nb-status-value">{entryIsLive ? userOddsPercent.toFixed(2) + "%" : "—"}</strong>
                    </div>
                    <div className="nb-status-card">
                      <span className="nb-status-label">Net locked</span>
                      <strong className="nb-status-value">{participantNetAmount > 0n ? formatNara(participantNetAmount) + " N" : "..."}</strong>
                    </div>
                    <div className="nb-status-card">
                      <span className="nb-status-label">Unlock</span>
                      <strong className="nb-status-value">{withdrawActionReady ? "Now" : epochsToDate(currentEpoch, unlocksInEpochs)}</strong>
                    </div>
                    <div className="nb-status-card">
                      <span className="nb-status-label">Time left</span>
                      <strong className="nb-status-value">{withdrawActionReady ? "Ready" : epochsToTime(unlocksInEpochs)}</strong>
                    </div>
                  </div>

                  <div>
                    <p className="nb-prog-label">Withdrawal progress</p>
                    <div
                      className="nb-prog-track"
                      role="progressbar"
                      aria-valuenow={lockProgressPct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="Lock duration progress"
                    >
                      <div className="nb-prog-fill" style={{ width: lockProgressPct + "%" }} />
                    </div>
                    <p className="nb-prog-hint">
                      {withdrawActionReady ? "Unlocked — ready to withdraw." : `Unlocks ${epochsToDate(currentEpoch, unlocksInEpochs)}.`}
                    </p>
                  </div>

                  {(withdrawActionReady && engineSyncRequired) && (
                    <div className="nb-soft-note">Engine {backlog}e behind — V2 syncs inside withdraw tx.</div>
                  )}
                  {hasUnlockEthShortfall && (
                    <p className="nb-input-error">Need {formatEth(unlockFeeWei)} ETH for unlock fee + gas.</p>
                  )}

                  <button
                    type="button"
                    className="nb-btn-secondary"
                    style={{ marginTop: "14px" }}
                    onClick={handleWithdraw}
                    disabled={isBusy || !withdrawActionReady || hasUnlockEthShortfall}
                    aria-disabled={!withdrawActionReady || isBusy || hasUnlockEthShortfall}
                    aria-busy={txStep === "withdrawing"}
                  >
                    {txStep === "withdrawing" ? (
                      <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Withdrawing...</span>Withdrawing...</>
                    ) : withdrawActionReady ? "Withdraw NARA" : `Epoch ${unlockEpoch}`}
                  </button>
                </>
              ) : (
                <div className="nb-empty-entry">
                  <span className="nb-badge not-in-draw">No Entry</span>
                  <p className="nb-empty-entry-title">Nothing here yet</p>
                  <p className="nb-empty-entry-text">Join above. Your odds and unlock time appear after warm-up.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Draw section ── */}
      <div className="nb-draw-section">
        <h2 className="nb-panel-header">Prize Draw</h2>
        <div className="nb-draw-inner">
          <div>
            {drawWaitingForLiveEntry ? (
              <><p className="nb-countdown">Warm-up</p><p className="nb-countdown-label">timer done · waiting for live entry</p></>
            ) : drawReady ? (
              <><p className="nb-countdown">Ready</p><p className="nb-countdown-label">epoch {nextDrawEpoch} · draw can run now</p></>
            ) : (
              <><p className="nb-countdown">{epochsUntilDraw > 0 ? epochsToTime(epochsUntilDraw) : "—"}</p><p className="nb-countdown-label">until draw · epoch {nextDrawEpoch > 0 ? nextDrawEpoch : "—"}</p></>
            )}
          </div>

          <div className="nb-draw-actions">
            {!isConnected || isWrongNetwork ? (
              <div className="nb-draw-wallet-note">
                <WalletActionButton className="nb-btn-secondary" connectLabel={!isConnected ? "Connect Wallet" : `Switch to ${NARA_CHAIN_NAME}`} />
              </div>
            ) : drawWaitingForLiveEntry && !drawPending ? (
              <button type="button" className="nb-btn-gold" disabled aria-disabled="true">Waiting for live entry</button>
            ) : drawReady && !drawPending ? (
              <button
                type="button"
                className="nb-btn-gold"
                onClick={handleDrawWinner}
                disabled={isBusy}
                aria-busy={txStep === "drawing"}
              >
                {txStep === "drawing" ? (
                  <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Running draw...</span>Running...</>
                ) : "Run Draw"}
              </button>
            ) : null}
          </div>
        </div>

        <h3 className="nb-panel-header" style={{ marginBottom: "12px" }}>Recent Winners</h3>
        {drawHistory.length === 0 ? (
          <div className="nb-placeholder">No draws yet. First winner shows here.</div>
        ) : (
          <div className="nb-table-wrap">
            <table className="nb-table" aria-label="Draw history">
              <thead>
                <tr><th>Winner</th><th>NARA</th><th>ETH</th><th>Tx</th></tr>
              </thead>
              <tbody>
                {drawHistory.map((rec, i) => (
                  <tr key={i}>
                    <td>
                      {shortAddress(rec.winner)}
                      <button type="button" className="nb-copy-btn" onClick={() => handleCopy(rec.winner)} aria-label={copiedAddr === rec.winner ? "Copied!" : "Copy address"}>
                        {copiedAddr === rec.winner ? "✓" : "⧉"}
                      </button>
                    </td>
                    <td>{formatNara(rec.potNara)}</td>
                    <td>{formatEth(rec.potEth)}</td>
                    <td>
                      {rec.txHash ? (
                        <a href={`https://basescan.org/tx/${rec.txHash}`} target="_blank" rel="noopener noreferrer" className="nb-view-link">View →</a>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Trust bar */}
      <div className="nb-trust-bar">
        <a href={`https://basescan.org/address/${NARA_LOTTO_POOL_ADDRESS}`} target="_blank" rel="noopener noreferrer" className="nb-trust-pill">Prize Pool Contract</a>
        <a href={`https://basescan.org/address/${NARA_TOKEN_ADDRESS}`} target="_blank" rel="noopener noreferrer" className="nb-trust-pill">NARA Token</a>
        <span className="nb-trust-pill">Chainlink VRF</span>
        <span className="nb-trust-pill">Net Principal Protected</span>
        <a href="https://github.com/NARAProtocol/lotto_nara" target="_blank" rel="noopener noreferrer" className="nb-trust-pill">Source Code</a>
      </div>

    </div>
    </main>
    </>
  );
}
