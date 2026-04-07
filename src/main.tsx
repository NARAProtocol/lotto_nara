import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { WagmiProvider, http } from "wagmi";
import { base } from "wagmi/chains";

import App from "./app";

import "@rainbow-me/rainbowkit/styles.css";
import "./styles.css";

const projectId =
  import.meta.env.VITE_RAINBOW_PROJECT_ID ||
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ||
  "00000000000000000000000000000000";

const baseRpcUrl = import.meta.env.VITE_BASE_RPC_URL || undefined;

const config = getDefaultConfig({
  appName: "NARA Lucky Epoch",
  projectId,
  chains: [base],
  transports: {
    [base.id]: http(baseRpcUrl),
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
