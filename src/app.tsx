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

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ Components â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ Main App â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function App() {
  const { address, chainId, isConnected } = useAccount();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [depositAmount, setDepositAmount] = useState("");
  const [flash, setFlash] = useState<Flash | null>(null);
  const [txStep, setTxStep] = useState<"idle" | "approving" | "depositing" | "withdrawing" | "drawing" | "claiming" | "harvesting">("idle");
  const [drawHistory, setDrawHistory] = useState<DrawRecord[]>([]);
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);

  const isWrongNetwork = Boolean(isConnected && chainId != null && chainId !== NARA_CHAIN_ID);

  // â”€â”€ Contract reads â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  // â”€â”€ Derived values â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  const nextDrawEpoch = drawFrequencyEpochs > 0 ? lastDrawEpoch + drawFrequencyEpochs : 0;

  const epochsUntilDraw = drawFrequencyEpochs > 0
    ? Math.max(0, nextDrawEpoch - currentEpoch)
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

  // â”€â”€ Draw history fetch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
      // silently fail â€” no history to show
    }
  }, [publicClient]);

  useEffect(() => {
    void fetchDrawHistory();
  }, [fetchDrawHistory]);

  // â”€â”€ Invalidate queries helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  // â”€â”€ Tx handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const handleApprove = async () => {
    if (!ensureWalletReady("approve NARA") || !depositAmount || amountWei === 0n) return;
    setTxStep("approving");
    setFlash({ tone: "neutral", text: "Step 1 of 2 â€” Approving NARA spend. Confirm in your wallet." });
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
    if (!ensureWalletReady("enter the draw") || !depositAmount || !lockFeeWeiRead.data) return;
    setTxStep("depositing");
    setFlash({ tone: "neutral", text: "Step 2 of 2 â€” Locking NARA and entering the draw. Confirm in your wallet." });
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
    if (!ensureWalletReady("withdraw principal") || !unlockFeeWeiRead.data) return;
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
    if (!ensureWalletReady("trigger the draw")) return;
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
    if (!ensureWalletReady("claim winnings")) return;
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
    if (!ensureWalletReady("harvest yield")) return;
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

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  return (
    <>
    <a href="#main-content" className="nb-skip-link">Skip to main content</a>
    <main id="main-content">
    <div className="nb-shell">

      {/* â”€â”€ Hero â”€â”€ */}
      <header className="nb-hero">
        <div>
          <h1>Lucky Epoch</h1>
          <div className="nb-hero-meta">
            <p className="nb-subtitle">no-loss yield lottery on base â€” principal always returned</p>
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

      {/* â”€â”€ Stats row â”€â”€ */}
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
          {isConnected && !isWrongNetwork && isParticipant ? (
            <>
              <p className="nb-stat-value">{userOddsPercent.toFixed(2)}%</p>
              <p className="nb-stat-sub">per draw</p>
            </>
          ) : (
            <>
              <p className="nb-stat-value">â€”</p>
              <p className="nb-stat-sub">{!isConnected ? "connect wallet" : isWrongNetwork ? `switch to ${NARA_CHAIN_NAME}` : "not in draw"}</p>
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
              <p className="nb-stat-value">{epochsUntilDraw > 0 ? epochsToTime(epochsUntilDraw) : "â€”"}</p>
              <p className="nb-stat-sub">{epochsUntilDraw} epochs remaining</p>
            </>
          )}
        </div>
      </section>

      {/* â”€â”€ Flash banner â”€â”€ */}
      {hasWinnings && (
        <div className="nb-flash winner">
          You won! Claim your prize: {formatNara(winningsNara)} NARA + {formatEth(winningsEth)} ETH
        </div>
      )}
      {!hasWinnings && drawReady && !drawPending && (
        <div className="nb-flash draw-ready">
          Draw is ready. Anyone can trigger it â€” earn a small keeper reward for doing so.
        </div>
      )}
      {drawPending && (
        <div className="nb-flash neutral">
          Draw in progress â€” waiting for Chainlink VRF randomness to arrive on-chain.
        </div>
      )}
      {isWrongNetwork && (
        <div className="nb-flash error">
          Your wallet is connected to the wrong network. Switch to {NARA_CHAIN_NAME} before approving, depositing, harvesting, drawing, claiming, or withdrawing.
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

      {/* â”€â”€ Main 2-col â”€â”€ */}
      <div className="nb-main-grid">

        {/* â”€â”€ Deposit Panel â”€â”€ */}
        <div className="nb-panel">
          <h2 className="nb-panel-header">Enter the Draw</h2>

          <p className="nb-info-text">
            Lock NARA tokens to earn yield. The yield goes into the pot each epoch.
            Chainlink VRF picks a weighted winner. Your principal is always returned at unlock.
          </p>

          {!isConnected ? (
            <WalletSetupCard
              title="Connect a wallet to enter"
              body="MetaMask, Rabby, Coinbase Wallet, and WalletConnect are supported. Unlock your wallet first if the popup does not appear."
              connectLabel="Connect Wallet"
            />
          ) : isWrongNetwork ? (
            <WalletSetupCard
              title={`Switch to ${NARA_CHAIN_NAME} to continue`}
              body={`Approvals, deposits, withdrawals, draw triggers, harvests, and prize claims only settle on ${NARA_CHAIN_NAME} mainnet.`}
            />
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
                    Min: {formatNara(minDepositAmount)} NARA{maxDepositAmount > 0n ? ` Â· Max: ${formatNara(maxDepositAmount)} NARA` : ""}
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

              <p className="nb-wallet-action-note">
                Approve NARA once, then confirm the deposit transaction in your wallet on {NARA_CHAIN_NAME}.
              </p>

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

        {/* â”€â”€ My Position â”€â”€ */}
        <div className="nb-panel">
          <h2 className="nb-panel-header">My Position</h2>

          {!isConnected ? (
            <WalletSetupCard
              title="Connect the wallet that joined the draw"
              body="Your odds, unlock timing, and any claimable prizes load only after the right wallet is connected."
              connectLabel="Connect Wallet"
            />
          ) : isWrongNetwork ? (
            <WalletSetupCard
              title={`Switch to ${NARA_CHAIN_NAME} to load your position`}
              body={`Reconnect on ${NARA_CHAIN_NAME} to view your live odds, unlock date, and any claimable winnings.`}
            />
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
                  <span className="nb-placeholder-icon">â—‡</span>
                  <span className="nb-badge not-in-draw">Not in Draw</span>
                  Deposit to enter the current draw and earn yield
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* â”€â”€ Draw Section â”€â”€ */}
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
                Draw is ready for epoch {nextDrawEpoch}. Anyone can trigger.
              </div>
            ) : (
              <div>
                <p className="nb-countdown">{epochsUntilDraw > 0 ? epochsToTime(epochsUntilDraw) : "â€”"}</p>
                <p className="nb-countdown-label">until next draw · epoch {nextDrawEpoch}</p>
              </div>
            )}
          </div>

          {!isConnected || isWrongNetwork ? (
            <div className="nb-draw-wallet-note">
              <p className="nb-wallet-help-text">
                {!isConnected
                  ? "Connect a wallet to harvest yield or trigger the next draw."
                  : `Switch to ${NARA_CHAIN_NAME} to harvest yield or trigger the next draw.`}
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
          )}
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
                        {copiedAddr === rec.winner ? "âœ“" : "Copy"}
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
                          View â†’
                        </a>
                      ) : "â€”"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* â”€â”€ Trust bar â”€â”€ */}
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
          href="https://github.com/leonardDEV21/lotto-game"
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

