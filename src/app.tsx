import { useState, useEffect, useCallback } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  usePublicClient,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { formatEther, parseEther, type Log } from "viem";

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
};

type DrawRecord = {
  winner: string;
  potNara: bigint;
  potEth: bigint;
  txHash: string;
  blockNumber: bigint;
};

const MIN_ACTIVE_PLAYERS = 1;

// Helpers

function shortAddress(addr: string): string {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function formatNara(wei: bigint): string {
  return parseFloat(formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatEth(wei: bigint): string {
  return parseFloat(formatEther(wei)).toFixed(4);
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
  if (/epochstale|failed_would_revert|would revert/.test(raw)) {
    return "The pool timer is behind live time. Run Sync Engine First, then try again.";
  }
  if (/smart transaction failed|transaction receipt with hash .* could not be found|could not be found|originaltransactionstatus|cancelled|canceled/.test(raw)) {
    return "The wallet dropped this request before Base accepted it. Sync the engine and retry.";
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
  const [txStep, setTxStep] = useState<"idle" | "approving" | "syncing" | "depositing" | "withdrawing" | "drawing" | "claiming" | "harvesting">("idle");
  const [drawHistory, setDrawHistory] = useState<DrawRecord[]>([]);
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

  const activeTotalWeightRead = useReadContract({
    address: NARA_ENGINE_ADDRESS,
    abi: engineAbi,
    functionName: "activeTotalWeight",
  });

  // Preview weight when amount is entered
  const poolConfig = poolConfigRead.data as any;
  const lockDurationEpochs = poolConfig ? BigInt(poolConfig.lockDurationEpochs ?? 0n) : 0n;

  const amountWei = (() => {
    try { return depositAmount ? parseEther(depositAmount) : 0n; } catch { return 0n; }
  })();

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
  const participantCount = Number((participantCountRead.data ?? 0n) as bigint);
  const lastDrawEpoch = Number((lastDrawEpochRead.data ?? 0n) as bigint);
  const pendingDrawRequestId = (pendingDrawRequestIdRead.data ?? 0n) as bigint;
  const maxParticipants = poolConfig ? Number(poolConfig.maxParticipants ?? 100n) : 100;
  const drawFrequencyEpochs = poolConfig ? Number(poolConfig.drawFrequencyEpochs ?? 0n) : 0;
  const minDepositAmount = poolConfig ? (poolConfig.minDepositAmount as bigint) : 0n;
  const maxDepositAmount = poolConfig ? (poolConfig.maxDepositAmount as bigint) : 0n;
  const openSpots = Math.max(0, maxParticipants - participantCount);

  const pData = participantDataRead.data as any;
  const isParticipant = Boolean(pData?.isActive ?? (pData && pData[4] === true));
  const userWeight = isParticipant ? BigInt(pData?.weight ?? pData?.[3] ?? 0n) : 0n;
  const activationEpoch = isParticipant ? Number(pData?.activationEpoch ?? pData?.[2] ?? 0n) : 0;
  const unlockEpoch = isParticipant ? activationEpoch + Number(lockDurationEpochs) : 0;
  const entryStartsInEpochs = isParticipant ? Math.max(0, activationEpoch - settledEpoch) : 0;
  const entryIsLive = isParticipant && entryStartsInEpochs === 0;
  const unlocksInEpochs = isParticipant ? Math.max(0, unlockEpoch - settledEpoch) : 0;
  const participantAmount = isParticipant ? BigInt(pData?.weight ?? 0n) : 0n; // weight acts as proxy

  const winningsNara = (winningsNaraRead.data ?? 0n) as bigint;
  const winningsEth = (winningsEthRead.data ?? 0n) as bigint;
  const hasWinnings = winningsNara > 0n || winningsEth > 0n;

  const activeTotalWeight = (activeTotalWeightRead.data ?? 0n) as bigint;
  const userOddsPercent = entryIsLive && activeTotalWeight > 0n && userWeight > 0n
    ? Number((userWeight * 10000n) / activeTotalWeight) / 100
    : 0;

  const allowance = (tokenAllowanceRead.data ?? 0n) as bigint;
  const isApproved = amountWei > 0n && allowance >= amountWei;

  const drawReady = pendingDrawRequestId === 0n
    && participantCount > 0
    && drawFrequencyEpochs > 0
    && settledEpoch >= lastDrawEpoch + drawFrequencyEpochs;

  const drawPending = pendingDrawRequestId !== 0n;
  const nextDrawEpoch = drawFrequencyEpochs > 0 ? lastDrawEpoch + drawFrequencyEpochs : 0;

  const epochsUntilDraw = drawFrequencyEpochs > 0
    ? Math.max(0, nextDrawEpoch - settledEpoch)
    : 0;

  const canDeposit = !isParticipant
    && amountWei >= minDepositAmount
    && (maxDepositAmount === 0n || amountWei <= maxDepositAmount)
    && participantCount < maxParticipants;

  const lockProgressPct = isParticipant && lockDurationEpochs > 0n
    ? Math.min(100, Math.max(0, Math.round(((settledEpoch - activationEpoch) / Number(lockDurationEpochs)) * 100)))
    : 0;

  const canWithdraw = isParticipant && settledEpoch >= unlockEpoch;

  const previewWeight = (previewWeightRead.data ?? 0n) as bigint;
  const previewOdds = activeTotalWeight > 0n && previewWeight > 0n
    ? Number(((previewWeight) * 10000n) / (activeTotalWeight + previewWeight)) / 100
    : 0;

  const amountError = amountWei > 0n
    ? amountWei < minDepositAmount
      ? `Minimum entry is ${formatNara(minDepositAmount)} NARA.`
      : maxDepositAmount > 0n && amountWei > maxDepositAmount
        ? `Maximum entry is ${formatNara(maxDepositAmount)} NARA.`
        : openSpots === 0
          ? "The pool is full right now. Please wait for an open spot."
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

  // Invalidate queries helper

  const invalidateLotto = useCallback(() => {
    queryClient.invalidateQueries();
  }, [queryClient]);

  const refreshEpochStatus = useCallback(async () => {
    await Promise.allSettled([
      currentEpochRead.refetch(),
      epochStateRead.refetch(),
      participantCountRead.refetch(),
      participantDataRead.refetch(),
      lastDrawEpochRead.refetch(),
      pendingDrawRequestIdRead.refetch(),
      activeTotalWeightRead.refetch(),
    ]);
    queryClient.invalidateQueries();
  }, [
    activeTotalWeightRead,
    currentEpochRead,
    epochStateRead,
    lastDrawEpochRead,
    participantCountRead,
    participantDataRead,
    pendingDrawRequestIdRead,
    queryClient,
  ]);

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

  // Tx handlers

  const handleApprove = async () => {
    if (!ensureWalletReady("approve NARA") || !depositAmount || amountWei === 0n) return;
    setTxStep("approving");
    setFlash({ tone: "neutral", text: "Step 1 of 2 - Approving NARA spend. Confirm in your wallet." });
    try {
      await writeContractAsync({
        address: NARA_TOKEN_ADDRESS,
        abi: tokenAbi,
        functionName: "approve",
        args: [NARA_LOTTO_POOL_ADDRESS as `0x${string}`, amountWei],
      });
      setFlash({ tone: "success", text: "Approval complete. You can now join the prize pool." });
      invalidateLotto();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Approval", err) });
    } finally {
      setTxStep("idle");
    }
  };

  const handleSyncEngine = async () => {
    if (!ensureWalletReady("sync the pool timer") || !publicClient || !engineSyncRequired) return;
    setTxStep("syncing");
    setFlash({ tone: "neutral", text: `Syncing ${backlog} epoch${backlog === 1 ? "" : "s"} so joins settle cleanly.` });
    try {
      const hash = backlog > 1
        ? await writeContractAsync({
            address: NARA_ENGINE_ADDRESS,
            abi: engineAbi,
            functionName: "advanceEpochs",
            args: [BigInt(backlog)],
          })
        : await writeContractAsync({
            address: NARA_ENGINE_ADDRESS,
            abi: engineAbi,
            functionName: "advanceEpoch",
          });
      await publicClient.waitForTransactionReceipt({ hash });
      await refreshEpochStatus();
      setFlash({ tone: "success", text: "Pool timer synced. You can join now." });
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Sync", err) });
    } finally {
      setTxStep("idle");
    }
  };

  const handleDeposit = async () => {
    if (!ensureWalletReady("enter the draw") || !depositAmount || !lockFeeWeiRead.data) return;
    if (engineSyncRequired) {
      setFlash({
        tone: "error",
        text: `The pool timer is ${backlog} epoch${backlog === 1 ? "" : "s"} behind live time. Run Sync Engine First, then join.`
      });
      return;
    }
    setTxStep("depositing");
    setFlash({ tone: "neutral", text: "Step 2 of 2 - Joining the prize pool. Confirm in your wallet." });
    try {
      await writeContractAsync({
        address: NARA_LOTTO_POOL_ADDRESS,
        abi: lottoPoolAbi,
        functionName: "deposit",
        args: [amountWei],
        value: lockFeeWeiRead.data as bigint,
      });
      setFlash({ tone: "success", text: "You joined the prize pool. Your entry starts counting after a short warm-up." });
      setDepositAmount("");
      invalidateLotto();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Deposit", err) });
    } finally {
      setTxStep("idle");
    }
  };

  const handleWithdraw = async () => {
    if (!ensureWalletReady("withdraw principal") || !unlockFeeWeiRead.data) return;
    setTxStep("withdrawing");
    setFlash({ tone: "neutral", text: "Withdrawing your locked NARA. Confirm in your wallet." });
    try {
      await writeContractAsync({
        address: NARA_LOTTO_POOL_ADDRESS,
        abi: lottoPoolAbi,
        functionName: "withdraw",
        value: unlockFeeWeiRead.data as bigint,
      });
      setFlash({ tone: "success", text: "Your locked NARA is back in your wallet." });
      invalidateLotto();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Withdrawal", err) });
    } finally {
      setTxStep("idle");
    }
  };

  const handleDrawWinner = async () => {
    if (!ensureWalletReady("trigger the draw")) return;
    setTxStep("drawing");
    setFlash({ tone: "neutral", text: "Running the prize draw. Chainlink VRF will pick the winner." });
    try {
      await writeContractAsync({
        address: NARA_LOTTO_POOL_ADDRESS,
        abi: lottoPoolAbi,
        functionName: "drawWinner",
      });
      setFlash({ tone: "neutral", text: "Prize draw requested. Waiting for Chainlink VRF randomness..." });
      invalidateLotto();
      fetchDrawHistory();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Draw trigger", err) });
    } finally {
      setTxStep("idle");
    }
  };

  const handleClaimWinnings = async () => {
    if (!ensureWalletReady("claim winnings")) return;
    setTxStep("claiming");
    setFlash({ tone: "neutral", text: "Claiming your prize. Confirm in your wallet." });
    try {
      await writeContractAsync({
        address: NARA_LOTTO_POOL_ADDRESS,
        abi: lottoPoolAbi,
        functionName: "claimWinnings",
      });
      setFlash({ tone: "success", text: "Winnings claimed and sent to your wallet." });
      invalidateLotto();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Claim", err) });
    } finally {
      setTxStep("idle");
    }
  };

  const handleHarvest = async () => {
    if (!ensureWalletReady("harvest yield")) return;
    setTxStep("harvesting");
    setFlash({ tone: "neutral", text: "Moving fresh yield into the prize pool..." });
    try {
      await writeContractAsync({
        address: NARA_LOTTO_POOL_ADDRESS,
        abi: lottoPoolAbi,
        functionName: "harvestBatch",
        args: [0n, 50n],
      });
      setFlash({ tone: "success", text: "Fresh yield was added to the prize pool." });
      invalidateLotto();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Harvest", err) });
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
      <section className="nb-jackpot-hero" aria-label="Prize Pool">
        <div className="nb-jackpot-shimmer" aria-hidden="true" />
        <p className="nb-jackpot-label">Live Prize Pool</p>
        <div className="nb-jackpot-amount">
          <span className="nb-jackpot-nara">{formatNara(potNara)}<span className="nb-jackpot-unit"> NARA</span></span>
          <span className="nb-jackpot-divider">+</span>
          <span className="nb-jackpot-eth">{formatEth(potEth)}<span className="nb-jackpot-unit"> ETH</span></span>
        </div>
        <p className="nb-jackpot-sub">Lock NARA, keep your principal, and one live entry wins the pooled yield.</p>
        <div className="nb-jackpot-tags">
          <span className="nb-jackpot-tag">live on base</span>
          <span className="nb-jackpot-tag">principal protected</span>
          <span className="nb-jackpot-tag">{MIN_ACTIVE_PLAYERS} live player needed</span>
          <span className="nb-jackpot-tag">chainlink vrf</span>
        </div>
      </section>

      {/* Context row */}
      <section className="nb-context-row" aria-label="Pool stats">
        <div className={`nb-ctx-card nb-ctx-timer${drawReady ? " nb-ctx-ready" : ""}${drawPending ? " nb-ctx-pending" : ""}`}>
          <p className="nb-ctx-label">Draw Status</p>
          {drawPending ? (
            <>
              <p className="nb-ctx-value nb-ctx-vrf">VRF</p>
              <p className="nb-ctx-sub">winner being picked now</p>
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
          <p className="nb-ctx-sub">{openSpots} spot{openSpots === 1 ? "" : "s"} open</p>
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
      {!hasWinnings && drawReady && !drawPending && (
        <div className="nb-flash draw-ready">
          The timer is finished. Anyone can run the draw now.
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
                Choose how much NARA to lock, approve once, then join. Your principal stays yours while the yield builds the prize pool.
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
                <strong className="nb-fact-value">{MIN_ACTIVE_PLAYERS} live player</strong>
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
              {txStep === "syncing" && (
                <div className="nb-step-indicator">
                  <span className="nb-step-dot" />
                  Ready Check: Sync Pool Timer
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

              {amountWei > 0n && previewWeight > 0n && (
                <div className="nb-preview-card">
                  <p className="nb-panel-header">Quick Check</p>
                  <div className="nb-data-row" style={{ borderTop: "none", paddingTop: 0 }}>
                    <span className="nb-data-label">Estimated odds</span>
                    <span className="nb-data-value">{previewOdds.toFixed(2)}%</span>
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
                  Sync needed first. The pool timer is {backlog} epoch{backlog === 1 ? "" : "s"} behind live time. Run one quick sync before you join so MetaMask can price the transaction cleanly.
                </div>
              )}

              <p className="nb-wallet-action-note">
                {engineSyncRequired
                  ? "Approve anytime, then run Sync Engine First. After that, Join Pool will work normally."
                  : "You will see 2 wallet popups: approve, then join."}
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
                  ) : isApproved ? "Approved" : "Approve NARA"}
                </button>

                <button
                  type="button"
                  className="nb-btn-primary"
                  onClick={engineSyncRequired ? handleSyncEngine : handleDeposit}
                  disabled={engineSyncRequired ? isBusy || !publicClient : isBusy || !isApproved || !canDeposit || amountWei === 0n}
                  aria-disabled={engineSyncRequired ? isBusy || !publicClient : !canDeposit || !isApproved || isBusy}
                  aria-busy={txStep === "syncing" || txStep === "depositing"}
                >
                  {txStep === "syncing" ? (
                    <>
                      <span className="nb-spinner" aria-hidden="true" />
                      <span className="nb-sr-only">Syncing...</span>
                      Syncing...
                    </>
                  ) : txStep === "depositing" ? (
                    <>
                      <span className="nb-spinner" aria-hidden="true" />
                      <span className="nb-sr-only">Joining...</span>
                      Joining...
                    </>
                  ) : engineSyncRequired ? "Sync Engine First" : "Join Pool"}
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
                  <p className="nb-rule-copy">When the timer is ready, anyone can run the draw. New entries stay open until that happens.</p>
                </div>
              </div>
              <div className="nb-rule-item">
                <span className="nb-rule-num">4</span>
                <div>
                  <p className="nb-rule-title">Withdraw later</p>
                  <p className="nb-rule-copy">Your principal stays locked for {epochsToTime(Number(lockDurationEpochs))}, then you can withdraw it back to your wallet.</p>
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
                    <div className="nb-status-card">
                      <span className="nb-status-label">Starts counting</span>
                      <strong className="nb-status-value">{entryIsLive ? "Live now" : epochsToTime(entryStartsInEpochs)}</strong>
                    </div>
                    <div className="nb-status-card">
                      <span className="nb-status-label">Withdraw opens</span>
                      <strong className="nb-status-value">{canWithdraw ? "Now" : epochsToDate(currentEpoch, unlocksInEpochs)}</strong>
                    </div>
                    <div className="nb-status-card">
                      <span className="nb-status-label">Time left</span>
                      <strong className="nb-status-value">{canWithdraw ? "Ready now" : epochsToTime(unlocksInEpochs)}</strong>
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
                    <p className="nb-input-hint">{canWithdraw ? "Your principal can be withdrawn now." : "Unlocks on " + epochsToDate(currentEpoch, unlocksInEpochs) + "."}</p>
                  </div>

                  <button
                    type="button"
                    className="nb-btn-secondary"
                    onClick={handleWithdraw}
                    disabled={isBusy || !canWithdraw}
                    title={canWithdraw ? "Withdraw principal" : "Unlocks at epoch " + unlockEpoch + " (" + epochsToDate(currentEpoch, Math.max(0, unlockEpoch - currentEpoch)) + ")"}
                    aria-disabled={!canWithdraw || isBusy}
                    aria-busy={txStep === "withdrawing"}
                  >
                    {txStep === "withdrawing" ? (
                      <>
                        <span className="nb-spinner" aria-hidden="true" />
                        <span className="nb-sr-only">Withdrawing...</span>
                        Withdrawing...
                      </>
                    ) : canWithdraw
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
            ) : drawReady ? (
              <div className="nb-draw-status-text">
                Timer finished for epoch {nextDrawEpoch}. Anyone can run the draw now.
              </div>
            ) : (
              <div>
                <p className="nb-countdown">{epochsUntilDraw > 0 ? epochsToTime(epochsUntilDraw) : "-"}</p>
                <p className="nb-countdown-label">until the draw can run / epoch {nextDrawEpoch}</p>
              </div>
            )}
          </div>

          <p className="nb-draw-explainer">
            The timer shows when the draw can be run. Entries stay open until someone actually runs it on-chain.
          </p>

          {!isConnected || isWrongNetwork ? (
            <div className="nb-draw-wallet-note">
              <p className="nb-wallet-help-text">
                {!isConnected
                  ? "Connect a wallet to move yield or run the draw."
                  : `Switch to ${NARA_CHAIN_NAME} to move yield or run the draw.`}
              </p>
              <WalletActionButton className="nb-btn-secondary" connectLabel="Connect Wallet" />
            </div>
          ) : (
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
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
              <button
                type="button"
                className="nb-btn-secondary"
                style={{ width: "auto", minWidth: "140px", marginBottom: 0 }}
                onClick={handleHarvest}
                disabled={isBusy}
                title="Move available yield from participant positions into the prize pool"
              >
                {txStep === "harvesting" ? "Moving Yield..." : "Move Yield To Pool"}
              </button>
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
        <span className="nb-trust-pill">Principal Protected</span>
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
