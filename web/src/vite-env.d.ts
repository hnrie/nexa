/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" in a build for trying seasonal themes out: every one in season every day (lib/look/seasonal.ts). */
  readonly VITE_ALL_SEASONS?: string;
}
declare const __BUILD_ID__: string;
