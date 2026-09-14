/**
 * The desktop app's side of the page: what its preload script puts on
 * `window.evilionDesktop`. In a browser there is none, and everything that
 * depends on it stays out of the way.
 *
 * desktop/src/preload/index.ts implements this; keep the two in step.
 */

/** A Rich Presence activity as a program sent it to the desktop app, cleaned there. */
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

/** One program connected to the desktop app's Rich Presence server. */
export interface RpcApp {
  clientId: string;
  /** The program's own name for itself, once Discord's directory has been asked. */
  name: string | null;
  activity: RpcActivity | null;
  /** Hidden by the user: kept off their profile. */
  hidden: boolean;
  connectedAt: number;
}

export interface RpcState {
  /** The Rich Presence server is on. */
  enabled: boolean;
  /** Programs also reach Discord through us when it is running. */
  relay: boolean;
  /** Where programs find us: a pipe or socket path, and the WebSocket port. */
  listening: { ipc: string | null; ws: number | null };
  /**
   * connected: Discord runs and gets everything too; absent: Discord is not
   * running, so activity shows only here; first: Discord started first and
   * holds the pipe programs try first (Windows), so programs talk only to it.
   */
  discord: "connected" | "absent" | "first";
  apps: RpcApp[];
}

export interface UpdateState {
  status: "idle" | "checking" | "downloading" | "ready" | "manual" | "error";
  /** The version found, when there is one. */
  version?: string;
  /** 0–1 while downloading. */
  progress?: number;
  /** A package format that cannot update itself (.deb): where to download the new one. */
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
  /** data: URL of a small thumbnail. */
  thumbnail: string;
  /** data: URL of the window's app icon, when there is one. */
  icon?: string;
}

export interface DisplaySourceRequest {
  requestId: string;
  sources: DisplaySource[];
  /** The system can capture sound along with the picture (Windows). */
  audio: boolean;
}

export interface EvilionDesktop {
  version: string;
  platform: "win32" | "darwin" | "linux";
  rpc: {
    getState(): Promise<RpcState>;
    setEnabled(on: boolean): Promise<void>;
    setRelay(on: boolean): Promise<void>;
    setHidden(clientId: string, hidden: boolean): Promise<void>;
    /** Windows only: quits and reopens Discord so that we hold the first pipe. */
    restartDiscord(): Promise<boolean>;
    onState(cb: (state: RpcState) => void): () => void;
  };
  /** The activities to show, newest first, hidden programs left out. */
  onActivities(cb: (list: RpcActivity[]) => void): () => void;
  /** Who is signed in, so programs that ask get this user rather than nobody. */
  setIdentity(user: { id: string; username: string; global_name: string; avatar: string | null } | null): void;
  updates: {
    getState(): Promise<UpdateState>;
    check(): Promise<void>;
    restart(): Promise<void>;
    onState(cb: (state: UpdateState) => void): () => void;
  };
  settings: {
    get(): Promise<DesktopSettings>;
    set(patch: Partial<DesktopSettings>): Promise<DesktopSettings>;
  };
  setBadge(count: number): void;
  setCallActive(active: boolean): void;
  onDisplaySources(cb: (req: DisplaySourceRequest) => void): () => void;
  /** Answers a display source request; a null source cancels the share. */
  chooseDisplaySource(requestId: string, sourceId: string | null, withAudio: boolean): void;
  /** Mute or Deafen chosen from the tray icon. */
  onTrayAction(cb: (action: "mute" | "deafen") => void): () => void;
}

export function desktopBridge(): EvilionDesktop | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { evilionDesktop?: EvilionDesktop }).evilionDesktop ?? null;
}
