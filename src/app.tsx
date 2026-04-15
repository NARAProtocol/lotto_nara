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
import { formatEther, parseAbiItem, parseEther, type Hash } from "viem";

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

type SponsorWalletPosition = {
  sponsorId: bigint;
  cloneAddress: `0x${string}`;
  unlockEpoch: number;
  durationEpochs: number;
  principalAmount: bigint;
  isActive: boolean;
};

const MIN_ACTIVE_PLAYERS = 1;
const SEASON_DRAWS = 4;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const LOTTO_DEPLOYMENT_BLOCK = 44446496n;
const WINNER_LOG_BLOCK_RANGE = 10000n;
const WINNER_DRAWN_EVENT = parseAbiItem("event WinnerDrawn(address indexed winner, uint256 potNara, uint256 potEth, uint256 protocolCutEth)");
const DRAW_SKIPPED_PRIZE_TOPIC = "0xe6dcf7e022617b5021f6fccd776b41ef2507d9d79f822160f704c9f7b84dac75";
const SPONSOR_MIN_DEPOSIT = 1000n * 10n ** 18n;
const SPONSOR_MAX_DEPOSIT = 10000n * 10n ** 18n;
const DEFAULT_SPONSOR_DURATION_EPOCHS = 8640;
const SPONSOR_DURATION_PRESETS = [1344, 2880, 8640];
const SPONSOR_AMOUNT_PRESETS = [SPONSOR_MIN_DEPOSIT, 2500n * 10n ** 18n, 5000n * 10n ** 18n, SPONSOR_MAX_DEPOSIT];

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

function seasonLabelFromIndex(index: number): string {
  return `Season ${index}`;
}

