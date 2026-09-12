import { create } from "zustand";
import { users as usersApi } from "@/api/users";
import { ApiError } from "@/api/client";
import { decryptSettings, encryptSettings } from "@/lib/settingsCrypto";

export type Theme = "dark" | "light" | "ash" | "onyx" | "system";
export type NotificationLevel = "all" | "mentions" | "none";

export interface VoiceSettings {
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  inputVolume: number;
  outputVolume: number;
  mode: "vad" | "ptt";
  pttKey: string;
  sensitivity: number;
  autoSensitivity: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGain: boolean;
  streamQuality: "720p30" | "1080p30" | "1080p60" | "source";
}

/**
 * The passcode policy, kept with the account so every device asks for it.
 * The wrapped key itself never leaves the device that made it; the verifier
 * is only enough to check a passcode, not to derive anything from it.
 */
export interface AppLockPolicy {
  /** base64 argon2 salt. */
  salt: string;
  params: { m: number; t: number; p: number; v: 1 };
  /** base64 of a value derived from the passcode key, for checking it. */
  verifier: string;
  autoLockMs: number;
  lockOnBlur: boolean;
  blurDelayMs: number;
}

export interface Settings {
  theme: Theme;
  accent: string | null;
  fontScale: number;
  messageDisplay: "cozy" | "compact";
  reducedMotion: boolean;
  underlineLinks: boolean;
  linkPreviews: boolean;
  imagePreviews: boolean;
  developerMode: boolean;
  sidebarWidth: number;
  showMembers: boolean;
  recentEmoji: string[];
  favoriteGifs: { url: string; w?: number; h?: number }[];
  skinTone: number;
  notifications: { desktop: boolean; sounds: boolean; perChannel: Record<string, NotificationLevel>; muted: string[] };
  drafts: Record<string, string>;
  voice: VoiceSettings;
  serverPositions: string[];
  collapsedCategories: string[];
  userNotes: Record<string, string>;
  appLock: AppLockPolicy | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  accent: null,
  fontScale: 1,
  messageDisplay: "cozy",
  reducedMotion: false,
  underlineLinks: false,
  linkPreviews: true,
  imagePreviews: true,
  developerMode: false,
  sidebarWidth: 240,
  showMembers: true,
  recentEmoji: [],
  favoriteGifs: [],
  skinTone: 0,
  notifications: { desktop: false, sounds: true, perChannel: {}, muted: [] },
  drafts: {},
  voice: {
    inputDeviceId: null,
    outputDeviceId: null,
    inputVolume: 100,
    outputVolume: 100,
    mode: "vad",
    pttKey: "`",
    sensitivity: -50,
    autoSensitivity: true,
    noiseSuppression: true,
    echoCancellation: true,
    autoGain: true,
    streamQuality: "1080p30",
  },
  serverPositions: [],
  collapsedCategories: [],
  userNotes: {},
  appLock: null,
};

function mergeSettings(base: Settings, incoming: unknown): Settings {
  if (typeof incoming !== "object" || incoming === null) return base;
  const inc = incoming as Partial<Settings>;
  return {
    ...base,
    ...inc,
    notifications: { ...base.notifications, ...(inc.notifications ?? {}) },
    voice: { ...base.voice, ...(inc.voice ?? {}) },
  };
}

interface SettingsState {
  settings: Settings;
  version: number;
  loaded: boolean;
  key: Uint8Array | null;
  saving: boolean;
  setKey: (key: Uint8Array | null) => void;
  load: (blob: string | null, version: number) => Promise<void>;
  reload: () => Promise<void>;
  patch: (partial: Partial<Settings>) => void;
  setDraft: (channelId: string, text: string) => void;
  flush: () => Promise<void>;
  reset: () => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useSettings = create<SettingsState>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  version: 0,
  loaded: false,
  key: null,
  saving: false,
  setKey: (key) => set({ key }),
  load: async (blob, version) => {
    const key = get().key;
    if (!blob || !key) {
      set({ settings: DEFAULT_SETTINGS, version, loaded: true });
      return;
    }
    const doc = await decryptSettings(key, blob);
    set({ settings: mergeSettings(DEFAULT_SETTINGS, doc), version, loaded: true });
  },
  reload: async () => {
    const res = await usersApi.getSettings();
    await get().load(res?.blob ?? null, res?.version ?? 0);
  },
  patch: (partial) => {
    set((s) => ({ settings: mergeSettings(s.settings, partial) }));
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void get().flush();
    }, 800);
  },
  setDraft: (channelId, text) => {
    const drafts = { ...get().settings.drafts };
    if (text) drafts[channelId] = text;
    else delete drafts[channelId];
    get().patch({ drafts });
  },
  flush: async () => {
    const { key, settings, version, saving } = get();
    if (!key || saving) return;
    set({ saving: true });
    try {
      const blob = await encryptSettings(key, settings);
      const res = await usersApi.putSettings(blob, version);
      set({ version: res.version });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const local = get().settings;
        await get().reload();
        set((s) => ({ settings: mergeSettings(s.settings, local) }));
        set({ saving: false });
        void get().flush();
        return;
      }
    } finally {
      set({ saving: false });
    }
  },
  reset: () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    set({ settings: DEFAULT_SETTINGS, version: 0, loaded: false, key: null, saving: false });
  },
}));
