/**
 * What the desktop app and the page say to each other. The page's copy of
 * these types is web/src/lib/desktopBridge.ts; keep the two in step.
 */

export interface RpcActivity {
  application_id: string;
  name?: string;
  type: 0 | 2 | 3 | 5;
  status_display_type?: 0 | 1 | 2;
  details?: string;
  details_url?: string;
  state?: string;
  state_url?: string;
  timestamps?: { start?: number; end?: number };
  assets?: { large_image?: string; large_text?: string; large_url?: string; small_image?: string; small_text?: string; small_url?: string };
  party?: { id?: string; size?: [number, number] };
  buttons?: { label: string; url: string }[];
  instance?: boolean;
}

export interface RpcApp {
  clientId: string;
  name: string | null;
  activity: RpcActivity | null;
  hidden: boolean;
  connectedAt: number;
}

export interface RpcState {
  enabled: boolean;
  relay: boolean;
  listening: { ipc: string | null; ws: number | null };
  discord: "connected" | "absent" | "first";
  apps: RpcApp[];
}

export interface UpdateState {
  status: "idle" | "checking" | "downloading" | "ready" | "manual" | "error";
  version?: string;
  progress?: number;
  downloadUrl?: string;
  error?: string;
  lastCheck?: number;
}

export interface DesktopSettings {
  launchAtLogin: boolean;
  startMinimized: boolean;
  closeToTray: boolean;
  hardwareAcceleration: boolean;
}

export interface DisplaySource {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnail: string;
  icon?: string;
}

export interface DisplaySourceRequest {
  requestId: string;
  sources: DisplaySource[];
  audio: boolean;
}

/** Where the app's window is, as its own window system says: a page's own idea of focus is not reliable here. */
export interface WindowState {
  focused: boolean;
  visible: boolean;
  minimized: boolean;
}

export interface Identity {
  id: string;
  username: string;
  global_name: string;
  avatar: string | null;
}

/** IPC channel names between the preload script and the main process. */
export const IPC = {
  rpcGetState: "rpc:get-state",
  rpcSetEnabled: "rpc:set-enabled",
  rpcSetRelay: "rpc:set-relay",
  rpcSetHidden: "rpc:set-hidden",
  rpcRestartDiscord: "rpc:restart-discord",
  rpcState: "rpc:state",
  activities: "rpc:activities",
  setIdentity: "app:set-identity",
  updateGetState: "update:get-state",
  updateCheck: "update:check",
  updateRestart: "update:restart",
  updateState: "update:state",
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  setBadge: "app:set-badge",
  setCallActive: "app:set-call-active",
  displaySources: "display:sources",
  displayChoose: "display:choose",
  trayAction: "tray:action",
  focusWindow: "app:focus-window",
  requestAttention: "app:request-attention",
  windowGetState: "app:get-window-state",
  shareAudioFailed: "display:share-audio-failed",
  windowState: "app:window-state",
} as const;
