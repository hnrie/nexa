import { create } from "zustand";
import type { VoiceState } from "@/api/types";
import { storage } from "@/lib/storage";

export type PeerState = RTCPeerConnectionState | "new";

export interface RemoteMedia {
  audio: MediaStream | null;
  video: MediaStream | null;
  screen: MediaStream | null;
}

const EMPTY_MEDIA: RemoteMedia = { audio: null, video: null, screen: null };

interface VoiceStore {
  /** Everyone's voice state, by channel then user. */
  byChannel: Record<string, Record<string, VoiceState>>;
  /** My state as the server acknowledged it (null when not in voice). */
  mine: VoiceState | null;
  /** The channel we are connecting to, before the server confirms. */
  joining: string | null;
  peers: Record<string, PeerState>;
  remote: Record<string, RemoteMedia>;
  localVideo: MediaStream | null;
  localScreen: MediaStream | null;
  speaking: Record<string, boolean>;
  /** My input level 0..1, for the settings meter. */
  level: number;
  /** Per-user playback volume, 0–200 (percent). Persisted locally. */
  volumes: Record<string, number>;
  /** Users muted locally (only for me). */
  localMutes: Record<string, boolean>;
  /** Incoming DM calls, by channel. */
  ringing: Record<string, { from: string; at: number }>;
  /** A tile pinned to the focused layout: "user:video" or "user:screen". */
  focused: string | null;
  error: string | null;
  applyState: (vs: VoiceState) => void;
  setAll: (list: VoiceState[]) => void;
  setMine: (vs: VoiceState | null) => void;
  setJoining: (id: string | null) => void;
  setPeer: (userId: string, state: PeerState) => void;
  removePeer: (userId: string) => void;
  setRemote: (userId: string, kind: keyof RemoteMedia, stream: MediaStream | null) => void;
  setLocalVideo: (s: MediaStream | null) => void;
  setLocalScreen: (s: MediaStream | null) => void;
  setSpeaking: (userId: string, on: boolean) => void;
  setLevel: (n: number) => void;
  setVolume: (userId: string, pct: number) => void;
  setLocalMute: (userId: string, on: boolean) => void;
  setRinging: (channelId: string, from: string | null) => void;
  setFocused: (key: string | null) => void;
  setError: (e: string | null) => void;
  resetSession: () => void;
  clear: () => void;
}

function loadVolumes(): Record<string, number> {
  try {
    const raw = storage.get("voiceVolumes");
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export const useVoice = create<VoiceStore>()((set) => ({
  byChannel: {},
  mine: null,
  joining: null,
  peers: {},
  remote: {},
  localVideo: null,
  localScreen: null,
  speaking: {},
  level: 0,
  volumes: loadVolumes(),
  localMutes: {},
  ringing: {},
  focused: null,
  error: null,
  applyState: (vs) =>
    set((s) => {
      const byChannel = { ...s.byChannel };
      const drop = (ch: string) => {
        const users = { ...(byChannel[ch] ?? {}) };
        delete users[vs.user_id];
        if (Object.keys(users).length === 0) delete byChannel[ch];
        else byChannel[ch] = users;
      };
      // a user is in at most one channel: remove them everywhere first
      for (const ch of Object.keys(byChannel)) if (byChannel[ch]![vs.user_id]) drop(ch);
      if (vs.channel_id) byChannel[vs.channel_id] = { ...(byChannel[vs.channel_id] ?? {}), [vs.user_id]: vs };
      return { byChannel };
    }),
  setAll: (list) => {
    const byChannel: Record<string, Record<string, VoiceState>> = {};
    for (const vs of list) if (vs.channel_id) (byChannel[vs.channel_id] ??= {})[vs.user_id] = vs;
    set({ byChannel });
  },
  setMine: (mine) => set({ mine }),
  setJoining: (joining) => set({ joining }),
  setPeer: (userId, state) => set((s) => ({ peers: { ...s.peers, [userId]: state } })),
  removePeer: (userId) =>
    set((s) => {
      const peers = { ...s.peers };
      delete peers[userId];
      const remote = { ...s.remote };
      delete remote[userId];
      const speaking = { ...s.speaking };
      delete speaking[userId];
      return { peers, remote, speaking, focused: s.focused?.startsWith(userId + ":") ? null : s.focused };
    }),
  setRemote: (userId, kind, stream) =>
    set((s) => ({ remote: { ...s.remote, [userId]: { ...(s.remote[userId] ?? EMPTY_MEDIA), [kind]: stream } } })),
  setLocalVideo: (localVideo) => set({ localVideo }),
  setLocalScreen: (localScreen) => set({ localScreen }),
  setSpeaking: (userId, on) =>
    set((s) => {
      if (!!s.speaking[userId] === on) return s;
      return { speaking: { ...s.speaking, [userId]: on } };
    }),
  setLevel: (level) => set({ level }),
  setVolume: (userId, pct) =>
    set((s) => {
      const volumes = { ...s.volumes, [userId]: Math.max(0, Math.min(200, Math.round(pct))) };
      storage.set("voiceVolumes", JSON.stringify(volumes));
      return { volumes };
    }),
  setLocalMute: (userId, on) => set((s) => ({ localMutes: { ...s.localMutes, [userId]: on } })),
  setRinging: (channelId, from) =>
    set((s) => {
      const ringing = { ...s.ringing };
      if (from) ringing[channelId] = { from, at: Date.now() };
      else delete ringing[channelId];
      return { ringing };
    }),
  setFocused: (focused) => set({ focused }),
  setError: (error) => set({ error }),
  resetSession: () => set({ mine: null, joining: null, peers: {}, remote: {}, localVideo: null, localScreen: null, speaking: {}, level: 0, focused: null }),
  clear: () => set({ byChannel: {}, mine: null, joining: null, peers: {}, remote: {}, localVideo: null, localScreen: null, speaking: {}, level: 0, ringing: {}, focused: null, error: null }),
}));

/** A channel's participants in join order. */
export function participantsOf(byChannel: Record<string, Record<string, VoiceState>>, channelId: string): VoiceState[] {
  return Object.values(byChannel[channelId] ?? {}).sort((a, b) => a.joined_at - b.joined_at || (a.user_id < b.user_id ? -1 : 1));
}

/** The channel a user is in, if any. */
export function channelOf(byChannel: Record<string, Record<string, VoiceState>>, userId: string): string | null {
  for (const [ch, users] of Object.entries(byChannel)) if (users[userId]) return ch;
  return null;
}
