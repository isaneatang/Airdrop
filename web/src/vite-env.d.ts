/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_PAYMENT_STREAM?: string;
  readonly VITE_AIRDROP?: string;
  readonly VITE_DEPLOY_BLOCK?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