function seasonIndexForHistoryRecord(descIndex: number, totalDraws: number): number {
  if (totalDraws <= 0) return 1;
  return Math.floor((totalDraws - 1 - descIndex) / SEASON_DRAWS) + 1;
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
  if (/invalidsponsoramount/.test(raw)) {
    return "Sponsor lock must stay between 1,000 and 10,000 NARA.";
  }
  if (/invalidsponsorduration/.test(raw)) {
    return "Sponsor duration is outside the engine's allowed range.";
  }
  if (/alreadyparticipating/.test(raw)) {
    return "This wallet already has an active entry. Withdraw it before joining again.";
  }
  if (/maxparticipantsreached/.test(raw)) {
    return "The pool is full right now. Wait for a spot to open.";
  }
  if (/maxsponsorsreached/.test(raw)) {
    return "The sponsor lane is full right now.";
  }
  if (/drawnotready/.test(raw)) {
    return "The draw is not ready yet. The cooldown or the current player/prize conditions are still short.";
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

  const [entryMode, setEntryMode] = useState<"player" | "sponsor">("player");
  const [depositAmount, setDepositAmount] = useState("");
  const [sponsorAmount, setSponsorAmount] = useState("");
  const [sponsorDurationEpochs, setSponsorDurationEpochs] = useState<number>(8640);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [txStep, setTxStep] = useState<"idle" | "approving" | "depositing" | "sponsoring" | "withdrawing" | "withdrawingSponsor" | "drawing" | "claiming" | "harvesting" | "syncing">("idle");
  const [txPhase, setTxPhase] = useState<"wallet" | "chain" | null>(null);
  const [drawHistory, setDrawHistory] = useState<DrawRecord[]>([]);
  const [drawHistoryScannedToBlock, setDrawHistoryScannedToBlock] = useState<bigint | null>(null);
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);
  const [sponsorFeatureSupported, setSponsorFeatureSupported] = useState<boolean | null>(null);
  const [poolLockedTotals, setPoolLockedTotals] = useState<{ participantLocked: bigint; sponsorLocked: bigint; totalLocked: bigint } | null>(null);
  const [poolSponsorCount, setPoolSponsorCount] = useState<number>(0);
  const [walletSponsorPositions, setWalletSponsorPositions] = useState<SponsorWalletPosition[]>([]);
  const [lottoReloadKey, setLottoReloadKey] = useState(0);
  const [potPreview, setPotPreview] = useState<{
    livePotNara: bigint;
    livePotEth: bigint;
    frozenPotNara: bigint;
    frozenPotEth: bigint;
    unharvestedPotNara: bigint;
    unharvestedPotEth: bigint;
    headlinePotNara: bigint;
    headlinePotEth: bigint;
    harvestableClones: bigint;
  } | null>(null);
  const [previewSupported, setPreviewSupported] = useState<boolean | null>(null);

  const isWrongNetwork = Boolean(isConnected && chainId != null && chainId !== NARA_CHAIN_ID);
  const viewerAddress = (address ?? ZERO_ADDRESS) as `0x${string}`;

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

  const poolStateRead = useReadContract({
    address: NARA_LOTTO_POOL_ADDRESS,
    abi: lottoPoolAbi,
    functionName: "getPoolState",
    args: [viewerAddress],
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

  const engineConfigRead = useReadContract({
    address: NARA_ENGINE_ADDRESS,
    abi: engineAbi,
    functionName: "config",
  });

  // Preview weight when amount is entered
  const poolConfig = poolConfigRead.data as any;
  const engineConfig = engineConfigRead.data as any;
  const lockDurationEpochs = poolConfig ? BigInt(poolConfig.lockDurationEpochs ?? 0n) : 0n;
  const maxLockEpochs = Number(BigInt(engineConfig?.maxLockEpochs ?? engineConfig?.[17] ?? 0n));

  const parsedDepositAmount = (() => {
    const raw = depositAmount.trim().replace(/,(\d{3})/g, "$1");
    const normalized = raw.replace(",", ".");
    if (!normalized) return { amountWei: 0n, invalid: false };
    try { return { amountWei: parseEther(normalized), invalid: false }; } catch { return { amountWei: 0n, invalid: true }; }
  })();

  const parsedSponsorAmount = (() => {
    const raw = sponsorAmount.trim().replace(/,(\d{3})/g, "$1");
    const normalized = raw.replace(",", ".");
    if (!normalized) return { amountWei: 0n, invalid: false };
    try { return { amountWei: parseEther(normalized), invalid: false }; } catch { return { amountWei: 0n, invalid: true }; }
  })();

  const amountWei = parsedDepositAmount.amountWei;
  const amountInputInvalid = parsedDepositAmount.invalid;
  const sponsorAmountWei = parsedSponsorAmount.amountWei;
  const sponsorInputInvalid = parsedSponsorAmount.invalid;

  const previewWeightRead = useReadContract({
    address: NARA_ENGINE_ADDRESS,
    abi: engineAbi,
    functionName: "previewWeight",
    args: amountWei > 0n && lockDurationEpochs > 0n ? [amountWei, lockDurationEpochs] : undefined,
    query: { enabled: amountWei > 0n && lockDurationEpochs > 0n },
  });

  // Derived values

  const poolState = poolStateRead.data as any;
  const epochStateData = epochStateRead.data as any;
  const liveEpoch = Number(BigInt(poolState?.liveEpoch ?? currentEpochRead.data ?? 0));
  const settledEpoch = Number(BigInt(poolState?.settledEpoch ?? epochStateData?.[0] ?? epochStateData?.epoch ?? 0n));
  const currentEpoch = liveEpoch > 0 ? liveEpoch : settledEpoch;
  const backlog = Number(BigInt(poolState?.engineBacklog ?? (currentEpoch > settledEpoch ? currentEpoch - settledEpoch : 0)));
  const engineSyncRequired = backlog > 0;
  const maxSyncSteps = poolConfig ? Number(BigInt(poolConfig.maxSyncSteps ?? 0)) : 0;
  const hardSyncRequired = maxSyncSteps > 0 && backlog > maxSyncSteps;

  const potNara = BigInt((potNaraRead.data as any) ?? poolState?.potNara ?? 0);
  const potEth = BigInt((potEthRead.data as any) ?? poolState?.potEth ?? 0);
  const displayedPotNara = potPreview?.headlinePotNara ?? potNara;
  const displayedPotEth = potPreview?.headlinePotEth ?? potEth;
  const visiblePotNara = potPreview?.livePotNara ?? potNara;
  const visiblePotEth = potPreview?.livePotEth ?? potEth;
  const frozenPotNara = potPreview?.frozenPotNara ?? 0n;
  const frozenPotEth = potPreview?.frozenPotEth ?? 0n;
  const unharvestedPotNara = potPreview?.unharvestedPotNara ?? 0n;
  const unharvestedPotEth = potPreview?.unharvestedPotEth ?? 0n;
  const harvestableClones = Number(potPreview?.harvestableClones ?? 0n);
  const prizePoolIsEmpty = displayedPotNara === 0n && displayedPotEth === 0n;
  const participantCount = Number(BigInt(poolState?.participantCount ?? participantCountRead.data ?? 0));
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
  const liveEntriesKnown = poolStateRead.data != null;
  const liveEntries = Number(BigInt(poolState?.liveParticipantCount ?? 0n));
  const liveLottoWeight = BigInt(poolState?.liveLottoWeight ?? 0n);

  const isParticipant = Boolean(poolState?.isParticipant ?? pData?.isActive ?? (pData && pData[5] === true));
  const userWeight = isParticipant ? BigInt(poolState?.userWeight ?? pData?.weight ?? pData?.[4] ?? 0n) : 0n;
  const activationEpoch = isParticipant ? Number(pData?.activationEpoch ?? pData?.[2] ?? 0n) : 0;
  const positionData = participantPositionRead.data as any;
  const participantNetAmount = isParticipant ? BigInt(positionData?.amount ?? positionData?.[0] ?? 0n) : 0n;
  const poolUnlockEpoch = isParticipant ? Number(BigInt(poolState?.unlockEpoch ?? 0n)) : 0;
  const positionUnlockEpoch = isParticipant ? Number(positionData?.unlockEpoch ?? positionData?.[4] ?? 0n) : 0;
  const unlockEpoch = isParticipant
    ? (poolUnlockEpoch > 0 ? poolUnlockEpoch : positionUnlockEpoch > 0 ? positionUnlockEpoch : activationEpoch + Number(lockDurationEpochs))
    : 0;
  const entryStartsInEpochs = isParticipant && activationEpoch > settledEpoch ? Math.max(0, activationEpoch - settledEpoch) : 0;
  const entryIsLive = isParticipant && userWeight > 0n;
  const unlocksInEpochs = isParticipant ? Math.max(0, unlockEpoch - settledEpoch) : 0;

  const winningsNara = BigInt(poolState?.userWinningsNara ?? winningsNaraRead.data ?? 0);
  const winningsEth = BigInt(poolState?.userWinningsEth ?? winningsEthRead.data ?? 0);
  const hasWinnings = winningsNara > 0n || winningsEth > 0n;

  const userOddsPercent = entryIsLive
    ? Number(BigInt(poolState?.userOddsBps ?? 0n)) / 100
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
  const sponsorFeeNara = sponsorAmountWei > 0n ? (sponsorAmountWei * lockFeeBps) / 10000n : 0n;
  const netLockAmount = amountWei > lockFeeNara ? amountWei - lockFeeNara : 0n;
  const sponsorNetLockAmount = sponsorAmountWei > sponsorFeeNara ? sponsorAmountWei - sponsorFeeNara : 0n;
  const hasNaraShortfall = amountWei > 0n && naraBalanceKnown && naraBalance < amountWei;
  const hasLockEthShortfall = amountWei > 0n && nativeBalanceKnown && lockFeeWei > 0n && nativeBalance < lockFeeWei;
  const hasSponsorNaraShortfall = sponsorAmountWei > 0n && naraBalanceKnown && naraBalance < sponsorAmountWei;
  const hasSponsorLockEthShortfall = sponsorAmountWei > 0n && nativeBalanceKnown && lockFeeWei > 0n && nativeBalance < lockFeeWei;
  const isApproved = amountWei > 0n && allowance >= amountWei;
  const isSponsorApproved = sponsorAmountWei > 0n && allowance >= sponsorAmountWei;

  const drawPending = Boolean(poolState?.drawPending ?? (pendingDrawRequestId !== 0n));
  const drawCooldownSatisfied = Boolean(poolState?.drawReadyByTime ?? false);
  const drawPrizeReady = Boolean(poolState?.drawReadyByPrize ?? false);
  const drawReady = !drawPending && drawCooldownSatisfied && drawPrizeReady && liveEntriesKnown && liveEntries >= MIN_ACTIVE_PLAYERS && liveLottoWeight > 0n;
  const drawWaitingForLiveEntry = !drawPending && drawCooldownSatisfied && liveEntriesKnown && liveEntries < MIN_ACTIVE_PLAYERS;
  const drawWaitingForPrize = !drawPending && drawCooldownSatisfied && !drawWaitingForLiveEntry && !drawPrizeReady;
  const nextDrawEpoch = Number(BigInt(poolState?.nextDrawEpoch ?? (drawFrequencyEpochs > 0 ? lastDrawEpoch + drawFrequencyEpochs : 0)));
  const epochsUntilDraw = !drawCooldownSatisfied && nextDrawEpoch > 0
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

  const canWithdraw = Boolean(poolState?.canWithdraw ?? (isParticipant && settledEpoch >= unlockEpoch));
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

  const sponsorAmountError = sponsorFeatureSupported === false
    ? "Sponsor lane is not live on this pool address yet."
    : sponsorInputInvalid
      ? "Enter a valid sponsor amount like 1000 or 2500."
      : sponsorAmountWei > 0n
        ? sponsorAmountWei < SPONSOR_MIN_DEPOSIT
          ? `Minimum sponsor lock is ${formatNara(SPONSOR_MIN_DEPOSIT)} NARA.`
          : sponsorAmountWei > SPONSOR_MAX_DEPOSIT
            ? `Maximum sponsor lock is ${formatNara(SPONSOR_MAX_DEPOSIT)} NARA.`
            : hasSponsorNaraShortfall
              ? `Wallet has ${formatNara(naraBalance)} NARA. You need ${formatNara(sponsorAmountWei)} NARA.`
              : hasSponsorLockEthShortfall
                ? `You need at least ${formatEth(lockFeeWei)} ETH on Base for the sponsor lock fee, plus gas.`
                : maxLockEpochs > 0 && sponsorDurationEpochs > maxLockEpochs
                  ? `Maximum sponsor duration is ${epochsToTime(maxLockEpochs)}.`
                  : null
        : null;

  const canSponsor = sponsorFeatureSupported === true
    && !sponsorInputInvalid
    && sponsorAmountWei >= SPONSOR_MIN_DEPOSIT
    && sponsorAmountWei <= SPONSOR_MAX_DEPOSIT
    && sponsorDurationEpochs > 0
    && (maxLockEpochs === 0 || sponsorDurationEpochs <= maxLockEpochs)
    && !hasSponsorNaraShortfall
    && !hasSponsorLockEthShortfall;

  const sponsorDurationOptions = [
    ...SPONSOR_DURATION_PRESETS.filter((value) => maxLockEpochs === 0 || value <= maxLockEpochs),
    ...(maxLockEpochs > 0 && !SPONSOR_DURATION_PRESETS.includes(maxLockEpochs) ? [maxLockEpochs] : []),
  ].filter((value, index, arr) => arr.indexOf(value) === index);

  const visibleSponsorPositions = walletSponsorPositions
    .filter((position) => position.isActive)
    .sort((a, b) => a.unlockEpoch - b.unlockEpoch);
  const readySponsorCount = visibleSponsorPositions.filter((position) => settledEpoch >= position.unlockEpoch).length;
  const sponsorUnlockFeeShortfall = readySponsorCount > 0 && nativeBalanceKnown && unlockFeeWei > 0n && nativeBalance < unlockFeeWei;
  const hasWalletPositions = isParticipant || visibleSponsorPositions.length > 0;

  // Draw history fetch

  const fetchDrawHistory = useCallback(async () => {
    if (!publicClient) {
      setDrawHistory([]);
      setDrawHistoryScannedToBlock(null);
      return;
    }

    try {
      const latestBlock = await publicClient.getBlockNumber();
      const fromBlock = drawHistoryScannedToBlock == null ? LOTTO_DEPLOYMENT_BLOCK : drawHistoryScannedToBlock + 1n;

      if (fromBlock > latestBlock) {
        return;
      }

      const nextRecords: DrawRecord[] = [];
      for (let startBlock = fromBlock; startBlock <= latestBlock; startBlock += WINNER_LOG_BLOCK_RANGE + 1n) {
        const endBlock = startBlock + WINNER_LOG_BLOCK_RANGE > latestBlock ? latestBlock : startBlock + WINNER_LOG_BLOCK_RANGE;
        const logs = await publicClient.getLogs({
          address: NARA_LOTTO_POOL_ADDRESS,
          event: WINNER_DRAWN_EVENT,
          fromBlock: startBlock,
          toBlock: endBlock,
        });

        for (const log of logs) {
          nextRecords.push({
            winner: String(log.args.winner ?? ""),
            potNara: BigInt(log.args.potNara ?? 0n),
            potEth: BigInt(log.args.potEth ?? 0n),
            txHash: log.transactionHash,
            blockNumber: log.blockNumber ?? 0n,
          });
        }
      }

      setDrawHistory((current) => {
        if (nextRecords.length === 0) return current;
        const merged = [...current, ...nextRecords];
        const deduped = new Map<string, DrawRecord>();
        for (const record of merged) {
          deduped.set(`${record.txHash}:${record.winner}:${record.blockNumber.toString()}`, record);
        }
        return [...deduped.values()].sort((a, b) => {
          if (a.blockNumber === b.blockNumber) return a.txHash < b.txHash ? 1 : -1;
          return a.blockNumber > b.blockNumber ? -1 : 1;
        });
      });
      setDrawHistoryScannedToBlock(latestBlock);
    } catch {
      if (drawHistoryScannedToBlock == null) {
        setDrawHistory([]);
      }
    }
  }, [drawHistoryScannedToBlock, publicClient]);

  useEffect(() => {
    void fetchDrawHistory();
  }, [fetchDrawHistory, lottoReloadKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadPotPreview() {
      if (!publicClient) {
        if (!cancelled) {
          setPotPreview(null);
          setPreviewSupported(null);
        }
        return;
      }

      try {
        const preview = await publicClient.readContract({
          address: NARA_LOTTO_POOL_ADDRESS,
          abi: lottoPoolAbi,
          functionName: "previewPotTotals",
        }) as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

        if (!cancelled) {
          setPotPreview({
            livePotNara: preview[0],
            livePotEth: preview[1],
            frozenPotNara: preview[2],
            frozenPotEth: preview[3],
            unharvestedPotNara: preview[4],
            unharvestedPotEth: preview[5],
            headlinePotNara: preview[6],
            headlinePotEth: preview[7],
            harvestableClones: preview[8],
          });
          setPreviewSupported(true);
        }
      } catch {
        if (!cancelled) {
          setPotPreview(null);
          setPreviewSupported(false);
        }
      }
    }

    void loadPotPreview();

    return () => {
      cancelled = true;
    };
  }, [publicClient, participantCount, settledEpoch, pendingDrawRequestIdRead.data, potNaraRead.data, potEthRead.data, lottoReloadKey]);

  useEffect(() => {
    if (maxLockEpochs > 0 && sponsorDurationEpochs > maxLockEpochs) {
      setSponsorDurationEpochs(maxLockEpochs);
    }
  }, [maxLockEpochs, sponsorDurationEpochs]);

  useEffect(() => {
    let cancelled = false;

    async function loadSponsorState() {
      if (!publicClient) {
        if (!cancelled) {
          setSponsorFeatureSupported(null);
          setPoolLockedTotals(null);
          setPoolSponsorCount(0);
          setWalletSponsorPositions([]);
        }
        return;
      }

      try {
        const [totalsResult, sponsorCountResult] = await Promise.all([
          publicClient.readContract({
            address: NARA_LOTTO_POOL_ADDRESS,
            abi: lottoPoolAbi,
            functionName: "totalLockedPrincipal",
          }) as Promise<readonly [bigint, bigint, bigint]>,
          publicClient.readContract({
            address: NARA_LOTTO_POOL_ADDRESS,
            abi: lottoPoolAbi,
            functionName: "sponsorCount",
          }) as Promise<bigint>,
        ]);

        if (cancelled) return;

        setSponsorFeatureSupported(true);
        setPoolLockedTotals({
          participantLocked: totalsResult[0],
          sponsorLocked: totalsResult[1],
          totalLocked: totalsResult[2],
        });

        const totalSponsors = Number(sponsorCountResult);
        setPoolSponsorCount(totalSponsors);

        if (!address || totalSponsors === 0) {
          setWalletSponsorPositions([]);
          return;
        }

        const BATCH_SIZE = 25;
        const idContracts = Array.from({ length: totalSponsors }, (_, index) => ({
          address: NARA_LOTTO_POOL_ADDRESS as `0x${string}`,
          abi: lottoPoolAbi,
          functionName: "sponsorIdAt",
          args: [BigInt(index)] as const,
        }));

        const idResults: Array<{ status: string; result?: unknown }> = [];
        for (let i = 0; i < idContracts.length; i += BATCH_SIZE) {
          const batch = idContracts.slice(i, i + BATCH_SIZE);
          const batchResults = await publicClient.multicall({ allowFailure: true, contracts: batch }) as Array<{ status: string; result?: unknown }>;
          idResults.push(...batchResults);
        }

        const sponsorIds = idResults.flatMap((result) =>
          result.status === "success" && result.result != null ? [BigInt(result.result as bigint)] : [],
        );

        if (sponsorIds.length === 0) {
          setWalletSponsorPositions([]);
          return;
        }

        const sponsorContracts = sponsorIds.map((sponsorId) => ({
          address: NARA_LOTTO_POOL_ADDRESS as `0x${string}`,
          abi: lottoPoolAbi,
          functionName: "sponsorPositions",
          args: [sponsorId] as const,
        }));

        const sponsorResults: Array<{ status: string; result?: unknown }> = [];
        for (let i = 0; i < sponsorContracts.length; i += BATCH_SIZE) {
          const batch = sponsorContracts.slice(i, i + BATCH_SIZE);
          const batchResults = await publicClient.multicall({ allowFailure: true, contracts: batch }) as Array<{ status: string; result?: unknown }>;
          sponsorResults.push(...batchResults);
        }

        const walletAddress = address.toLowerCase();
        const nextPositions: SponsorWalletPosition[] = [];

        sponsorResults.forEach((result, index) => {
          if (result.status !== "success") return;
          const position = result.result as any;
          const owner = String(position?.owner ?? position?.[0] ?? "").toLowerCase();
          const isActive = Boolean(position?.isActive ?? position?.[5] ?? false);
          if (owner !== walletAddress || !isActive) return;
          nextPositions.push({
            sponsorId: sponsorIds[index],
            cloneAddress: (position?.cloneAddress ?? position?.[1]) as `0x${string}`,
            unlockEpoch: Number(position?.unlockEpoch ?? position?.[2] ?? 0n),
            durationEpochs: Number(position?.durationEpochs ?? position?.[3] ?? 0n),
            principalAmount: BigInt(position?.principalAmount ?? position?.[4] ?? 0n),
            isActive,
          });
        });

        if (!cancelled) {
          setWalletSponsorPositions(nextPositions);
        }
      } catch {
        if (!cancelled) {
          setSponsorFeatureSupported(false);
          setPoolLockedTotals(null);
          setPoolSponsorCount(0);
          setWalletSponsorPositions([]);
        }
      }
    }

    void loadSponsorState();

    return () => {
      cancelled = true;
    };
  }, [address, publicClient, settledEpoch, lottoReloadKey]);

  useEffect(() => {
    if (entryMode === "sponsor" && sponsorFeatureSupported === false) {
      setEntryMode("player");
    }
  }, [entryMode, sponsorFeatureSupported]);

  // Invalidate queries helper

  const invalidateLotto = useCallback(() => {
    setLottoReloadKey((value) => value + 1);
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
    setTxPhase("chain");
    setFlash({ tone: "neutral", text: `${label} submitted. Waiting for Base confirmation.`, txHash: hash });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      throw new Error(`${label} reverted on Base.`);
    }
    return receipt;
  }, [publicClient]);

  // Tx handlers

  const handleJoinFlow = async () => {
    if (!ensureTransactionReady("enter the draw") || !depositAmount || lockFeeWeiRead.data == null || amountError || amountWei === 0n || !canDeposit) return;

    const needsApproval = !isApproved;

    try {
      if (needsApproval) {
        setTxStep("approving");
        setTxPhase("wallet");
        setFlash({ tone: "neutral", text: `Step 1 of 2 - Approve ${formatNara(amountWei)} NARA. Confirm in your wallet.` });

        const approvalHash = await writeContractAsync({
          address: NARA_TOKEN_ADDRESS,
          abi: tokenAbi,
          functionName: "approve",
          args: [NARA_LOTTO_POOL_ADDRESS as `0x${string}`, amountWei],
        });

        await waitForConfirmation(approvalHash, "Approval");
        await tokenAllowanceRead.refetch();
      }

      setTxStep("depositing");
      setTxPhase("wallet");
      setFlash({
        tone: "neutral",
        text: needsApproval
          ? `Step 2 of 2 - Join with ${formatNara(amountWei)} NARA. Confirm in your wallet.`
          : `Joining with ${formatNara(amountWei)} NARA. Confirm in your wallet.`,
      });

      const depositHash = await writeContractAsync({
        address: NARA_LOTTO_POOL_ADDRESS,
        abi: lottoPoolAbi,
        functionName: "deposit",
        args: [amountWei],
        value: lockFeeWei,
      });

      await waitForConfirmation(depositHash, "Join pool");
      setFlash({
        tone: "success",
        text: drawCooldownSatisfied
          ? "You joined the prize pool. Cooldown is already clear, but your entry still has to warm up before the draw can run."
          : "You joined the prize pool. Your entry starts counting after a short warm-up.",
        txHash: depositHash,
      });
      setDepositAmount("");
      invalidateLotto();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError(txStep === "approving" ? "Approval" : "Deposit", err) });
    } finally {
      setTxStep("idle");
      setTxPhase(null);
    }
  };

  const handleSponsorFlow = async () => {
    if (!ensureTransactionReady("add sponsor backing") || !sponsorFeatureSupported || !sponsorAmount || lockFeeWeiRead.data == null || sponsorAmountError || sponsorAmountWei === 0n || !canSponsor) return;

    const needsApproval = !isSponsorApproved;

    try {
      if (needsApproval) {
        setTxStep("approving");
        setTxPhase("wallet");
        setFlash({ tone: "neutral", text: `Step 1 of 2 - Approve ${formatNara(sponsorAmountWei)} NARA for the sponsor lock. Confirm in your wallet.` });

        const approvalHash = await writeContractAsync({
          address: NARA_TOKEN_ADDRESS,
          abi: tokenAbi,
          functionName: "approve",
          args: [NARA_LOTTO_POOL_ADDRESS as `0x${string}`, sponsorAmountWei],
        });

        await waitForConfirmation(approvalHash, "Approval");
        await tokenAllowanceRead.refetch();
      }

      setTxStep("sponsoring");
      setTxPhase("wallet");
      setFlash({
        tone: "neutral",
        text: needsApproval
          ? `Step 2 of 2 - Lock ${formatNara(sponsorAmountWei)} NARA behind the jackpot. Confirm in your wallet.`
          : `Locking ${formatNara(sponsorAmountWei)} NARA behind the jackpot. Confirm in your wallet.`,
      });

      const sponsorHash = await writeContractAsync({
        address: NARA_LOTTO_POOL_ADDRESS,
        abi: lottoPoolAbi,
        functionName: "sponsorDeposit",
        args: [sponsorAmountWei, BigInt(sponsorDurationEpochs)],
        value: lockFeeWei,
      });

      await waitForConfirmation(sponsorHash, "Sponsor lock");
      setFlash({
        tone: "success",
        text: `Sponsor lock confirmed. ${formatNara(sponsorNetLockAmount)} NARA is now backing the jackpot until ${epochsToDate(currentEpoch, sponsorDurationEpochs)}.`,
        txHash: sponsorHash,
      });
      setSponsorAmount("");
      invalidateLotto();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError(txStep === "approving" ? "Approval" : "Sponsor lock", err) });
    } finally {
      setTxStep("idle");
      setTxPhase(null);
    }
  };

  const handleWithdrawSponsor = async (sponsorId: bigint) => {
    if (!ensureTransactionReady("withdraw sponsor backing") || unlockFeeWeiRead.data == null) return;
    if (nativeBalanceKnown && unlockFeeWei > 0n && nativeBalance < unlockFeeWei) {
      setFlash({ tone: "error", text: `You need at least ${formatEth(unlockFeeWei)} ETH on Base for the unlock fee, plus gas.` });
      return;
    }

    setTxStep("withdrawingSponsor");
    setTxPhase("wallet");
    setFlash({ tone: "neutral", text: `Withdrawing sponsor lock #${sponsorId.toString()}. Confirm in your wallet.` });

    try {
      const hash = await writeContractAsync({
        address: NARA_LOTTO_POOL_ADDRESS,
        abi: lottoPoolAbi,
        functionName: "withdrawSponsor",
        args: [sponsorId],
        value: unlockFeeWei,
      });
      await waitForConfirmation(hash, "Sponsor withdrawal");
      setFlash({ tone: "success", text: `Sponsor lock #${sponsorId.toString()} withdrawn. Principal was sent back to your wallet.`, txHash: hash });
      invalidateLotto();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Sponsor withdrawal", err) });
    } finally {
      setTxStep("idle");
      setTxPhase(null);
    }
  };

  const handleSyncEngine = async () => {
    if (!ensureTransactionReady("sync the engine")) return;
    if (!engineSyncRequired) {
      setFlash({ tone: "neutral", text: "Engine is already current. No catch-up transaction is needed." });
      return;
    }

    setTxStep("syncing");
    setTxPhase("wallet");
    setFlash({ tone: "neutral", text: `Syncing the engine backlog (${backlog} epoch${backlog === 1 ? "" : "s"}). Confirm in your wallet.` });

    try {
      const hash = await writeContractAsync({
        address: NARA_LOTTO_POOL_ADDRESS,
        abi: lottoPoolAbi,
        functionName: "syncEngine",
      });
      await waitForConfirmation(hash, "Engine sync");
      setFlash({ tone: "success", text: "Engine catch-up confirmed. The next join, draw, or withdraw should have less backlog to process.", txHash: hash });
      invalidateLotto();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Engine sync", err) });
    } finally {
      setTxStep("idle");
      setTxPhase(null);
    }
  };

  const handleHarvest = async () => {
    if (!ensureTransactionReady("refresh the jackpot") || !previewSupported) return;
    if (drawPending) {
      setFlash({ tone: "error", text: "Wait for the pending draw to finish before refreshing the jackpot." });
      return;
    }
    if (harvestableClones === 0) {
      setFlash({ tone: "neutral", text: "Jackpot is already fresh. No accrued rewards are waiting to be harvested right now." });
      return;
    }

    setTxStep("harvesting");
    setTxPhase("wallet");
    setFlash({ tone: "neutral", text: `Refreshing jackpot from ${harvestableClones} active ${harvestableClones === 1 ? "entry" : "entries"}. Confirm in your wallet.` });
    try {
      const hash = await writeContractAsync({
        address: NARA_LOTTO_POOL_ADDRESS,
        abi: lottoPoolAbi,
        functionName: "harvestAll",
      });
      await waitForConfirmation(hash, "Jackpot refresh");
      setFlash({ tone: "success", text: "Jackpot refreshed. Newly accrued NARA and ETH are now in the live pot.", txHash: hash });
      invalidateLotto();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Jackpot refresh", err) });
    } finally {
      setTxStep("idle");
      setTxPhase(null);
    }
  };

  const handleWithdraw = async () => {
    if (!ensureTransactionReady("withdraw principal") || unlockFeeWeiRead.data == null) return;
    if (hasUnlockEthShortfall) {
      setFlash({ tone: "error", text: `You need at least ${formatEth(unlockFeeWei)} ETH on Base for the unlock fee, plus gas.` });
      return;
    }
    setTxStep("withdrawing");
    setTxPhase("wallet");
    setFlash({ tone: "neutral", text: `Withdrawing your NARA. Confirm in your wallet.` });
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
      setTxPhase(null);
    }
  };

  const handleDrawWinner = async () => {
    if (!ensureTransactionReady("trigger the draw")) return;
    setTxStep("drawing");
    setTxPhase("wallet");
    setFlash({ tone: "neutral", text: "Triggering draw check. Confirm in your wallet." });
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
          ? `Draw check confirmed. Jackpot still below the ${minPrizeLabel} minimum â€” no VRF started yet.`
          : "Draw requested. Waiting for Chainlink VRF randomness.",
        txHash: hash,
      });
      invalidateLotto();
      fetchDrawHistory();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Draw trigger", err) });
    } finally {
      setTxStep("idle");
      setTxPhase(null);
    }
  };

  const handleClaimWinnings = async () => {
    if (!ensureTransactionReady("claim winnings")) return;
    setTxStep("claiming");
    setTxPhase("wallet");
    setFlash({ tone: "neutral", text: "Claiming your prize. Confirm in your wallet." });
    try {
      const hash = await writeContractAsync({
        address: NARA_LOTTO_POOL_ADDRESS,
        abi: lottoPoolAbi,
        functionName: "claimWinnings",
      });
      await waitForConfirmation(hash, "Prize claim");
      setFlash({ tone: "success", text: "Winnings claimed and sent to your wallet.", txHash: hash });
      invalidateLotto();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Claim", err) });
    } finally {
      setTxStep("idle");
      setTxPhase(null);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedAddr(text);
      setTimeout(() => setCopiedAddr(null), 1500);
    });
  };

  const handleShare = async (text: string) => {
    const sharePayload = {
      title: "NARA Lucky Epoch",
      text,
      url: window.location.href,
    };

    try {
      if (navigator.share) {
        await navigator.share(sharePayload);
        return;
      }
    } catch {
      // Fall through to the X/share fallback when the browser share sheet closes or fails.
    }

    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${text} ${window.location.href}`)}`;
    window.open(intent, "_blank", "noopener,noreferrer");
  };

  const isBusy = txStep !== "idle";
  const jackpotNeedsRefresh = previewSupported === true && harvestableClones > 0;
  const totalDraws = drawHistory.length;
  const drawsCompletedInCurrentSeason = totalDraws % SEASON_DRAWS;
  const currentSeason = Math.floor(totalDraws / SEASON_DRAWS) + 1;
  const drawsRemainingInSeason = drawsCompletedInCurrentSeason === 0 ? SEASON_DRAWS : SEASON_DRAWS - drawsCompletedInCurrentSeason;
  const currentSeasonDraws = drawsCompletedInCurrentSeason > 0 ? drawHistory.slice(0, drawsCompletedInCurrentSeason) : [];
  const currentSeasonHigh = currentSeasonDraws.reduce((best, record) => {
    if (record.potEth > best.potEth) return record;
    if (record.potEth === best.potEth && record.potNara > best.potNara) return record;
    return best;
  }, { winner: "", potNara: 0n, potEth: 0n, txHash: "", blockNumber: 0n } as DrawRecord);
  const seasonHighKnown = currentSeasonHigh.potNara > 0n || currentSeasonHigh.potEth > 0n;
  const joinShareText = isParticipant
    ? `I am in ${seasonLabelFromIndex(currentSeason)} on NARA Lucky Epoch. Locked NARA, principal matures later, and one winner takes the pool yield.`
    : `NARA Lucky Epoch ${seasonLabelFromIndex(currentSeason)} is open. Lock NARA, keep your net principal after maturity, and one winner takes the pool yield.`;
  const jackpotShareText = `NARA Lucky Epoch ${seasonLabelFromIndex(currentSeason)} jackpot is at ${formatNara(displayedPotNara)} NARA + ${formatEth(displayedPotEth)} ETH on Base.`;
  const latestWinner = drawHistory[0] ?? null;
  const latestWinnerSeason = latestWinner ? seasonIndexForHistoryRecord(0, totalDraws) : null;
  const sponsorLaneLive = sponsorFeatureSupported === true;
  const sponsorLanePending = sponsorFeatureSupported === false;

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

  const sponsorPresetAmounts = SPONSOR_AMOUNT_PRESETS;

  // Render

  return (
    <>
    <a href="#main-content" className="nb-skip-link">Skip to main content</a>

    {/* Draw drama overlay â€” shown when Chainlink VRF is running */}
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

      {/* â”€â”€ HERO: jackpot billboard top, join panel below â”€â”€ */}
      <section className="nb-hero" aria-label="Prize pool and entry">

        {/* Jackpot billboard â€” weight 10 HERO, dark inverted card */}
        <div className="nb-jackpot">
          <div className="nb-jackpot-ring" aria-hidden="true" />
          <div className="nb-jackpot-ring nb-jackpot-ring--2" aria-hidden="true" />
          <p className="nb-jackpot-label">Jackpot</p>
          <div className="nb-jackpot-stack">
            <div className="nb-jackpot-row">
              <span className="nb-jackpot-num">{formatNara(displayedPotNara)}</span>
              <span className="nb-jackpot-ticker">NARA</span>
            </div>
            <div className="nb-jackpot-sep">
              <span className="nb-jackpot-sep-line" />
              <span className="nb-jackpot-sep-plus">+</span>
              <span className="nb-jackpot-sep-line" />
            </div>
            <div className="nb-jackpot-row nb-jackpot-row--eth">
              <span className="nb-jackpot-num nb-jackpot-num--eth">{formatEth(displayedPotEth)}</span>
              <span className="nb-jackpot-ticker">ETH</span>
            </div>
          </div>
          <div className="nb-jackpot-foot">
            <span className="nb-jackpot-badge">
              <span className="nb-live-dot" />
              Live on Base
            </span>
            <span className="nb-jackpot-badge">Net Principal Returns At Maturity</span>
            <span className="nb-jackpot-badge">Chainlink VRF</span>
            {previewSupported ? <span className="nb-jackpot-badge">Includes Accrued Yield</span> : null}
          </div>
          <div className="nb-jackpot-meta">
            <div className="nb-jackpot-season">
              <div className="nb-jackpot-season-card">
                <span className="nb-jackpot-season-label">Season</span>
                <strong className="nb-jackpot-season-value">{seasonLabelFromIndex(currentSeason)}</strong>
              </div>
              <div className="nb-jackpot-season-card">
                <span className="nb-jackpot-season-label">Draws Left</span>
                <strong className="nb-jackpot-season-value">{drawsRemainingInSeason}</strong>
              </div>
              <div className="nb-jackpot-season-card">
                <span className="nb-jackpot-season-label">Season High</span>
                <strong className="nb-jackpot-season-value">{seasonHighKnown ? `${formatNara(currentSeasonHigh.potNara)} N + ${formatEth(currentSeasonHigh.potEth)} E` : "No draw yet"}</strong>
              </div>
            </div>
            {previewSupported ? (
              <>
                <div className="nb-jackpot-breakdown">
                  <div className="nb-jackpot-breakdown-row">
                    <span className="nb-jackpot-breakdown-label">Live onchain</span>
                    <span className="nb-jackpot-breakdown-value">{formatNara(visiblePotNara)} NARA + {formatEth(visiblePotEth)} ETH</span>
                  </div>
                  <div className="nb-jackpot-breakdown-row">
                    <span className="nb-jackpot-breakdown-label">Frozen for draw</span>
                    <span className="nb-jackpot-breakdown-value">{formatNara(frozenPotNara)} NARA + {formatEth(frozenPotEth)} ETH</span>
                  </div>
                  <div className="nb-jackpot-breakdown-row">
                    <span className="nb-jackpot-breakdown-label">Still accruing</span>
                    <span className="nb-jackpot-breakdown-value">{formatNara(unharvestedPotNara)} NARA + {formatEth(unharvestedPotEth)} ETH</span>
                  </div>
                  {poolLockedTotals ? (
                    <>
                      <div className="nb-jackpot-breakdown-row">
                        <span className="nb-jackpot-breakdown-label">Locked backing</span>
                        <span className="nb-jackpot-breakdown-value">{formatNara(poolLockedTotals.totalLocked)} NARA</span>
                      </div>
                      <div className="nb-jackpot-breakdown-row">
                        <span className="nb-jackpot-breakdown-label">Players / sponsors</span>
                        <span className="nb-jackpot-breakdown-value">{formatNara(poolLockedTotals.participantLocked)} N / {formatNara(poolLockedTotals.sponsorLocked)} N ({poolSponsorCount} sponsor{poolSponsorCount === 1 ? "" : "s"})</span>
                      </div>
                    </>
                  ) : null}
                </div>
                <p className="nb-jackpot-hint">
                  {jackpotNeedsRefresh
                    ? `${harvestableClones} ${harvestableClones === 1 ? "entry has" : "entries have"} unharvested rewards ready to refresh onchain.`
                    : "Headline jackpot already includes accrued rewards, even before the next harvest transaction."}
                </p>
              </>
            ) : (
              <p className="nb-jackpot-hint">Headline shows the live onchain pot. If the preview read fails, the jackpot number stays accurate and the deeper breakdown simply stays hidden.</p>
            )}
            <div className="nb-jackpot-share-row">
              <button type="button" className="nb-btn-secondary nb-btn-inline" onClick={() => void handleShare(jackpotShareText)}>Share Jackpot</button>
              <button type="button" className="nb-btn-secondary nb-btn-inline" onClick={() => void handleShare(joinShareText)}>Share Season</button>
            </div>
          </div>
        </div>

        {/* Join CTA */}
        <div className="nb-join-panel">
          <div className="nb-join-head">
            <div>
              <h2 className="nb-join-title">{entryMode === "sponsor" ? "Back The Jackpot" : "Enter The Draw"}</h2>
              <p className="nb-join-sub">
                {entryMode === "sponsor"
                  ? `Back the jackpot without buying draw odds. Sponsor locks deepen the prize, help the pool reach draw pressure sooner, and keep your principal locked onchain until unlock. ${maxLockEpochs > 0 ? `Max duration: ${epochsToTime(maxLockEpochs)}.` : ""}`
                  : `Lock NARA, let the pool rewards build the jackpot, and keep your net principal after maturity.${poolConfig ? ` Lock period: ${epochsToTime(Number(lockDurationEpochs))}.` : ""} First join uses one main button here, even if your wallet still needs approval first.`}
              </p>
            </div>
            {sponsorFeatureSupported !== null ? (
              <div className="nb-mode-toggle" role="tablist" aria-label="Join mode">
                <button
                  type="button"
                  className={`nb-mode-pill${entryMode === "player" ? " is-active" : ""}`}
                  onClick={() => setEntryMode("player")}
                  disabled={isBusy}
                >
                  Play
                </button>
                <button
                  type="button"
                  className={`nb-mode-pill${entryMode === "sponsor" ? " is-active" : ""}`}
                  onClick={() => sponsorLaneLive ? setEntryMode("sponsor") : null}
                  disabled={isBusy || !sponsorLaneLive}
                  aria-disabled={!sponsorLaneLive}
                >
                  Sponsor
                </button>
              </div>
            ) : null}
          </div>

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
          ) : entryMode === "player" ? (
            isParticipant ? (
              <div className="nb-already-joined">
                <span className="nb-badge warming">Already In</span>
                <p className="nb-info-text">{sponsorLaneLive ? "Your entry is in the pool. Check status below, or switch this tile to Sponsor to deepen the jackpot without changing draw odds." : "Your entry is in the pool. Check status below while the sponsor lane rolls out on this pool address."}</p>
              </div>
            ) : (
              <>
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
                    {txStep === "approving" ? "Step 1 of 2 - Approve NARA" : "Step 2 of 2 - Join pool"}
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

                {amountWei > 0n && (
                  <div className="nb-odds-strip">
                    <span className="nb-odds-label">Your odds if you join now</span>
                    <span className="nb-odds-value">
                      {previewWeight > 0n ? previewOdds.toFixed(2) + "%" : "..."}
                    </span>
                  </div>
                )}

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
                    {hardSyncRequired
                      ? `Engine backlog is ${backlog} epochs. Run a sync transaction first if you want the next join or draw to stay light.`
                      : `Engine is ${backlog} epoch${backlog === 1 ? "" : "s"} behind. V2 can catch up inside the next join.`}
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
                      Get NARA on Uniswap
                    </a>
                  </div>
                ) : (
                  <>
                    <p className="nb-wallet-action-note">{isApproved ? "Allowance ready. One wallet confirmation left." : "First join needs two wallet confirmations: approve, then join."}</p>
                    <div className="nb-button-row single">
                      <button
                        type="button"
                        className="nb-btn-primary"
                        onClick={handleJoinFlow}
                        disabled={isBusy || amountWei === 0n || !canDeposit}
                        aria-disabled={!canDeposit || isBusy}
                        aria-busy={txStep === "approving" || txStep === "depositing"}
                      >
                        {txStep === "approving"
                          ? txPhase === "chain"
                            ? <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Confirming approval...</span>Confirming approval...</>
                            : <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Approve in wallet...</span>Approve in wallet...</>
                          : txStep === "depositing"
                            ? txPhase === "chain"
                              ? <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Confirming join...</span>Confirming join...</>
                              : <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Join in wallet...</span>Join in wallet...</>
                            : isApproved ? "Join Pool" : "Approve & Join"}
                      </button>
                    </div>
                  </>
                )}
              </>
            )
          ) : sponsorLanePending ? (
            <div className="nb-already-joined">
              <span className="nb-badge season">Redeploy Pending</span>
              <p className="nb-info-text">This frontend already supports sponsor mode, but this pool address is still running the player-only deployment.</p>
            </div>
          ) : (
            <>
              <div className="nb-presets" role="group" aria-label="Quick sponsor amounts">
                {sponsorPresetAmounts.map((amt) => (
                  <button
                    key={String(amt)}
                    type="button"
                    className={`nb-preset-btn${sponsorAmountWei === amt ? " active" : ""}`}
                    onClick={() => setSponsorAmount(formatEther(amt))}
                    disabled={isBusy}
                  >
                    {formatNara(amt)}
                  </button>
                ))}
              </div>

              {(txStep === "approving" || txStep === "sponsoring") && (
                <div className="nb-step-indicator">
                  <span className="nb-step-dot" />
                  {txStep === "approving" ? "Step 1 of 2 - Approve NARA" : "Step 2 of 2 - Sponsor lock"}
                </div>
              )}

              <div className="nb-input-wrap">
                <label htmlFor="sponsor-amount" className="nb-input-label">Sponsor Backing (NARA)</label>
                <input
                  id="sponsor-amount"
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[.,]?[0-9]*"
                  className="nb-input"
                  value={sponsorAmount}
                  onChange={(e) => setSponsorAmount(e.target.value)}
                  placeholder={formatNara(SPONSOR_MIN_DEPOSIT)}
                  disabled={isBusy}
                />
                {sponsorAmountError && <p className="nb-input-error">{sponsorAmountError}</p>}
              </div>

              <div className="nb-compact-stack">
                <span className="nb-input-label">Lock Duration</span>
                <div className="nb-presets" role="group" aria-label="Sponsor lock duration">
                  {sponsorDurationOptions.map((duration) => (
                    <button
                      key={duration}
                      type="button"
                      className={`nb-preset-btn${sponsorDurationEpochs === duration ? " active" : ""}`}
                      onClick={() => setSponsorDurationEpochs(duration)}
                      disabled={isBusy}
                    >
                      {duration === maxLockEpochs && maxLockEpochs > 0 ? `Max ${epochsToTime(duration)}` : epochsToTime(duration)}
                    </button>
                  ))}
                </div>
              </div>

              {sponsorAmountWei > 0n && (
                <div className="nb-fee-block">
                  <div className="nb-fee-row">
                    <span>Net backing</span>
                    <span className="nb-fee-val">{formatNara(sponsorNetLockAmount)} NARA</span>
                  </div>
                  <div className="nb-fee-row">
                    <span>Sponsor fee</span>
                    <span className="nb-fee-val">{formatEth(lockFeeWei)} ETH + gas</span>
                  </div>
                  <div className="nb-fee-row">
                    <span>Unlocks</span>
                    <span className="nb-fee-val">{epochsToDate(currentEpoch, sponsorDurationEpochs)}</span>
                  </div>
                </div>
              )}

              <div className="nb-soft-note">Sponsor locks feed NARA and ETH yield into the jackpot but never enter winner selection.</div>

              {engineSyncRequired && (
                <div className="nb-soft-note">
                  {hardSyncRequired
                    ? `Engine backlog is ${backlog} epochs. Run a sync transaction first if you want sponsor locks to stay lightweight.`
                    : `Engine is ${backlog} epoch${backlog === 1 ? "" : "s"} behind. V2 can catch up inside the sponsor lock.`}
                </div>
              )}

              {hasSponsorNaraShortfall && sponsorAmountWei > 0n ? (
                <div className="nb-button-row">
                  <a
                    href={`https://app.uniswap.org/swap?chain=base&outputCurrency=0xE444de61752bD13D1D37Ee59c31ef4e489bd727C`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="nb-btn-primary nb-btn-get-nara"
                  >
                    Get NARA on Uniswap
                  </a>
                </div>
              ) : (
                <>
                  <p className="nb-wallet-action-note">{isSponsorApproved ? "Allowance ready. One wallet confirmation left." : "First sponsor lock needs two wallet confirmations: approve, then lock."}</p>
                  <div className="nb-button-row single">
                    <button
                      type="button"
                      className="nb-btn-primary"
                      onClick={handleSponsorFlow}
                      disabled={isBusy || sponsorAmountWei === 0n || !canSponsor}
                      aria-disabled={!canSponsor || isBusy}
                      aria-busy={txStep === "approving" || txStep === "sponsoring"}
                    >
                      {txStep === "approving"
                        ? txPhase === "chain"
                          ? <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Confirming approval...</span>Confirming approval...</>
                          : <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Approve in wallet...</span>Approve in wallet...</>
                        : txStep === "sponsoring"
                          ? txPhase === "chain"
                            ? <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Confirming sponsor lock...</span>Confirming sponsor lock...</>
                            : <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Sponsor in wallet...</span>Sponsor in wallet...</>
                          : isSponsorApproved ? "Sponsor Pool" : "Approve & Sponsor"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </section>

      {/* Stats strip - 3 cards, draw timer dominant */}
      <section className="nb-stats-strip" aria-label="Pool stats">
        <div className={`nb-stat-card${drawReady ? " is-ready" : ""}${drawPending ? " is-pending" : ""}`}>
          <p className="nb-stat-label">Draw</p>
          {drawPending ? (
            <><p className="nb-stat-value is-vrf">VRF</p><p className="nb-stat-sub">winner being picked</p></>
          ) : drawWaitingForLiveEntry ? (
            <><p className="nb-stat-value is-wait">Warm-up</p><p className="nb-stat-sub">cooldown clear, waiting for live entry</p></>
          ) : drawWaitingForPrize ? (
            <><p className="nb-stat-value is-wait">Building</p><p className="nb-stat-sub">cooldown clear, waiting for prize trigger</p></>
          ) : drawReady ? (
            <><p className="nb-stat-value is-gold">Ready</p><p className="nb-stat-sub">draw can run now</p></>
          ) : (
            <>
              <p className="nb-stat-value">{epochsUntilDraw > 0 ? epochsToTime(epochsUntilDraw) : "—"}</p>
              <p className="nb-stat-sub">cooldown ends · epoch {nextDrawEpoch > 0 ? nextDrawEpoch : "—"}</p>
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
          <span className="nb-flash-text">Prize ready - {formatNara(winningsNara)} NARA + {formatEth(winningsEth)} ETH</span>
        </div>
      )}
      {!hasWinnings && drawReady && !drawPending && (
        <div className="nb-flash draw-ready">
          <span className="nb-flash-text">Cooldown clear · prize trigger met · draw can run now</span>
        </div>
      )}
      {!hasWinnings && drawWaitingForLiveEntry && !drawPending && (
        <div className="nb-flash neutral">
          <span className="nb-flash-text">Cooldown clear, but there is no live entry in the draw yet.</span>
        </div>
      )}
      {!hasWinnings && drawWaitingForPrize && !drawPending && (
        <div className="nb-flash neutral">
          <span className="nb-flash-text">Cooldown clear. Waiting for more prize growth, more live players, or the deadline path.</span>
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

      {/* â”€â”€ Action zone: how it works + your entry â”€â”€ */}
      <div className="nb-action-zone">

        {/* How it works â€” 4 clean tiles */}
        <div className="nb-panel">
          <h2 className="nb-panel-header">How It Works</h2>
          <div className="nb-how-strip">
            <div className="nb-how-item">
              <span className="nb-how-num">1</span>
              <p className="nb-how-title">Lock NARA</p>
              <p className="nb-how-copy">{poolConfig ? `${formatNara(minDepositAmount)}-${formatNara(maxDepositAmount)} NARA. Principal stays yours.` : "Loading..."}</p>
            </div>
            <div className="nb-how-item">
              <span className="nb-how-num">2</span>
              <p className="nb-how-title">Warm-up</p>
              <p className="nb-how-copy">Entry goes live after a short delay. Then it counts in every draw.</p>
            </div>
            <div className="nb-how-item">
              <span className="nb-how-num">3</span>
              <p className="nb-how-title">Draw fires</p>
              <p className="nb-how-copy">Yield accrues from every live lock. After cooldown, the draw fires once a live entry and prize trigger are in place. Sponsors can deepen the pot without taking draw odds.</p>
            </div>
            <div className="nb-how-item">
              <span className="nb-how-num">4</span>
              <p className="nb-how-title">Withdraw</p>
              <p className="nb-how-copy">After the lock matures, withdraw net principal. If the engine falls behind, anyone can sync it and keep the pool moving.</p>
            </div>
          </div>
        </div>

        {/* Your entry â€” right panel */}
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
                    {txStep === "claiming"
                      ? txPhase === "chain"
                        ? <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Confirming...</span>Confirming...</>
                        : <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Waiting for wallet...</span>Waiting...</>
                      : "Claim Prize"}
                  </button>
                </div>
              )}

              {isParticipant ? (
                <div className="nb-entry-block">
                  {drawWaitingForLiveEntry && !entryIsLive ? (
                    <div className="nb-soft-note">Cooldown cleared, but your entry is still warming up.</div>
                  ) : null}
                  <div className="nb-entry-topline">
                    <span className={"nb-badge " + (entryIsLive ? "in-draw" : "warming")}>
                      {entryIsLive ? "Live" : "Warming Up"}
                    </span>
                    <span className="nb-badge season">Season Participant</span>
                    <p className="nb-entry-caption">
                      {entryIsLive ? "Active in the next draw." : `Live in ${epochsToTime(entryStartsInEpochs)}.`}
                    </p>
                  </div>

                  <div className="nb-status-grid">
                    <div className="nb-status-card">
                      <span className="nb-status-label">Odds</span>
                      <strong className="nb-status-value">{entryIsLive ? `${userOddsPercent.toFixed(2)}%` : "?"}</strong>
                    </div>
                    <div className="nb-status-card">
                      <span className="nb-status-label">Net locked</span>
                      <strong className="nb-status-value">{participantNetAmount > 0n ? `${formatNara(participantNetAmount)} N` : "..."}</strong>
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
                      <div className="nb-prog-fill" style={{ width: `${lockProgressPct}%` }} />
                    </div>
                    <p className="nb-prog-hint">
                      {withdrawActionReady ? "Unlocked - ready to withdraw." : `Unlocks ${epochsToDate(currentEpoch, unlocksInEpochs)}.`}
                    </p>
                  </div>

                  {withdrawActionReady && engineSyncRequired ? (
                    <div className="nb-soft-note">Engine {backlog} epoch{backlog === 1 ? "" : "s"} behind. V2 auto-syncs inside withdraw.</div>
                  ) : null}
                  {hasUnlockEthShortfall ? (
                    <p className="nb-input-error">Need {formatEth(unlockFeeWei)} ETH for unlock fee + gas.</p>
                  ) : null}

                  <button
                    type="button"
                    className="nb-btn-secondary"
                    style={{ marginTop: "14px" }}
                    onClick={handleWithdraw}
                    disabled={isBusy || !withdrawActionReady || hasUnlockEthShortfall}
                    aria-disabled={!withdrawActionReady || isBusy || hasUnlockEthShortfall}
                    aria-busy={txStep === "withdrawing"}
                  >
                    {txStep === "withdrawing"
                      ? txPhase === "chain"
                        ? <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Confirming...</span>Confirming...</>
                        : <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Waiting for wallet...</span>Waiting...</>
                      : withdrawActionReady ? "Withdraw NARA" : `Epoch ${unlockEpoch}`}
                  </button>
                </div>
              ) : null}

              {visibleSponsorPositions.length > 0 ? (
                <div className="nb-sponsor-block">
                  <div className="nb-entry-topline nb-entry-topline--stack">
                    <div className="nb-badge-row">
                      <span className="nb-badge season">Sponsor Backing</span>
                      <span className="nb-badge not-in-draw">Not In Odds</span>
                    </div>
                    <p className="nb-entry-caption">{visibleSponsorPositions.length} active sponsor lock{visibleSponsorPositions.length === 1 ? "" : "s"} are feeding the jackpot from this wallet.</p>
                  </div>

                  <div className="nb-sponsor-list">
                    {visibleSponsorPositions.map((position) => {
                      const sponsorUnlocksInEpochs = Math.max(0, position.unlockEpoch - settledEpoch);
                      const sponsorReady = sponsorUnlocksInEpochs === 0;
                      return (
                        <div className="nb-sponsor-row" key={position.sponsorId.toString()}>
                          <div className="nb-sponsor-copy">
                            <p className="nb-sponsor-row-title">Sponsor #{position.sponsorId.toString()}</p>
                            <p className="nb-sponsor-row-meta">
                              {formatNara(position.principalAmount)} NARA ? {epochsToTime(position.durationEpochs)} ? {sponsorReady ? "unlock ready" : `unlocks ${epochsToDate(currentEpoch, sponsorUnlocksInEpochs)}`}
                            </p>
                          </div>
                          {sponsorReady ? (
                            <button
                              type="button"
                              className="nb-btn-secondary nb-btn-inline nb-btn-compact"
                              onClick={() => handleWithdrawSponsor(position.sponsorId)}
                              disabled={isBusy || sponsorUnlockFeeShortfall}
                              aria-busy={txStep === "withdrawingSponsor"}
                            >
                              {txStep === "withdrawingSponsor" ? "Withdrawing..." : "Withdraw"}
                            </button>
                          ) : (
                            <span className="nb-badge not-in-draw">{epochsToTime(sponsorUnlocksInEpochs)} left</span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {sponsorUnlockFeeShortfall ? (
                    <p className="nb-input-error">Need {formatEth(unlockFeeWei)} ETH for sponsor unlock fee + gas.</p>
                  ) : null}
                </div>
              ) : null}

              {!hasWalletPositions ? (
                <div className="nb-empty-entry">
                  <span className="nb-badge not-in-draw">No Entry</span>
                  <p className="nb-empty-entry-title">Nothing here yet</p>
                  <p className="nb-empty-entry-text">Join above to play, or switch the same tile to sponsor mode to back the jackpot without taking draw odds.</p>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Draw section */}
      <div className="nb-draw-section">
        <h2 className="nb-panel-header">Prize Draw</h2>
        <div className="nb-draw-inner">
          <div>
            {drawWaitingForLiveEntry ? (
              <><p className="nb-countdown">Warm-up</p><p className="nb-countdown-label">cooldown clear · waiting for live entry</p></>
            ) : drawWaitingForPrize ? (
              <><p className="nb-countdown">Building</p><p className="nb-countdown-label">cooldown clear · waiting for prize/player trigger</p></>
            ) : drawReady ? (
              <><p className="nb-countdown">Ready</p><p className="nb-countdown-label">cooldown clear · draw can run now</p></>
            ) : (
              <><p className="nb-countdown">{epochsUntilDraw > 0 ? epochsToTime(epochsUntilDraw) : "—"}</p><p className="nb-countdown-label">until cooldown ends · epoch {nextDrawEpoch > 0 ? nextDrawEpoch : "—"}</p></>
            )}
          </div>

          <div className="nb-draw-actions">
            {!isConnected || isWrongNetwork ? (
              <div className="nb-draw-wallet-note">
                <WalletActionButton className="nb-btn-secondary" connectLabel={!isConnected ? "Connect Wallet" : `Switch to ${NARA_CHAIN_NAME}`} />
              </div>
            ) : (
              <>
                {previewSupported ? (
                  <button
                    type="button"
                    className="nb-btn-secondary"
                    onClick={handleHarvest}
                    disabled={isBusy || !jackpotNeedsRefresh || drawPending}
                    aria-busy={txStep === "harvesting"}
                  >
                    {txStep === "harvesting"
                      ? txPhase === "chain"
                        ? <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Confirming refresh...</span>Confirming refresh...</>
                        : <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Refresh in wallet...</span>Refresh in wallet...</>
                      : jackpotNeedsRefresh
                        ? `Refresh Jackpot (${harvestableClones})`
                        : "Jackpot Fresh"}
                  </button>
                ) : null}
                {engineSyncRequired ? (
                  <button
                    type="button"
                    className="nb-btn-secondary"
                    onClick={handleSyncEngine}
                    disabled={isBusy}
                    aria-busy={txStep === "syncing"}
                  >
                    {txStep === "syncing"
                      ? txPhase === "chain"
                        ? <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Confirming sync...</span>Confirming sync...</>
                        : <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Sync in wallet...</span>Sync in wallet...</>
                      : `Sync Engine${hardSyncRequired ? ` (${backlog})` : ""}`}
                  </button>
                ) : null}
                <button type="button" className="nb-btn-secondary" onClick={() => void handleShare(jackpotShareText)}>Share Jackpot</button>
                {latestWinner ? <button type="button" className="nb-btn-secondary" onClick={() => void handleShare(`Winner live on NARA Lucky Epoch: ${shortAddress(latestWinner.winner)} took ${formatNara(latestWinner.potNara)} NARA + ${formatEth(latestWinner.potEth)} ETH in ${seasonLabelFromIndex(latestWinnerSeason ?? currentSeason)}.`)}>Share Winner</button> : null}
                {drawWaitingForLiveEntry && !drawPending ? (
                  <button type="button" className="nb-btn-gold" disabled aria-disabled="true">Waiting for live entry</button>
                ) : drawWaitingForPrize && !drawPending ? (
                  <button type="button" className="nb-btn-gold" disabled aria-disabled="true">Building towards draw</button>
                ) : drawReady && !drawPending ? (
                  <button
                    type="button"
                    className="nb-btn-gold"
                    onClick={handleDrawWinner}
                    disabled={isBusy}
                    aria-busy={txStep === "drawing"}
                  >
                    {txStep === "drawing"
                      ? txPhase === "chain"
                        ? <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Confirming...</span>Confirming...</>
                        : <><span className="nb-spinner" aria-hidden="true" /><span className="nb-sr-only">Waiting for wallet...</span>Waiting...</>
                      : "Run Draw"}
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="nb-recent-header">
          <h3 className="nb-panel-header" style={{ marginBottom: "12px" }}>Recent Winners</h3>
          <span className="nb-badge season">{seasonLabelFromIndex(currentSeason)}</span>
        </div>
        {drawHistory.length === 0 ? (
          <div className="nb-placeholder">No draws yet. First winner in {seasonLabelFromIndex(currentSeason)} shows here.</div>
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
                      {shortAddress(rec.winner)}<span className="nb-row-badge">{seasonLabelFromIndex(seasonIndexForHistoryRecord(i, totalDraws))}</span>
                      <button type="button" className="nb-copy-btn" onClick={() => handleCopy(rec.winner)} aria-label={copiedAddr === rec.winner ? "Copied!" : "Copy address"}>
                        {copiedAddr === rec.winner ? "✓" : "⧉"}
                      </button>
                    </td>
                    <td>{formatNara(rec.potNara)}</td>
                    <td>{formatEth(rec.potEth)}</td>
                    <td>
                      {rec.txHash ? (
                        <a href={`https://basescan.org/tx/${rec.txHash}`} target="_blank" rel="noopener noreferrer" className="nb-view-link">View {"->"}</a>
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






