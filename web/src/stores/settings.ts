import { create } from "zustand";
import type { FavoriteGif } from "@/lib/gifFavorites";
import { users as usersApi } from "@/api/users";
import { ApiError } from "@/api/client";
import { decryptSettings, encryptSettings } from "@/lib/settingsCrypto";
import { fromStreamQuality } from "@/voice/shareQuality";

export type Theme = "dark" | "light" | "ash" | "onyx" | "system";
export type NotificationLevel = "all" | "mentions" | "none";
export type ShareResolution = "720p" | "1080p" | "1440p" | "source";
export type ShareFps = 15 | 30 | 60;

export interface VoiceSettings {
  inputDeviceId: string | null;
  /** The chosen microphone's name, so it can be found again when its id changes. */
  inputDeviceLabel: string | null;
  outputDeviceId: string | null;
  outputDeviceLabel: string | null;
  /** The chosen camera, found again by name when its id changes; null lets the browser pick. */
  cameraDeviceId: string | null;
  cameraDeviceLabel: string | null;
  inputVolume: number;
  outputVolume: number;
  mode: "vad" | "ptt";
  pttKey: string;
  sensitivity: number;
  autoSensitivity: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGain: boolean;
  /** Screen share size and frame rate; the share dialog starts from the last ones used. */
  shareResolution: ShareResolution;
  shareFps: ShareFps;
  /** Whether a screen share carries what the computer plays. */
  shareAudio: boolean;
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
  /** BCP 47 tag, or null to follow the browser. Travels with the account. */
  locale: string | null;
  /** Underline misspelled words while typing, with suggestions on a right click. */
  spellcheck: boolean;
  linkPreviews: boolean;
  imagePreviews: boolean;
  developerMode: boolean;
  /** Show what the desktop app hears from games and music (Rich Presence) to others. */
  shareActivity: boolean;
  sidebarWidth: number;
  showMembers: boolean;
  recentEmoji: string[];
  favoriteGifs: FavoriteGif[];
  skinTone: number;
  /**
   * desktop: notifications in a browser, which has to be allowed first.
   * app: notifications in the desktop app, on unless turned off.
   */
  notifications: { desktop: boolean; app: boolean; sounds: boolean; perChannel: Record<string, NotificationLevel>; muted: string[] };
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
  locale: null,
  spellcheck: true,
  linkPreviews: true,
  imagePreviews: true,
  developerMode: false,
  shareActivity: true,
  sidebarWidth: 240,
  showMembers: true,
  recentEmoji: [],
  favoriteGifs: [],
  skinTone: 0,
  notifications: { desktop: false, app: true, sounds: true, perChannel: {}, muted: [] },
  drafts: {},
  voice: {
    inputDeviceId: null,
    inputDeviceLabel: null,
    outputDeviceId: null,
    cameraDeviceId: null,
    cameraDeviceLabel: null,
    outputDeviceLabel: null,
    inputVolume: 100,
    outputVolume: 100,
    mode: "vad",
    pttKey: "`",
    sensitivity: -50,
    autoSensitivity: true,
    noiseSuppression: true,
    echoCancellation: true,
    autoGain: true,
    shareResolution: "1080p",
    shareFps: 30,
    shareAudio: true,
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
    voice: mergeVoice(base.voice, inc.voice),
  };
}

/**
 * This device's unsaved changes, laid over the copy that just arrived.
 *
 * `perChannel` is a map and `muted` a list, and both live inside the one
 * `notifications` object, so a plain merge lets whichever side carries that
 * object throw away everything the other side put in them — and this device
 * then saves the result. They are merged entry by entry instead: what was
 * changed here wins, what was never touched here is kept.
 */
export function layerUnsaved(base: Settings, unsaved: Partial<Settings>): Settings {
  const merged = mergeSettings(base, unsaved);
  const mine = unsaved.notifications;
  if (!mine) return merged;
  merged.notifications = {
    ...merged.notifications,
    perChannel: { ...base.notifications.perChannel, ...mine.perChannel },
    muted: [...new Set([...base.notifications.muted, ...mine.muted])],
  };
  return merged;
}

const isAlias = (id: string | null | undefined) => id === "default" || id === "communications";

/** Merges voice settings, turning the one "stream quality" older versions saved into a size and frame rate. */
function mergeVoice(base: VoiceSettings, incoming: Partial<VoiceSettings> | undefined): VoiceSettings {
  const { streamQuality, ...rest } = (incoming ?? {}) as Partial<VoiceSettings> & { streamQuality?: unknown };
  const old = rest.shareResolution ? null : fromStreamQuality(streamQuality);
  const voice = { ...base, ...rest, ...(old ?? {}) };
  delete (voice as { streamQuality?: unknown }).streamQuality;
  // Chromium's "default" and "communications" entries are no longer offered, so one saved earlier means the system's own device
  if (isAlias(voice.inputDeviceId)) Object.assign(voice, { inputDeviceId: null, inputDeviceLabel: null });
  if (isAlias(voice.outputDeviceId)) Object.assign(voice, { outputDeviceId: null, outputDeviceLabel: null });
  if (isAlias(voice.cameraDeviceId)) Object.assign(voice, { cameraDeviceId: null, cameraDeviceLabel: null });
  return voice;
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
  /** Saves now; resolves false when changes made here have not reached the server. */
  flush: () => Promise<boolean>;
  reset: () => void;
}

