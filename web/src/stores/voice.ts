import { create } from "zustand";
import type { VoiceState } from "@/api/types";
import { storage } from "@/lib/storage";
import { useAuth } from "./auth";

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
  /**
   * The call's connection, measured every few seconds by the session: round
   * trip in ms and the share of packets lost. Kept here rather than in the
   * views, which come and go with the sidebar and started over grey each time.
   */
  quality: { rtt: number; loss: number } | null;
  /** Per-user playback volume, 0–200 (percent). Persisted locally. */
  volumes: Record<string, number>;
  /** The volume of someone's screen share sound, apart from their voice, 0–200. Persisted locally. */
  streamVolumes: Record<string, number>;
  /** Screen shares whose sound is muted just here, apart from the person's voice. */
  streamMutes: Record<string, boolean>;
  /** Users muted locally (only for me). */
  localMutes: Record<string, boolean>;
  /** Incoming DM calls, by channel. */
  ringing: Record<string, { from: string; at: number }>;
  /** A tile pinned to the focused layout: "user:video" or "user:screen". */
  focused: string | null;
  /**
   * Whose screen shares I have chosen to watch. A share is offered, not
   * forced: it only plays once someone asks for it, and they can stop.
   */
  watching: Record<string, boolean>;
  error: string | null;
  /**
   * The call started, but the microphone never opened: refused, or in use by
   * something else. Joining used to carry on with `mic = null` and draw a
   * completely ordinary call — a mute button reading "Mute", no MicOff on your
   * own tile — so you could sit talking to nobody with every signal saying you
   * were live.
   */
  micBlocked: boolean;
  /** The conversation this device is calling and nobody has picked up in yet, while it rings. */
  calling: string | null;
  /**
   * This device's own connection to the call: coming up for the first time,
   * up, or down and coming back by itself. Null outside a call. The people's
   * tiles only say how each of them is reached, which read "Connecting…" for
   * everyone while "Voice connected" and a green dot said all was well.
   */
  connection: "connecting" | "connected" | "reconnecting" | null;
  /** The call's sound is stopped until a tap (an iPhone after a phone call, a browser's autoplay rule). */
  audioBlocked: boolean;
  /** A conversation's call that everyone else left: it hangs up by itself unless someone comes back. */
  leftAlone: string | null;
  /** Push to talk's on-screen button is being held. */
  pttHeld: boolean;
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
  setQuality: (q: { rtt: number; loss: number } | null) => void;
  setVolume: (userId: string, pct: number) => void;
  setLocalMute: (userId: string, on: boolean) => void;
  setStreamVolume: (userId: string, pct: number) => void;
  setStreamMute: (userId: string, on: boolean) => void;
  setRinging: (channelId: string, from: string | null) => void;
  setFocused: (key: string | null) => void;
  /** Starts or stops watching someone's screen share; watching one brings it to the front. */
  setWatching: (userId: string, on: boolean) => void;
  setError: (e: string | null) => void;
  setMicBlocked: (v: boolean) => void;
  setCalling: (channelId: string | null) => void;
  setConnection: (c: VoiceStore["connection"]) => void;
  setAudioBlocked: (v: boolean) => void;
  setLeftAlone: (channelId: string | null) => void;
  setPttHeld: (v: boolean) => void;
  resetSession: () => void;
  clear: () => void;
}

type VolumeKind = "voiceVolumes" | "voiceStreamVolumes";

/**
 * Whose volume choices are loaded. They are about the people an account talks
 * to, so each account keeps its own, and the next person on a shared browser
 * does not start with the last one's.
 */
let volumesOwner: string | null = useAuth.getState().me?.id ?? null;

