import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { base } from "wagmi/chains";
import { http } from "viem";

import App from "./app";

import "@rainbow-me/rainbowkit/styles.css";
import "./styles.css";

const projectId =
  import.meta.env.VITE_RAINBOW_PROJECT_ID ||
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ||
  "eaa83acd221c02c828da866941dbacf4";

const rpcUrl = import.meta.env.VITE_BASE_RPC_URL || "https://mainnet.base.org";

const config = getDefaultConfig({
  appName: "NARA Lucky Epoch",
  projectId,
  chains: [base],
  transports: {
    [base.id]: http(rpcUrl),
  },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 15_000,
      staleTime: 10_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <App />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
