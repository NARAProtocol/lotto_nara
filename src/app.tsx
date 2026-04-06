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
  NARA_TOKEN_ADDRESS,
  NARA_LOTTO_POOL_ADDRESS,
  NARA_ENGINE_ADDRESS,
  tokenAbi,
  lottoPoolAbi,
  engineAbi,
} from "./shared/nara";

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  const raw = collectErrorText(error).toLowerCase();
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
  const first = collectErrorText(error).split("\n")[0];
  return first || `${label} failed. Try again.`;
}

// ── Components ───────────────────────────────────────────────────────────────

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
          return <button type="button" className="nb-wallet-trigger" onClick={openChainModal}>Switch to Base</button>;
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

// ── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const { address, isConnected } = useAccount();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [depositAmount, setDepositAmount] = useState("");
  const [flash, setFlash] = useState<Flash | null>(null);
  const [txStep, setTxStep] = useState<"idle" | "approving" | "depositing" | "withdrawing" | "drawing" | "claiming" | "harvesting">("idle");
  const [drawHistory, setDrawHistory] = useState<DrawRecord[]>([]);
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);

  // ── Contract reads ────────────────────────────────────────────────────────

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

  // Use epochState to get current epoch reliably
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

  // ── Derived values ────────────────────────────────────────────────────────

  const epochStateData = epochStateRead.data as any;
  const currentEpoch = Number(epochStateData?.[0] ?? epochStateData?.epoch ?? 0n);

  const potNara = (potNaraRead.data ?? 0n) as bigint;
  const potEth = (potEthRead.data ?? 0n) as bigint;
  const participantCount = Number((participantCountRead.data ?? 0n) as bigint);
  const lastDrawEpoch = Number((lastDrawEpochRead.data ?? 0n) as bigint);
  const pendingDrawRequestId = (pendingDrawRequestIdRead.data ?? 0n) as bigint;
  const maxParticipants = poolConfig ? Number(poolConfig.maxParticipants ?? 100n) : 100;
  const drawFrequencyEpochs = poolConfig ? Number(poolConfig.drawFrequencyEpochs ?? 0n) : 0;
  const minDepositAmount = poolConfig ? (poolConfig.minDepositAmount as bigint) : 0n;
  const maxDepositAmount = poolConfig ? (poolConfig.maxDepositAmount as bigint) : 0n;

  const pData = participantDataRead.data as any;
  const isParticipant = Boolean(pData?.isActive ?? (pData && pData[4] === true));
  const userWeight = isParticipant ? BigInt(pData?.weight ?? pData?.[3] ?? 0n) : 0n;
  const activationEpoch = isParticipant ? Number(pData?.activationEpoch ?? pData?.[2] ?? 0n) : 0;
  const unlockEpoch = isParticipant ? activationEpoch + Number(lockDurationEpochs) : 0;
  const participantAmount = isParticipant ? BigInt(pData?.weight ?? 0n) : 0n; // weight acts as proxy

  const winningsNara = (winningsNaraRead.data ?? 0n) as bigint;
  const winningsEth = (winningsEthRead.data ?? 0n) as bigint;
  const hasWinnings = winningsNara > 0n || winningsEth > 0n;

  const activeTotalWeight = (activeTotalWeightRead.data ?? 0n) as bigint;
  const userOddsPercent = activeTotalWeight > 0n && userWeight > 0n
    ? Number((userWeight * 10000n) / activeTotalWeight) / 100
    : 0;

  const allowance = (tokenAllowanceRead.data ?? 0n) as bigint;
  const isApproved = amountWei > 0n && allowance >= amountWei;

  const drawReady = pendingDrawRequestId === 0n
    && participantCount > 0
    && drawFrequencyEpochs > 0
    && currentEpoch >= lastDrawEpoch + drawFrequencyEpochs;

  const drawPending = pendingDrawRequestId !== 0n;

  const epochsUntilDraw = drawFrequencyEpochs > 0
    ? Math.max(0, (lastDrawEpoch + drawFrequencyEpochs) - currentEpoch)
    : 0;

  const canDeposit = !isParticipant
    && amountWei >= minDepositAmount
    && (maxDepositAmount === 0n || amountWei <= maxDepositAmount)
    && participantCount < maxParticipants;

  const lockProgressPct = isParticipant && lockDurationEpochs > 0n
    ? Math.min(100, Math.round(((currentEpoch - activationEpoch) / Number(lockDurationEpochs)) * 100))
    : 0;

  const canWithdraw = isParticipant && currentEpoch >= unlockEpoch;

  const previewWeight = (previewWeightRead.data ?? 0n) as bigint;
  const previewOdds = activeTotalWeight > 0n && previewWeight > 0n
    ? Number(((previewWeight) * 10000n) / (activeTotalWeight + previewWeight)) / 100
    : 0;

  // ── Draw history fetch ────────────────────────────────────────────────────

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
      // silently fail — no history to show
    }
  }, [publicClient]);

  // useEffect(() => {
  //   fetchDrawHistory();
  // }, [fetchDrawHistory]);

  // ── Invalidate queries helper ─────────────────────────────────────────────

  const invalidateLotto = useCallback(() => {
    queryClient.invalidateQueries();
  }, [queryClient]);

  // ── Tx handlers ──────────────────────────────────────────────────────────

  const handleApprove = async () => {
    if (!depositAmount || amountWei === 0n) return;
    setTxStep("approving");
    setFlash({ tone: "neutral", text: "Step 1 of 2 — Approving NARA spend. Confirm in your wallet." });
    try {
      await writeContractAsync({
        address: NARA_TOKEN_ADDRESS,
        abi: tokenAbi,
        functionName: "approve",
        args: [NARA_LOTTO_POOL_ADDRESS as `0x${string}`, amountWei],
      });
      setFlash({ tone: "success", text: "NARA approved. You can now lock and enter the draw." });
      invalidateLotto();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Approval", err) });
    } finally {
      setTxStep("idle");
    }
  };

  const handleDeposit = async () => {
    if (!depositAmount || !lockFeeWeiRead.data) return;
    setTxStep("depositing");
    setFlash({ tone: "neutral", text: "Step 2 of 2 — Locking NARA and entering the draw. Confirm in your wallet." });
    try {
      await writeContractAsync({
        address: NARA_LOTTO_POOL_ADDRESS,
        abi: lottoPoolAbi,
        functionName: "deposit",
        args: [amountWei],
        value: lockFeeWeiRead.data as bigint,
      });
      setFlash({ tone: "success", text: "Locked and entered. Good luck this epoch." });
      setDepositAmount("");
      invalidateLotto();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Deposit", err) });
    } finally {
      setTxStep("idle");
    }
  };

  const handleWithdraw = async () => {
    if (!unlockFeeWeiRead.data) return;
    setTxStep("withdrawing");
    setFlash({ tone: "neutral", text: "Withdrawing principal. Confirm in your wallet." });
    try {
      await writeContractAsync({
        address: NARA_LOTTO_POOL_ADDRESS,
        abi: lottoPoolAbi,
        functionName: "withdraw",
        value: unlockFeeWeiRead.data as bigint,
      });
      setFlash({ tone: "success", text: "Withdrawn. Principal returned to your wallet." });
      invalidateLotto();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Withdrawal", err) });
    } finally {
      setTxStep("idle");
    }
  };

  const handleDrawWinner = async () => {
    setTxStep("drawing");
    setFlash({ tone: "neutral", text: "Triggering draw. Chainlink VRF will pick the winner." });
    try {
      await writeContractAsync({
        address: NARA_LOTTO_POOL_ADDRESS,
        abi: lottoPoolAbi,
        functionName: "drawWinner",
      });
      setFlash({ tone: "neutral", text: "Draw triggered. Waiting for Chainlink VRF randomness..." });
      invalidateLotto();
      fetchDrawHistory();
    } catch (err) {
      setFlash({ tone: "error", text: describeTxError("Draw trigger", err) });
    } finally {
      setTxStep("idle");
    }
  };

  const handleClaimWinnings = async () => {
    setTxStep("claiming");
    setFlash({ tone: "neutral", text: "Claiming winnings. Confirm in your wallet." });
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
    setTxStep("harvesting");
    setFlash({ tone: "neutral", text: "Harvesting yield into the pot..." });
    try {
      await writeContractAsync({
        address: NARA_LOTTO_POOL_ADDRESS,
        abi: lottoPoolAbi,
        functionName: "harvestBatch",
        args: [0n, 50n],
      });
      setFlash({ tone: "success", text: "Yield harvested into the pot." });
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
    <a href="#main-content" className="nb-skip-link">Skip to main content</a>
    <main id="main-content">
    <div className="nb-shell">

      {/* ── Hero ── */}
      <header className="nb-hero">
        <div>
          <h1>Lucky Epoch</h1>
          <div className="nb-hero-meta">
            <p className="nb-subtitle">no-loss yield lottery on base — principal always returned</p>
            <div className="nb-epoch-pill">
              <span className="nb-epoch-dot" />
              <span>Epoch</span>
              <span className="nb-epoch-num">{currentEpoch > 0 ? currentEpoch.toLocaleString() : "..."}</span>
            </div>
          </div>
        </div>
        <div className="nb-hero-actions">
          <WalletHeroButton />
        </div>
      </header>

      {/* ── Stats row ── */}
      <section className="nb-stats-grid">
        {/* Pot */}
        <div className="nb-stat-card">
          <p className="nb-stat-label">Current Pot</p>
          <p className="nb-stat-value">{formatNara(potNara)} NARA</p>
          <p className="nb-stat-sub">+ {formatEth(potEth)} ETH</p>
        </div>

        {/* Players */}
        <div className="nb-stat-card">
          <p className="nb-stat-label">Players</p>
          <p className="nb-stat-value">{participantCount} / {maxParticipants}</p>
          <div className="nb-stat-prog-track">
            <div className="nb-stat-prog-fill" style={{ width: `${maxParticipants > 0 ? Math.round((participantCount / maxParticipants) * 100) : 0}%` }} />
          </div>
          <p className="nb-stat-sub">{maxParticipants > 0 ? Math.round((participantCount / maxParticipants) * 100) : 0}% full</p>
        </div>

        {/* Your odds */}
        <div className="nb-stat-card">
          <p className="nb-stat-label">Your Odds</p>
          {isConnected && isParticipant ? (
            <>
              <p className="nb-stat-value">{userOddsPercent.toFixed(2)}%</p>
              <p className="nb-stat-sub">per draw</p>
            </>
          ) : (
            <>
              <p className="nb-stat-value">—</p>
              <p className="nb-stat-sub">{isConnected ? "not in draw" : "connect wallet"}</p>
            </>
          )}
        </div>

        {/* Draw countdown */}
        <div className="nb-stat-card">
          <p className="nb-stat-label">Next Draw</p>
          {drawReady ? (
            <>
              <p className="nb-stat-value draw-ready">Ready</p>
              <p className="nb-stat-sub">anyone can trigger</p>
            </>
          ) : drawPending ? (
            <>
              <p className="nb-stat-value draw-pending">VRF</p>
              <p className="nb-stat-sub">waiting for randomness</p>
            </>
          ) : (
            <>
              <p className="nb-stat-value">{epochsUntilDraw > 0 ? epochsToTime(epochsUntilDraw) : "—"}</p>
              <p className="nb-stat-sub">{epochsUntilDraw} epochs remaining</p>
            </>
          )}
        </div>
      </section>

      {/* ── Flash banner ── */}
      {hasWinnings && (
        <div className="nb-flash winner">
          You won! Claim your prize: {formatNara(winningsNara)} NARA + {formatEth(winningsEth)} ETH
        </div>
      )}
      {!hasWinnings && drawReady && !drawPending && (
        <div className="nb-flash draw-ready">
          Draw is ready. Anyone can trigger it — earn a small keeper reward for doing so.
        </div>
      )}
      {drawPending && (
        <div className="nb-flash neutral">
          Draw in progress — waiting for Chainlink VRF randomness to arrive on-chain.
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

      {/* ── Main 2-col ── */}
      <div className="nb-main-grid">

        {/* ── Deposit Panel ── */}
        <div className="nb-panel">
          <h2 className="nb-panel-header">Enter the Draw</h2>

          <p className="nb-info-text">
            Lock NARA tokens to earn yield. The yield goes into the pot each epoch.
            Chainlink VRF picks a weighted winner. Your principal is always returned at unlock.
          </p>

          {!isConnected ? (
            <ConnectButton.Custom>
              {({ mounted, openConnectModal, authenticationStatus }) => {
                const ready = mounted && authenticationStatus !== "loading";
                return (
                  <button type="button" className="nb-btn-primary" onClick={openConnectModal} disabled={!ready}>
                    Connect to Deposit
                  </button>
                );
              }}
            </ConnectButton.Custom>
          ) : isParticipant ? (
            <div className="nb-inner-card">
              <div style={{ marginBottom: "12px" }}>
                <span className="nb-badge in-draw">In This Draw</span>
              </div>
              <p className="nb-info-text" style={{ marginBottom: 0 }}>
                You are locked in. Yield is accruing and your weight counts toward the draw.
              </p>
            </div>
          ) : (
            <>
              {poolConfig && (
                <div className="nb-inner-card" style={{ marginBottom: "14px" }}>
                  <div className="nb-data-row" style={{ borderTop: "none", paddingTop: 0 }}>
                    <span className="nb-data-label">Min deposit</span>
                    <span className="nb-data-value">{formatNara(minDepositAmount)} NARA</span>
                  </div>
                  {maxDepositAmount > 0n && (
                    <div className="nb-data-row">
                      <span className="nb-data-label">Max deposit</span>
                      <span className="nb-data-value">{formatNara(maxDepositAmount)} NARA</span>
                    </div>
                  )}
                  <div className="nb-data-row">
                    <span className="nb-data-label">Lock duration</span>
                    <span className="nb-data-value">
                      {Number(lockDurationEpochs)} epochs ({epochsToTime(Number(lockDurationEpochs))})
                    </span>
                  </div>
                  <div className="nb-data-row">
                    <span className="nb-data-label">Unlock date</span>
                    <span className="nb-data-value">{epochsToDate(currentEpoch, Number(lockDurationEpochs))}</span>
                  </div>
                  <div className="nb-data-row">
                    <span className="nb-data-label">Spots left</span>
                    <span className="nb-data-value">{maxParticipants - participantCount}</span>
                  </div>
                </div>
              )}

              {txStep === "approving" && (
                <div className="nb-step-indicator">
                  <span className="nb-step-dot" />
                  Step 1 of 2: Approve NARA
                </div>
              )}
              {txStep === "depositing" && (
                <div className="nb-step-indicator">
                  <span className="nb-step-dot" />
                  Step 2 of 2: Lock and Enter
                </div>
              )}

              <div className="nb-input-wrap">
                <label htmlFor="deposit-amount" className="nb-input-label">
                  Amount (NARA)
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
                    Min: {formatNara(minDepositAmount)} NARA{maxDepositAmount > 0n ? ` · Max: ${formatNara(maxDepositAmount)} NARA` : ""}
                  </p>
                )}
              </div>

              {amountWei > 0n && previewWeight > 0n && (
                <div className="nb-preview-card">
                  <p className="nb-panel-header">Entry Preview</p>
                  <div className="nb-data-row" style={{ borderTop: "none", paddingTop: 0 }}>
                    <span className="nb-data-label">Your weight</span>
                    <span className="nb-data-value">{previewWeight.toLocaleString()}</span>
                  </div>
                  <div className="nb-data-row">
                    <span className="nb-data-label">Estimated odds</span>
                    <span className="nb-data-value">{previewOdds.toFixed(2)}%</span>
                  </div>
                  <div className="nb-data-row">
                    <span className="nb-data-label">Unlock date</span>
                    <span className="nb-data-value">{epochsToDate(currentEpoch, Number(lockDurationEpochs))}</span>
                  </div>
                </div>
              )}

              <button
                type="button"
                className="nb-btn-secondary"
                onClick={handleApprove}
                disabled={isBusy || amountWei === 0n || isApproved}
                aria-disabled={!canDeposit || isApproved || isBusy}
                aria-busy={txStep === "approving"}
              >
                {txStep === "approving" ? (
                  <>
                    <span className="nb-spinner" aria-hidden="true" />
                    <span className="nb-sr-only">Approving...</span>
                    Approving...
                  </>
                ) : isApproved ? "NARA Approved" : "Approve NARA"}
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
                    <span className="nb-sr-only">Locking...</span>
                    Locking...
                  </>
                ) : "Lock and Enter Draw"}
              </button>
            </>
          )}
        </div>

        {/* ── My Position ── */}
        <div className="nb-panel">
          <h2 className="nb-panel-header">My Position</h2>

          {!isConnected ? (
            <div className="nb-placeholder">
              <span className="nb-placeholder-icon">◎</span>
              Connect wallet to see your position
            </div>
          ) : (
            <>
              {hasWinnings && (
                <div className="nb-winner-callout">
                  <p className="nb-winner-callout-title">You Won This Draw</p>
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
                  <div style={{ marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <span className="nb-badge in-draw">In Draw</span>
                  </div>

                  <div className="nb-inner-card">
                    <div className="nb-data-row" style={{ borderTop: "none", paddingTop: 0 }}>
                      <span className="nb-data-label">Your weight</span>
                      <span className="nb-data-value">{userWeight.toLocaleString()}</span>
                    </div>
                    <div className="nb-data-row">
                      <span className="nb-data-label">Total pool weight</span>
                      <span className="nb-data-value">{activeTotalWeight.toLocaleString()}</span>
                    </div>
                    <div className="nb-data-row">
                      <span className="nb-data-label">Your odds</span>
                      <span className="nb-data-value">{userOddsPercent.toFixed(2)}%</span>
                    </div>
                    <div className="nb-data-row">
                      <span className="nb-data-label">Activation epoch</span>
                      <span className="nb-data-value">{activationEpoch}</span>
                    </div>
                    <div className="nb-data-row">
                      <span className="nb-data-label">Unlock epoch</span>
                      <span className="nb-data-value">{unlockEpoch} ({epochsToDate(currentEpoch, Math.max(0, unlockEpoch - currentEpoch))})</span>
                    </div>
                  </div>

                  <div style={{ margin: "14px 0 4px" }}>
                    <p className="nb-input-label" style={{ marginBottom: "4px" }}>Lock progress</p>
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
                    <p className="nb-input-hint">{lockProgressPct}% through lock period</p>
                  </div>

                  <button
                    type="button"
                    className="nb-btn-secondary"
                    onClick={handleWithdraw}
                    disabled={isBusy || !canWithdraw}
                    title={canWithdraw ? "Withdraw principal" : `Unlocks at epoch ${unlockEpoch} (${epochsToDate(currentEpoch, Math.max(0, unlockEpoch - currentEpoch))})`}
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
                        ? "Withdraw Principal"
                        : `Locked until epoch ${unlockEpoch}`}
                  </button>
                </>
              ) : (
                <div className="nb-placeholder">
                  <span className="nb-placeholder-icon">◇</span>
                  <span className="nb-badge not-in-draw">Not in Draw</span>
                  Deposit to enter the current draw and earn yield
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Draw Section ── */}
      <div className="nb-draw-section">
        <h2 className="nb-panel-header">Draw</h2>

        <div className="nb-draw-trigger-row">
          <div>
            {drawPending ? (
              <div className="nb-draw-status-text">
                <span className="nb-spinner" />
                Waiting for Chainlink VRF randomness...
              </div>
            ) : drawReady ? (
              <div className="nb-draw-status-text">
                Draw is ready for epoch {lastDrawEpoch + drawFrequencyEpochs}. Anyone can trigger.
              </div>
            ) : (
              <div>
                <p className="nb-countdown">{epochsUntilDraw > 0 ? epochsToTime(epochsUntilDraw) : "—"}</p>
                <p className="nb-countdown-label">until next draw · epoch {lastDrawEpoch + drawFrequencyEpochs}</p>
              </div>
            )}
          </div>

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
                ) : "Trigger Draw Winner"}
              </button>
            )}
            <button
              type="button"
              className="nb-btn-secondary"
              style={{ width: "auto", minWidth: "140px", marginBottom: 0 }}
              onClick={handleHarvest}
              disabled={isBusy}
              title="Harvest accumulated yield from all participant positions into the pot"
            >
              {txStep === "harvesting" ? "Harvesting..." : "Harvest Yield"}
            </button>
          </div>
        </div>

        {/* Draw history */}
        <h2 className="nb-panel-header" style={{ marginBottom: "12px" }}>Recent Draws</h2>
        {drawHistory.length === 0 ? (
          <div className="nb-placeholder" style={{ padding: "24px 20px" }}>
            No draws yet. Be the first winner.
          </div>
        ) : (
          <div className="nb-table-wrap">
            <table className="nb-table" aria-label="Draw history">
              <thead>
                <tr>
                  <th>Winner</th>
                  <th>Pot NARA</th>
                  <th>Pot ETH</th>
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
                        {copiedAddr === rec.winner ? "✓" : "Copy"}
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
                          View →
                        </a>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Trust bar ── */}
      <div className="nb-trust-bar">
        <a
          href={`https://basescan.org/address/${NARA_LOTTO_POOL_ADDRESS}`}
          target="_blank"
          rel="noopener noreferrer"
          className="nb-trust-pill"
        >
          LottoPool Contract
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
          href="https://github.com/ruvnet/claude-flow"
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
