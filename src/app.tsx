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
import { formatEther, parseEther, type Hash, type Log } from "viem";

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
  const [drawHistory, setDrawHistory] = useState<DrawRecord[]>([]);
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
    const normalized = depositAmount.trim().replace(",", ".");
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
  const liveEpoch = Number((currentEpochRead.data ?? 0n) as bigint);
  const settledEpoch = Number(epochStateData?.[0] ?? epochStateData?.epoch ?? 0n);
  const currentEpoch = liveEpoch > 0 ? liveEpoch : settledEpoch;
  const backlog = Math.max(0, currentEpoch - settledEpoch);
  const engineSyncRequired = backlog > 0;

  const potNara = (potNaraRead.data ?? 0n) as bigint;
  const potEth = (potEthRead.data ?? 0n) as bigint;
  const prizePoolIsEmpty = potNara === 0n && potEth === 0n;
  const participantCount = Number((participantCountRead.data ?? 0n) as bigint);
  const lastDrawEpoch = Number((lastDrawEpochRead.data ?? 0n) as bigint);
  const pendingDrawRequestId = (pendingDrawRequestIdRead.data ?? 0n) as bigint;
  const maxParticipants = poolConfig ? Number(poolConfig.maxParticipants ?? 100n) : 100;
  const drawFrequencyEpochs = poolConfig ? Number(poolConfig.drawFrequencyEpochs ?? 0n) : 0;
  const minDepositAmount = poolConfig ? (poolConfig.minDepositAmount as bigint) : 0n;
  const maxDepositAmount = poolConfig ? (poolConfig.maxDepositAmount as bigint) : 0n;
  const minDrawPotNara = poolConfig ? (poolConfig.minDrawPotNara as bigint) : 0n;
  const minDrawPotEth = poolConfig ? (poolConfig.minDrawPotEth as bigint) : 0n;
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

  const winningsNara = (winningsNaraRead.data ?? 0n) as bigint;
  const winningsEth = (winningsEthRead.data ?? 0n) as bigint;
  const hasWinnings = winningsNara > 0n || winningsEth > 0n;

  const userOddsPercent = entryIsLive && liveEntriesKnown && liveLottoWeight > 0n && userWeight > 0n
    ? Number((userWeight * 10000n) / liveLottoWeight) / 100
    : entryIsLive && liveEntriesKnown && liveEntries === 1
      ? 100
      : 0;

  const allowance = (tokenAllowanceRead.data ?? 0n) as bigint;
  const naraBalance = (tokenBalanceRead.data ?? 0n) as bigint;
  const nativeBalance = nativeBalanceRead.data?.value ?? 0n;
  const lockFeeWei = (lockFeeWeiRead.data ?? 0n) as bigint;
  const unlockFeeWei = (unlockFeeWeiRead.data ?? 0n) as bigint;
  const lockFeeBps = (lockFeeBpsRead.data ?? 0n) as bigint;
  const claimFeeBps = (claimFeeBpsRead.data ?? 0n) as bigint;
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

  const previewWeight = (previewWeightRead.data ?? 0n) as bigint;
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

  const fetchDrawHistory = useCallback(async () => {
    if (!publicClient) return;
    try {
      const currentBlock = await publicClient.getBlockNumber();
      const fromBlock = currentBlock > 1900n ? currentBlock - 1900n : 0n;
      const logs = await publicClient.getLogs({
        address: NARA_LOTTO_POOL_ADDRESS,
        event: {
          name: "WinnerDrawn",
          type: "event",
          inputs: [
            { name: "winner", type: "address", indexed: true },
            { name: "potNara", type: "uint256", indexed: false },
            { name: "potEth", type: "uint256", indexed: false },
            { name: "protocolCutEth", type: "uint256", indexed: false },
          ],
        },
        fromBlock,
        toBlock: currentBlock,
      });
      const records: DrawRecord[] = logs
        .slice(-10)
        .reverse()
        .map((log: Log) => {
          const args = (log as any).args ?? {};
          return {
            winner: args.winner ?? "0x",
            potNara: BigInt(args.potNara ?? 0n),
            potEth: BigInt(args.potEth ?? 0n),
            txHash: log.transactionHash ?? "",
            blockNumber: log.blockNumber ?? 0n,
          };
        });
      setDrawHistory(records);
    } catch {
      // silently fail - no history to show
    }
  }, [publicClient]);

  useEffect(() => {
    void fetchDrawHistory();
  }, [fetchDrawHistory]);

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
        const addressResults = await publicClient.multicall({
          allowFailure: true,
          contracts: Array.from({ length: participantCount }, (_, index) => ({
            address: NARA_LOTTO_POOL_ADDRESS as `0x${string}`,
            abi: lottoPoolAbi,
            functionName: "participantAddresses",
            args: [BigInt(index)] as const,
          })),
        }) as Array<{ status: string; result?: unknown }>;

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

        const participantResults = await publicClient.multicall({
          allowFailure: true,
          contracts: participantAddresses.map((participantAddress) => ({
            address: NARA_LOTTO_POOL_ADDRESS as `0x${string}`,
            abi: lottoPoolAbi,
            functionName: "userToParticipant",
            args: [participantAddress] as const,
          })),
        }) as Array<{ status: string; result?: unknown }>;

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

  // Render

  return (
    <>
    <a href="#main-content" className="nb-skip-link">Skip to main content</a>
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

      {/* Jackpot Hero */}
      <section className={`nb-jackpot-hero${prizePoolIsEmpty ? " nb-jackpot-empty" : ""}`} aria-label="Prize Pool">
        <div className="nb-jackpot-shimmer" aria-hidden="true" />
        <p className="nb-jackpot-label">Live Prize Pool</p>
        {prizePoolIsEmpty && <p className="nb-jackpot-open">Pool open - prize starts at zero</p>}
        <div className="nb-jackpot-amount">
          <span className="nb-jackpot-nara">{formatNara(potNara)}<span className="nb-jackpot-unit"> NARA</span></span>
          <span className="nb-jackpot-divider">+</span>
          <span className="nb-jackpot-eth">{formatEth(potEth)}<span className="nb-jackpot-unit"> ETH</span></span>
        </div>
        <p className="nb-jackpot-sub">
          {prizePoolIsEmpty
            ? "The first locked entries start building the yield prize. Your net locked principal is withdrawable after the lock period."
            : "Lock NARA, keep your net locked principal, and one live entry wins the pooled yield."}
        </p>
        <div className="nb-jackpot-tags">
          <span className="nb-jackpot-tag">live on base</span>
          <span className="nb-jackpot-tag">net principal protected</span>
          <span className="nb-jackpot-tag">{MIN_ACTIVE_PLAYERS} live player needed</span>
          <span className="nb-jackpot-tag">chainlink vrf</span>
        </div>
      </section>

      {/* Context row */}
      <section className="nb-context-row" aria-label="Pool stats">
        <div className={`nb-ctx-card nb-ctx-timer${drawReady ? " nb-ctx-ready" : ""}${drawPending ? " nb-ctx-pending" : ""}${drawWaitingForLiveEntry ? " nb-ctx-warm" : ""}`}>
          <p className="nb-ctx-label">Draw Status</p>
          {drawPending ? (
            <>
              <p className="nb-ctx-value nb-ctx-vrf">VRF</p>
              <p className="nb-ctx-sub">winner being picked now</p>
            </>
          ) : drawWaitingForLiveEntry ? (
            <>
              <p className="nb-ctx-value nb-ctx-wait">Warm-up</p>
              <p className="nb-ctx-sub">timer finished, waiting for a live entry</p>
            </>
          ) : drawReady ? (
            <>
              <p className="nb-ctx-value nb-ctx-rdy">Ready</p>
              <p className="nb-ctx-sub">draw can run now</p>
            </>
          ) : (
            <>
              <p className="nb-ctx-value">{epochsUntilDraw > 0 ? epochsToTime(epochsUntilDraw) : "-"}</p>
              <p className="nb-ctx-sub">until draw / epoch {nextDrawEpoch > 0 ? nextDrawEpoch : "-"}</p>
            </>
          )}
        </div>

        <div className="nb-ctx-card">
          <p className="nb-ctx-label">Entries</p>
          <p className="nb-ctx-value">{participantCount}<span className="nb-ctx-value-max"> / {maxParticipants}</span></p>
          <div className="nb-ctx-prog-track">
            <div className="nb-ctx-prog-fill" style={{ width: `${maxParticipants > 0 ? Math.round((participantCount / maxParticipants) * 100) : 0}%` }} />
          </div>
          <p className="nb-ctx-sub">
            {liveEntriesKnown
              ? `${liveEntries} live now - ${openSpots} spot${openSpots === 1 ? "" : "s"} open`
              : `${openSpots} spot${openSpots === 1 ? "" : "s"} open`}
          </p>
        </div>

        <div className="nb-ctx-card">
          <p className="nb-ctx-label">Your Odds</p>
          {isConnected && !isWrongNetwork && isParticipant && entryIsLive ? (
            <>
              <p className="nb-ctx-value nb-ctx-live">{userOddsPercent.toFixed(2)}<span className="nb-ctx-value-max">%</span></p>
              <p className="nb-ctx-sub"><span className="nb-live-dot" /> live in draw</p>
            </>
          ) : (
            <>
              <p className="nb-ctx-value">-</p>
              <p className="nb-ctx-sub">{!isConnected ? "connect to see" : isWrongNetwork ? `switch to ${NARA_CHAIN_NAME}` : isParticipant ? "warming up" : "join to see"}</p>
            </>
          )}
        </div>
      </section>

      {/* Flash banner */}
      {hasWinnings && (
        <div className="nb-flash winner">
          Good news - you have a prize ready to claim: {formatNara(winningsNara)} NARA + {formatEth(winningsEth)} ETH
        </div>
      )}
      {!hasWinnings && drawWaitingForLiveEntry && !drawPending && (
        <div className="nb-flash neutral">
          The timer is finished, but there is no live entry yet. Wait until warm-up ends before running the draw.
        </div>
      )}
      {!hasWinnings && drawReady && !drawPending && (
        <div className="nb-flash draw-ready">
          The timer is finished. A live entry exists, so the draw can run now.
        </div>
      )}
      {drawPending && (
        <div className="nb-flash neutral">
          A winner is being picked now. Waiting for Chainlink VRF randomness on-chain.
        </div>
      )}
      {isWrongNetwork && (
        <div className="nb-flash error">
          Your wallet is on the wrong network. Switch to {NARA_CHAIN_NAME} before joining, claiming, running the draw, or withdrawing.
        </div>
      )}
      {flash && (
        <div className={`nb-flash ${flash.tone}`} role="alert" aria-live="polite">
          {flash.text}
          {flash.txHash && (
            <a href={txUrl(flash.txHash)} target="_blank" rel="noopener noreferrer" className="nb-flash-link">
              View tx -&gt;
            </a>
          )}
          <button
            type="button"
            onClick={() => setFlash(null)}
            style={{ float: "right", background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: "14px", lineHeight: 1, padding: 0 }}
            aria-label="Dismiss"
          >
            x
          </button>
        </div>
      )}

      {/* Action zone */}
      <div className="nb-action-zone">

        {/* Deposit Panel */}
        <div className="nb-panel nb-panel-start">
          <div className="nb-panel-headline">
            <div>
              <h2 className="nb-panel-header">Join The Prize Pool</h2>
              <p className="nb-panel-intro">
                Choose how much NARA to lock, approve once, then join. The engine takes protocol fees; the net locked principal stays withdrawable after the lock period.
              </p>
            </div>
            <span className="nb-badge not-in-draw">{openSpots} spot{openSpots === 1 ? "" : "s"} open</span>
          </div>

          {poolConfig && (
            <div className="nb-fact-grid">
              <div className="nb-fact-card">
                <span className="nb-fact-label">Min join</span>
                <strong className="nb-fact-value">{formatNara(minDepositAmount)} NARA</strong>
              </div>
              <div className="nb-fact-card">
                <span className="nb-fact-label">Lock time</span>
                <strong className="nb-fact-value">{epochsToTime(Number(lockDurationEpochs))}</strong>
              </div>
              <div className="nb-fact-card">
                <span className="nb-fact-label">Draw needs</span>
                <strong className="nb-fact-value">{minPrizeLabel} jackpot</strong>
              </div>
            </div>
          )}

          {!isConnected ? (
            <WalletSetupCard
              title="Connect to get started"
              body="Use MetaMask or another supported wallet to choose an amount and join."
              connectLabel="Connect Wallet"
            />
          ) : isWrongNetwork ? (
            <WalletSetupCard
              title={"Switch to " + NARA_CHAIN_NAME}
              body={"Approvals and joins only work on " + NARA_CHAIN_NAME + "."}
            />
          ) : isParticipant ? (
            <div className="nb-inner-card">
              <span className="nb-badge warming">Already Joined</span>
              <p className="nb-info-text" style={{ margin: "10px 0 0" }}>
                Your entry is already in the pool. The card on the right shows when it goes live and when you can withdraw.
              </p>
            </div>
          ) : (
            <>
              {txStep === "approving" && (
                <div className="nb-step-indicator">
                  <span className="nb-step-dot" />
                  Step 1 of 2: Approve NARA
                </div>
              )}
              {txStep === "depositing" && (
                <div className="nb-step-indicator">
                  <span className="nb-step-dot" />
                  Step 2 of 2: Join the Pool
                </div>
              )}

              <div className="nb-input-wrap">
                <label htmlFor="deposit-amount" className="nb-input-label">
                  Choose amount (NARA)
                </label>
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
                {minDepositAmount > 0n && (
                  <p className="nb-input-helper">
                    Join range: {formatNara(minDepositAmount)} to {formatNara(maxDepositAmount)} NARA.
                  </p>
                )}
                <p className="nb-input-helper">If you are unsure, starting with the minimum is fine.</p>
                {amountError && <p className="nb-input-error">{amountError}</p>}
              </div>

              {amountWei > 0n && (
                <div className="nb-preview-card">
                  <p className="nb-panel-header">Quick Check</p>
                  <div className="nb-data-row" style={{ borderTop: "none", paddingTop: 0 }}>
                    <span className="nb-data-label">Estimated odds</span>
                    <span className="nb-data-value">{previewWeight > 0n ? previewOdds.toFixed(2) + "%" : "Loading..."}</span>
                  </div>
                  <div className="nb-data-row">
                    <span className="nb-data-label">NARA lock fee</span>
                    <span className="nb-data-value">{formatNara(lockFeeNara)} NARA ({formatBps(lockFeeBps)})</span>
                  </div>
                  <div className="nb-data-row">
                    <span className="nb-data-label">Net principal locked</span>
                    <span className="nb-data-value">{formatNara(netLockAmount)} NARA</span>
                  </div>
                  <div className="nb-data-row">
                    <span className="nb-data-label">Join ETH fee</span>
                    <span className="nb-data-value">{formatEth(lockFeeWei)} ETH + gas</span>
                  </div>
                  <div className="nb-data-row">
                    <span className="nb-data-label">Withdraw ETH fee later</span>
                    <span className="nb-data-value">{formatEth(unlockFeeWei)} ETH + gas</span>
                  </div>
                  <div className='nb-data-row'>
                    <span className='nb-data-label'>ETH yield fee</span>
                    <span className='nb-data-value'>
                      {claimFeeLabel === 'loading' ? 'Loading...' : `${claimFeeLabel} before ETH reaches the prize pool`}
                    </span>
                  </div>
                  <div className="nb-data-row">
                    <span className="nb-data-label">Approval recipient</span>
                    <span className="nb-data-value">
                      <a href={`https://basescan.org/address/${NARA_LOTTO_POOL_ADDRESS}`} target="_blank" rel="noopener noreferrer" className="nb-view-link">
                        {shortAddress(NARA_LOTTO_POOL_ADDRESS)}
                      </a>
                    </span>
                  </div>
                  <div className="nb-data-row">
                    <span className="nb-data-label">Starts counting</span>
                    <span className="nb-data-value">After warm-up</span>
                  </div>
                  <div className="nb-data-row">
                    <span className="nb-data-label">Can withdraw from</span>
                    <span className="nb-data-value">{epochsToDate(currentEpoch, Number(lockDurationEpochs))}</span>
                  </div>
                </div>
              )}

              {engineSyncRequired && (
                <div className="nb-soft-note">
                  The pool timer is {backlog} epoch{backlog === 1 ? "" : "s"} behind live time. V2 catches up inside Join, Withdraw, and Draw so there is no separate sync step.
                </div>
              )}

              <p className="nb-wallet-action-note">
                You will see 2 wallet popups: approve, then join. The join transaction syncs the engine automatically if needed.
              </p>

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
                    <>
                      <span className="nb-spinner" aria-hidden="true" />
                      <span className="nb-sr-only">Approving...</span>
                      Approving...
                    </>
                  ) : isApproved ? "Approved" : amountWei > 0n ? `Approve ${formatNara(amountWei)} NARA` : "Approve NARA"}
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
                    <>
                      <span className="nb-spinner" aria-hidden="true" />
                      <span className="nb-sr-only">Joining...</span>
                      Joining...
                    </>
                  ) : "Join Pool"}
                </button>
              </div>
            </>
          )}

          <details className="nb-rule-disclosure">
            <summary className="nb-rule-summary">How it works</summary>
            <div className="nb-rule-grid">
              <div className="nb-rule-item">
                <span className="nb-rule-num">1</span>
                <div>
                  <p className="nb-rule-title">Choose an amount</p>
                  <p className="nb-rule-copy">{poolConfig ? "Join with " + formatNara(minDepositAmount) + " to " + formatNara(maxDepositAmount) + " NARA. Starting small is okay." : "Join amount is loading..."}</p>
                </div>
              </div>
              <div className="nb-rule-item">
                <span className="nb-rule-num">2</span>
                <div>
                  <p className="nb-rule-title">Warm-up first</p>
                  <p className="nb-rule-copy">Your entry does not count instantly. It goes live after a short warm-up.</p>
                </div>
              </div>
              <div className="nb-rule-item">
                <span className="nb-rule-num">3</span>
                <div>
                  <p className="nb-rule-title">Draw runs on the timer</p>
                  <p className="nb-rule-copy">When the timer is ready and at least one entry is live, anyone can run the draw. V2 moves yield into the jackpot first and skips VRF if the jackpot is still too small.</p>
                </div>
              </div>
              <div className="nb-rule-item">
                <span className="nb-rule-num">4</span>
                <div>
                  <p className="nb-rule-title">Withdraw later</p>
                  <p className="nb-rule-copy">Your net principal stays locked for {epochsToTime(Number(lockDurationEpochs))}, then Withdraw syncs, moves your yield into the jackpot, and returns your NARA.</p>
                </div>
              </div>
            </div>
          </details>
        </div>
        {/* My Position */}
        <div className="nb-panel nb-panel-entry">
          <h2 className="nb-panel-header">Your Entry</h2>

          {!isConnected ? (
            <WalletSetupCard
              title="Connect to see your entry"
              body="Use the same wallet you joined with to see your status, odds, and unlock time."
              connectLabel="Connect Wallet"
            />
          ) : isWrongNetwork ? (
            <WalletSetupCard
              title={"Switch to " + NARA_CHAIN_NAME}
              body={"Reconnect on " + NARA_CHAIN_NAME + " to see your entry and withdrawal time."}
            />
          ) : (
            <>
              {hasWinnings && (
                <div className="nb-winner-callout">
                  <p className="nb-winner-callout-title">Prize Ready To Claim</p>
                  <p className="nb-winner-callout-amounts">
                    {formatNara(winningsNara)} NARA + {formatEth(winningsEth)} ETH
                  </p>
                  <p className='nb-input-helper'>ETH yield reaches the prize pool after the {claimFeeLabel} engine fee; claiming this prize pays wallet gas only.</p>
                  <button
                    type="button"
                    className="nb-btn-gold"
                    onClick={handleClaimWinnings}
                    disabled={isBusy}
                    aria-busy={txStep === "claiming"}
                  >
                    {txStep === "claiming" ? (
                      <>
                        <span className="nb-spinner" aria-hidden="true" />
                        <span className="nb-sr-only">Claiming...</span>
                        Claiming...
                      </>
                    ) : "Claim Prize"}
                  </button>
                </div>
              )}

              {isParticipant ? (
                <>
                  {drawWaitingForLiveEntry && !entryIsLive && (
                    <div className="nb-soft-note">
                      The timer is already finished, but your entry is still warming up. Wait until it goes live before running the first draw.
                    </div>
                  )}
                  <div className="nb-entry-topline">
                    <span className={"nb-badge " + (entryIsLive ? "in-draw" : "warming")}>
                      {entryIsLive ? "Live In Draw" : "Warming Up"}
                    </span>
                    <p className="nb-entry-caption">
                      {entryIsLive
                        ? "Your entry is active now and counts in the next draw."
                        : "Your entry starts counting in " + epochsToTime(entryStartsInEpochs) + "."}
                    </p>
                  </div>

                  <div className="nb-status-grid">
                    <div className="nb-status-card">
                      <span className="nb-status-label">Your odds</span>
                      <strong className="nb-status-value">{entryIsLive ? userOddsPercent.toFixed(2) + "%" : "After warm-up"}</strong>
                    </div>
                    <div className='nb-status-card'>
                      <span className='nb-status-label'>Net locked</span>
                      <strong className='nb-status-value'>{participantNetAmount > 0n ? formatNara(participantNetAmount) + ' NARA' : 'Loading...'}</strong>
                    </div>
                    <div className="nb-status-card">
                      <span className="nb-status-label">Starts counting</span>
                      <strong className="nb-status-value">{entryIsLive ? "Live now" : epochsToTime(entryStartsInEpochs)}</strong>
                    </div>
                    <div className="nb-status-card">
                      <span className="nb-status-label">Withdraw opens</span>
                      <strong className="nb-status-value">{withdrawActionReady ? "Now" : epochsToDate(currentEpoch, unlocksInEpochs)}</strong>
                    </div>
                    <div className="nb-status-card">
                      <span className="nb-status-label">Time left</span>
                      <strong className="nb-status-value">{withdrawActionReady ? "Ready now" : epochsToTime(unlocksInEpochs)}</strong>
                    </div>
                  </div>

                  <div style={{ margin: "14px 0 4px" }}>
                    <p className="nb-input-label" style={{ marginBottom: "4px" }}>Withdrawal progress</p>
                    <div
                      className="nb-prog-track"
                      role="progressbar"
                      aria-valuenow={lockProgressPct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="Lock duration progress"
                    >
                      <div className="nb-prog-fill" style={{ width: String(lockProgressPct) + "%" }} />
                    </div>
                    <p className="nb-input-hint">{withdrawActionReady ? "Your net principal can be withdrawn now." : "Unlocks on " + epochsToDate(currentEpoch, unlocksInEpochs) + "."}</p>
                  </div>

                  {withdrawActionReady && engineSyncRequired && (
                    <div className="nb-soft-note">
                      The unlock time has passed and the engine is {backlog} epoch{backlog === 1 ? "" : "s"} behind live time. V2 syncs and harvests your clone inside the withdrawal transaction.
                    </div>
                  )}
                  {canWithdraw && (
                    <div className="nb-soft-note">
                      Withdrawal sends the {formatEth(unlockFeeWei)} ETH unlock fee plus gas, moves your clone yield into the jackpot, then returns your net locked NARA.
                    </div>
                  )}
                  {hasUnlockEthShortfall && (
                    <p className="nb-input-error">You need at least {formatEth(unlockFeeWei)} ETH on Base for the unlock fee, plus gas.</p>
                  )}

                  <button
                    type="button"
                    className="nb-btn-secondary"
                    onClick={handleWithdraw}
                    disabled={isBusy || !withdrawActionReady || hasUnlockEthShortfall}
                    title={withdrawActionReady ? "Withdraw net locked principal" : "Unlocks at epoch " + unlockEpoch + " (" + epochsToDate(currentEpoch, Math.max(0, unlockEpoch - currentEpoch)) + ")"}
                    aria-disabled={!withdrawActionReady || isBusy || hasUnlockEthShortfall}
                    aria-busy={txStep === "withdrawing"}
                  >
                    {txStep === "withdrawing" ? (
                      <>
                        <span className="nb-spinner" aria-hidden="true" />
                        <span className="nb-sr-only">Withdrawing...</span>
                        Withdrawing...
                      </>
                    ) : withdrawActionReady
                        ? "Withdraw NARA"
                        : "Available at epoch " + unlockEpoch}
                  </button>
                </>
              ) : (
                <div className="nb-empty-entry">
                  <span className="nb-badge not-in-draw">No Entry Yet</span>
                  <p className="nb-empty-entry-title">Nothing to track yet</p>
                  <p className="nb-empty-entry-text">
                    Join from the left. After the warm-up, your odds and withdrawal time will show here.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Draw Section */}
      <div className="nb-draw-section">
        <h2 className="nb-panel-header">Prize Draw</h2>

        <div className="nb-draw-trigger-row">
          <div>
            {drawPending ? (
              <div className="nb-draw-status-text">
                <span className="nb-spinner" />
                Chainlink VRF is picking the winner...
              </div>
            ) : drawWaitingForLiveEntry ? (
              <div>
                <p className="nb-countdown">Warm-up first</p>
                <p className="nb-countdown-label">timer finished for epoch {nextDrawEpoch}, but there is no live entry yet</p>
              </div>
            ) : drawReady ? (
              <div className="nb-draw-status-text">
                Timer finished for epoch {nextDrawEpoch}. A live entry exists, so the draw can run now.
              </div>
            ) : (
              <div>
                <p className="nb-countdown">{epochsUntilDraw > 0 ? epochsToTime(epochsUntilDraw) : "-"}</p>
                <p className="nb-countdown-label">until the draw can run / epoch {nextDrawEpoch}</p>
              </div>
            )}
          </div>

          <p className="nb-draw-explainer">
            V2 has no separate yield button. Run Draw syncs the engine, moves available clone yield into the jackpot, and only starts Chainlink VRF if the jackpot meets the minimum.
            {engineSyncRequired ? ` The engine is ${backlog} epoch${backlog === 1 ? "" : "s"} behind; the draw transaction catches up automatically within the V2 limit.` : ""}
          </p>

          {!isConnected || isWrongNetwork ? (
            <div className="nb-draw-wallet-note">
              <p className="nb-wallet-help-text">
                {!isConnected
                  ? "Connect a wallet to run the draw."
                  : `Switch to ${NARA_CHAIN_NAME} to run the draw.`}
              </p>
              <WalletActionButton className="nb-btn-secondary" connectLabel="Connect Wallet" />
            </div>
          ) : (
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {drawWaitingForLiveEntry && !drawPending && (
                <button
                  type="button"
                  className="nb-btn-gold"
                  style={{ width: "auto", minWidth: "220px", marginBottom: 0 }}
                  disabled
                  aria-disabled="true"
                  title="Wait until at least one entry is live before running the draw"
                >
                  Waiting For Live Entry
                </button>
              )}
              {drawReady && !drawPending && (
                <button
                  type="button"
                  className="nb-btn-gold"
                  style={{ width: "auto", minWidth: "180px", marginBottom: 0 }}
                  onClick={handleDrawWinner}
                  disabled={isBusy}
                  aria-busy={txStep === "drawing"}
                >
                  {txStep === "drawing" ? (
                    <>
                      <span className="nb-spinner" aria-hidden="true" />
                      <span className="nb-sr-only">Triggering...</span>
                      Triggering...
                    </>
                  ) : "Run Draw"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Draw history */}
        <h2 className="nb-panel-header" style={{ marginBottom: "12px" }}>Recent Winners</h2>
        {drawHistory.length === 0 ? (
          <div className="nb-placeholder" style={{ padding: "24px 20px" }}>
            No completed draws yet. The first winner will appear here.
          </div>
        ) : (
          <div className="nb-table-wrap">
            <table className="nb-table" aria-label="Draw history">
              <thead>
                <tr>
                  <th>Winner</th>
                  <th>NARA Prize</th>
                  <th>ETH Prize</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {drawHistory.map((rec, i) => (
                  <tr key={i}>
                    <td>
                      {shortAddress(rec.winner)}
                      <button
                        type="button"
                        className="nb-copy-btn"
                        onClick={() => handleCopy(rec.winner)}
                        aria-label={copiedAddr === rec.winner ? "Copied!" : "Copy address"}
                      >
                        {copiedAddr === rec.winner ? "Copied" : "Copy"}
                      </button>
                    </td>
                    <td>{formatNara(rec.potNara)} NARA</td>
                    <td>{formatEth(rec.potEth)} ETH</td>
                    <td>
                      {rec.txHash ? (
                        <a
                          href={`https://basescan.org/tx/${rec.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="nb-view-link"
                        >
                          View -&gt;
                        </a>
                      ) : "-"}
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
        <a
          href={`https://basescan.org/address/${NARA_LOTTO_POOL_ADDRESS}`}
          target="_blank"
          rel="noopener noreferrer"
          className="nb-trust-pill"
        >
          Prize Pool Contract
        </a>
        <a
          href={`https://basescan.org/address/${NARA_TOKEN_ADDRESS}`}
          target="_blank"
          rel="noopener noreferrer"
          className="nb-trust-pill"
        >
          NARA Token
        </a>
        <span className="nb-trust-pill">Chainlink VRF</span>
        <span className="nb-trust-pill">Net Principal Protected</span>
        <a
          href="https://github.com/NARAProtocol/lotto_nara"
          target="_blank"
          rel="noopener noreferrer"
          className="nb-trust-pill"
        >
          Source Code
        </a>
      </div>

    </div>
    </main>
    </>
  );
}