function loadVolumes(kind: VolumeKind, userId: string | null): Record<string, number> {
  if (!userId) return {};
  try {
    let raw = storage.get(`${kind}:${userId}`);
    if (!raw) {
      // kept for everyone under one key before; the account signed in now takes it over
      raw = storage.get(kind);
      if (raw) {
        storage.set(`${kind}:${userId}`, raw);
        storage.remove(kind);
      }
    }
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function saveVolumes(kind: VolumeKind, volumes: Record<string, number>): void {
  if (volumesOwner) storage.set(`${kind}:${volumesOwner}`, JSON.stringify(volumes));
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
  quality: null,
  volumes: loadVolumes("voiceVolumes", volumesOwner),
  streamVolumes: loadVolumes("voiceStreamVolumes", volumesOwner),
  streamMutes: {},
  localMutes: {},
  ringing: {},
  focused: null,
  watching: {},
  error: null,
  micBlocked: false,
  calling: null,
  connection: null,
  audioBlocked: false,
  leftAlone: null,
  pttHeld: false,
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
      // a share that ended, or left with its sharer, leaves nothing to watch;
      // a stream that only dropped for a moment keeps being watched
      if ((vs.channel_id && vs.streaming) || !s.watching[vs.user_id]) return { byChannel };
      const watching = { ...s.watching };
      delete watching[vs.user_id];
      return { byChannel, watching, focused: s.focused === `${vs.user_id}:screen` ? null : s.focused };
    }),
  setAll: (list) => {
    const byChannel: Record<string, Record<string, VoiceState>> = {};
    for (const vs of list) if (vs.channel_id) (byChannel[vs.channel_id] ??= {})[vs.user_id] = vs;
    set((s) => {
      const watching = Object.fromEntries(Object.entries(s.watching).filter(([uid]) => list.some((vs) => vs.user_id === uid && vs.channel_id && vs.streaming)));
      const focusGone = !!s.focused?.endsWith(":screen") && !watching[s.focused.slice(0, -":screen".length)];
      return { byChannel, watching, focused: focusGone ? null : s.focused };
    });
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
      const watching = { ...s.watching };
      delete watching[userId];
      return { peers, remote, speaking, watching, focused: s.focused?.startsWith(userId + ":") ? null : s.focused };
    }),
  setRemote: (userId, kind, stream) => set((s) => ({ remote: { ...s.remote, [userId]: { ...(s.remote[userId] ?? EMPTY_MEDIA), [kind]: stream } } })),
  setLocalVideo: (localVideo) => set({ localVideo }),
  setLocalScreen: (localScreen) => set({ localScreen }),
  setSpeaking: (userId, on) =>
    set((s) => {
      if (!!s.speaking[userId] === on) return s;
      return { speaking: { ...s.speaking, [userId]: on } };
    }),
  setLevel: (level) => set({ level }),
  setQuality: (quality) => set({ quality }),
  setVolume: (userId, pct) =>
    set((s) => {
      const volumes = { ...s.volumes, [userId]: Math.max(0, Math.min(200, Math.round(pct))) };
      saveVolumes("voiceVolumes", volumes);
      return { volumes };
    }),
  setLocalMute: (userId, on) => set((s) => ({ localMutes: { ...s.localMutes, [userId]: on } })),
  setStreamVolume: (userId, pct) =>
    set((s) => {
      const streamVolumes = { ...s.streamVolumes, [userId]: Math.max(0, Math.min(200, Math.round(pct))) };
      saveVolumes("voiceStreamVolumes", streamVolumes);
      return { streamVolumes };
    }),
  setStreamMute: (userId, on) => set((s) => ({ streamMutes: { ...s.streamMutes, [userId]: on } })),
  setRinging: (channelId, from) =>
    set((s) => {
      const ringing = { ...s.ringing };
      if (from) ringing[channelId] = { from, at: Date.now() };
      else delete ringing[channelId];
      return { ringing };
    }),
  setFocused: (focused) => set({ focused }),
  setWatching: (userId, on) =>
    set((s) => {
      const watching = { ...s.watching };
      const key = `${userId}:screen`;
      if (on) {
        watching[userId] = true;
        return { watching, focused: key };
      }
      delete watching[userId];
      return { watching, focused: s.focused === key ? null : s.focused };
    }),
  setError: (error) => set({ error }),
  setMicBlocked: (micBlocked) => set({ micBlocked }),
  setCalling: (calling) => set({ calling }),
  setConnection: (connection) => set((s) => (s.connection === connection ? s : { connection })),
  setAudioBlocked: (audioBlocked) => set((s) => (s.audioBlocked === audioBlocked ? s : { audioBlocked })),
  setLeftAlone: (leftAlone) => set({ leftAlone }),
  setPttHeld: (pttHeld) => set((s) => (s.pttHeld === pttHeld ? s : { pttHeld })),
  // error goes with the rest: a refusal from a call that is over has nothing
  // to say about the next one, and it was shown again in its lobby
  resetSession: () => set({ mine: null, joining: null, peers: {}, remote: {}, localVideo: null, localScreen: null, speaking: {}, level: 0, quality: null, focused: null, watching: {}, error: null, micBlocked: false, calling: null, connection: null, audioBlocked: false, leftAlone: null, pttHeld: false }),
  clear: () => set({ byChannel: {}, mine: null, joining: null, peers: {}, remote: {}, localVideo: null, localScreen: null, speaking: {}, level: 0, quality: null, ringing: {}, focused: null, watching: {}, error: null, micBlocked: false, calling: null, connection: null, audioBlocked: false, leftAlone: null, pttHeld: false }),
}));

// Signing in (or out) swaps in that account's own volume choices.
useAuth.subscribe((a) => {
  const id = a.me?.id ?? null;
  if (id === volumesOwner) return;
  volumesOwner = id;
  useVoice.setState({ volumes: loadVolumes("voiceVolumes", id), streamVolumes: loadVolumes("voiceStreamVolumes", id) });
});

/** A channel's participants in join order. */
export function participantsOf(byChannel: Record<string, Record<string, VoiceState>>, channelId: string): VoiceState[] {
  return Object.values(byChannel[channelId] ?? {}).sort((a, b) => a.joined_at - b.joined_at || (a.user_id < b.user_id ? -1 : 1));
}

/** The channel a user is in, if any. */
export function channelOf(byChannel: Record<string, Record<string, VoiceState>>, userId: string): string | null {
  for (const [ch, users] of Object.entries(byChannel)) if (users[userId]) return ch;
  return null;
}