/** Two batches of changes as one, the later winning, nested groups merged the way patch merges them. */
function mergeChanges(a: Partial<Settings> | null, b: Partial<Settings> | null): Partial<Settings> | null {
  if (!a || !b) return a ?? b;
  const out: Partial<Settings> = { ...a, ...b };
  if (a.notifications && b.notifications) out.notifications = { ...a.notifications, ...b.notifications };
  if (a.voice && b.voice) out.voice = { ...a.voice, ...b.voice };
  return out;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;

// What this device changed and the server does not have yet: `dirty` waits
// for the next save, `sending` is in the save under way. Only these are laid
// over the server's copy when it is loaded, so a save that crosses another
// device's (or its own echo) keeps both sides instead of one erasing the other.
let dirty: Partial<Settings> | null = null;
let sending: Partial<Settings> | null = null;
let inflight: Promise<boolean> | null = null;
let again = false;
/** Bumped on reset, so a save from the account before it cannot land on the next one. */
let generation = 0;

/** Whether a failed save is worth trying again later: the network or the server, not the request. */
function retryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  return err.status === 0 || err.status === 429 || err.status >= 500;
}

export const useSettings = create<SettingsState>()((set, get) => {
  const scheduleRetry = (): void => {
    if (retryTimer) return;
    const delay = Math.min(60_000, 2000 * 2 ** failures);
    failures += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void get().flush();
    }, delay);
  };

  /** One save of everything changed so far; reports whether it should run again straight away. */
  const saveOnce = async (): Promise<boolean> => {
    const { key, settings, version, loaded } = get();
    // Before the account's settings arrive, the local copy is defaults plus
    // these changes; saving that would overwrite everything. load saves them.
    if (!key || !loaded || !dirty) return false;
    const gen = generation;
    sending = dirty;
    dirty = null;
    try {
      const blob = await encryptSettings(key, settings);
      const res = await usersApi.putSettings(blob, version);
      if (gen !== generation) return false;
      sending = null;
      failures = 0;
      set({ version: res.version });
      return false;
    } catch (err) {
      if (gen !== generation) return false;
      dirty = mergeChanges(sending, dirty);
      sending = null;
      if (err instanceof ApiError && err.status === 409 && failures < 3) {
        // someone else saved first: take theirs, put ours back on top, try again
        failures += 1;
        try {
          await get().reload();
          return gen === generation;
        } catch {
          scheduleRetry();
          return false;
        }
      }
      if (retryable(err) || (err instanceof ApiError && err.status === 409)) scheduleRetry();
      return false;
    }
  };

  return {
    settings: DEFAULT_SETTINGS,
    version: 0,
    loaded: false,
    key: null,
    saving: false,
    setKey: (key) => set({ key }),
    load: async (blob, version) => {
      const key = get().key;
      const doc = blob && key ? await decryptSettings(key, blob) : null;
      // a save of ours may have landed while this copy was on its way
      if (get().loaded && version < get().version) return;
      const base = doc ? mergeSettings(DEFAULT_SETTINGS, doc) : DEFAULT_SETTINGS;
      const unsaved = mergeChanges(sending, dirty);
      set({ settings: unsaved ? layerUnsaved(base, unsaved) : base, version, loaded: true });
      if (dirty) void get().flush();
    },
    reload: async () => {
      const res = await usersApi.getSettings();
      await get().load(res?.blob ?? null, res?.version ?? 0);
    },
    patch: (partial) => {
      set((s) => ({ settings: mergeSettings(s.settings, partial) }));
      dirty = mergeChanges(dirty, partial);
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
    flush: () => {
      // A save already under way takes these changes along when it finishes,
      // and whoever waits on this waits for that too.
      if (inflight) {
        again = true;
        return inflight;
      }
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      const gen = generation;
      set({ saving: true });
      const run = (async (): Promise<boolean> => {
        try {
          do {
            again = false;
            if (await saveOnce()) again = true;
          } while (again && gen === generation);
          // Callers such as the passcode need to know their change really
          // reached the server: it did when nothing made here is still waiting.
          return gen === generation && !dirty && !sending;
        } catch {
          return false;
        } finally {
          if (gen === generation) {
            inflight = null;
            set({ saving: false });
          }
        }
      })();
      inflight = run;
      return run;
    },
    reset: () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      generation += 1;
      dirty = null;
      sending = null;
      inflight = null;
      again = false;
      failures = 0;
      set({ settings: DEFAULT_SETTINGS, version: 0, loaded: false, key: null, saving: false });
    },
  };
});
