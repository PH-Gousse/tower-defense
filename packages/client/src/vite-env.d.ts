/// <reference types="vite/client" />

/** Build identity injected by vite.config.ts and stamped into desync dumps. */
declare const __BUILD__: string

interface ImportMetaEnv {
  /**
   * Relay origin, e.g. `ws://localhost:8787` when running `wrangler dev`.
   * Unset in production, where the default points at the deployed Worker.
   */
  readonly VITE_RELAY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
