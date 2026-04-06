/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_BASE_RPC_URL?: string;
  readonly VITE_EXCLUDED_WALLETS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
