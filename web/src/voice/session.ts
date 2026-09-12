/**
 * The voice session: joins and leaves channels, owns local media, drives the
 * mesh transport from gateway events, and applies mute/deafen/PTT/VAD.
 */
import { voice as voiceApi } from "@/api/voice";
import type { VoiceState } from "@/api/types";
import type { GatewayEvent } from "@/gateway/events";
import { gateway } from "@/gateway/session";
import { playSound } from "@/lib/sounds";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useVoice, participantsOf } from "@/stores/voice";
import { useVoiceLocal } from "@/stores/voiceLocal";
import { LevelMeter, audioContext, getCamera, getMic, getScreen, screenBitrate, sensitivityToThreshold } from "./media";
import { MeshTransport, type SignalPayload } from "./mesh";

interface Session {
  channelId: string;
  transport: MeshTransport;
  /** The raw capture; what peers get is the gain-staged copy. */
  mic: MediaStream | null;
  micRaw: MediaStream | null;
  inputGain: GainNode | null;
  meter: LevelMeter | null;
  meterTimer: ReturnType<typeof setInterval> | null;
  camera: MediaStream | null;
  screen: MediaStream | null;
  noiseFloor: number;
  pttHeld: boolean;
}

let session: Session | null = null;
let iceCache: RTCIceServer[] | null = null;
let installed = false;
let ringTimers = new Map<string, ReturnType<typeof setTimeout>>();

function me(): string | undefined {
  return useAuth.getState().me?.id;
}

function sendState(channelId: string | null): void {
  const local = useVoiceLocal.getState();
  const st = useVoice.getState();
  gateway()?.send("voice_state", {
    channel_id: channelId,
    self_mute: local.muted,
    self_deaf: local.deafened,
    video: !!st.localVideo,
    streaming: !!st.localScreen,
  });
}

async function iceServers(): Promise<RTCIceServer[]> {
  if (iceCache) return iceCache;
  try {
    const res = await voiceApi.ice();
    iceCache = res.ice_servers as RTCIceServer[];
  } catch {
    iceCache = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
  }
  return iceCache;
}

/** True when the local mic should be transmitting right now. */
function shouldTransmit(): boolean {
  const local = useVoiceLocal.getState();
  const mine = useVoice.getState().mine;
  if (local.muted || local.deafened || mine?.server_mute) return false;
  const v = useSettings.getState().settings.voice;
  if (v.mode === "ptt") return !!session?.pttHeld;
  return true;
}

function applyTransmit(): void {
  if (!session?.mic) return;
  const on = shouldTransmit();
  for (const t of session.mic.getAudioTracks()) t.enabled = on;
}

/** Scales the microphone before it reaches the peers, for the input slider. */
function applyInputGain(): void {
  const s = session;
  if (!s?.inputGain) return;
  s.inputGain.gain.value = useSettings.getState().settings.voice.inputVolume / 100;
}

/** Join a voice channel (or DM call). Leaves the current one first. */
export async function joinVoice(channelId: string): Promise<void> {
  const myId = me();
  if (!myId) return;
  const store = useVoice.getState();
  if (session?.channelId === channelId) return;
  if (session) await leaveVoice(false);
  store.setError(null);
  store.setJoining(channelId);
  store.setRinging(channelId, null);
  const ice = await iceServers();
  const transport = new MeshTransport(myId, ice, {
    onSignal: (to, payload) => gateway()?.send("voice_signal", { to, payload }),
    onPeerState: (uid, state) => useVoice.getState().setPeer(uid, state),
    onRemoteStream: (uid, kind, stream) => useVoice.getState().setRemote(uid, kind, stream),
    onSpeaking: (uid, on) => useVoice.getState().setSpeaking(uid, on),
  });
  const s: Session = { channelId, transport, mic: null, micRaw: null, inputGain: null, meter: null, meterTimer: null, camera: null, screen: null, noiseFloor: 0.01, pttHeld: false };
  session = s;
  try {
    s.micRaw = await getMic(useSettings.getState().settings.voice);
    s.mic = withInputGain(s, s.micRaw);
  } catch {
    useUI.getState().toast("Microphone access was denied. You can listen, but nobody can hear you.", "error");
  }
  if (session !== s) return; // left while asking for the mic
  if (s.mic) {
    const track = s.mic.getAudioTracks()[0] ?? null;
    transport.setLocalAudio(track);
    startMeter(s);
  }
  for (const uid of Object.keys(useVoice.getState().localMutes)) transport.setLocalMute(uid, true);
  for (const [uid, pct] of Object.entries(useVoice.getState().volumes)) transport.setVolume(uid, pct);
  transport.setOutputMuted(useVoiceLocal.getState().deafened);
  transport.setMasterVolume(useSettings.getState().settings.voice.outputVolume);
  const out = useSettings.getState().settings.voice.outputDeviceId;
  if (out) void transport.setOutputDevice(out);
  applyTransmit();
  sendState(channelId);
  playSound("join");
}

/** Leave voice; tells the server unless the connection is already gone. */
export async function leaveVoice(notify = true): Promise<void> {
  const s = session;
  session = null;
  if (s) {
    stopMeter(s);
    s.transport.close();
    s.mic?.getTracks().forEach((t) => t.stop());
    s.micRaw?.getTracks().forEach((t) => t.stop());
    s.camera?.getTracks().forEach((t) => t.stop());
    s.screen?.getTracks().forEach((t) => t.stop());
    if (notify) sendState(null);
    playSound("leave");
  }
  useVoice.getState().resetSession();
}

/** Routes the capture through a gain node so the input slider does something. */
function withInputGain(s: Session, raw: MediaStream): MediaStream {
  try {
    const ctx = audioContext();
    const src = ctx.createMediaStreamSource(raw);
    const gain = ctx.createGain();
    gain.gain.value = useSettings.getState().settings.voice.inputVolume / 100;
    const dest = ctx.createMediaStreamDestination();
    src.connect(gain).connect(dest);
    s.inputGain = gain;
    return dest.stream;
  } catch {
    s.inputGain = null;
    return raw;
  }
}

function startMeter(s: Session): void {
  if (!s.mic) return;
  const ctx = audioContext();
  s.meter = new LevelMeter(ctx, s.mic);
  const myId = me() ?? "";
  s.meterTimer = setInterval(() => {
    if (!s.meter) return;
    const level = s.meter.level();
    useVoice.getState().setLevel(level);
    const v = useSettings.getState().settings.voice;
    let threshold: number;
    if (v.autoSensitivity) {
      s.noiseFloor = level < s.noiseFloor ? level : s.noiseFloor * 0.995 + level * 0.005;
      threshold = Math.max(0.02, s.noiseFloor * 2.5);
    } else threshold = sensitivityToThreshold(v.sensitivity);
    const speaking = shouldTransmit() && level > threshold;
    useVoice.getState().setSpeaking(myId, speaking);
  }, 80);
}

function stopMeter(s: Session): void {
  if (s.meterTimer) clearInterval(s.meterTimer);
  s.meter?.close();
  s.meter = null;
  s.meterTimer = null;
}

/** Swap the microphone after a device or processing setting change. */
export async function refreshMic(): Promise<void> {
  const s = session;
  if (!s) return;
  try {
    const next = await getMic(useSettings.getState().settings.voice);
    if (session !== s) {
      next.getTracks().forEach((t) => t.stop());
      return;
    }
    stopMeter(s);
    s.mic?.getTracks().forEach((t) => t.stop());
    s.micRaw?.getTracks().forEach((t) => t.stop());
    s.micRaw = next;
    s.mic = withInputGain(s, next);
    s.transport.setLocalAudio(s.mic.getAudioTracks()[0] ?? null);
    startMeter(s);
    applyTransmit();
  } catch {
    useUI.getState().toast("Could not switch the microphone.", "error");
  }
}

export async function toggleCamera(): Promise<void> {
  const s = session;
  if (!s) return;
  if (s.camera) {
    s.camera.getTracks().forEach((t) => t.stop());
    s.camera = null;
    s.transport.setLocalVideo(null);
    useVoice.getState().setLocalVideo(null);
  } else {
    try {
      s.camera = await getCamera();
      const track = s.camera.getVideoTracks()[0] ?? null;
      if (track) track.onended = () => void toggleCamera();
      s.transport.setLocalVideo(track);
      useVoice.getState().setLocalVideo(s.camera);
    } catch {
      useUI.getState().toast("Camera access was denied.", "error");
      return;
    }
  }
  sendState(s.channelId);
}

export async function toggleScreen(): Promise<void> {
  const s = session;
  if (!s) return;
  if (s.screen) {
    s.screen.getTracks().forEach((t) => t.stop());
    s.screen = null;
    s.transport.setLocalScreen(null);
    useVoice.getState().setLocalScreen(null);
  } else {
    const q = useSettings.getState().settings.voice.streamQuality;
    try {
      s.screen = await getScreen(q);
    } catch {
      return; // the user cancelled the picker
    }
    const video = s.screen.getVideoTracks()[0];
    if (video) video.onended = () => void toggleScreen();
    s.transport.setLocalScreen(s.screen, screenBitrate(q));
    useVoice.getState().setLocalScreen(s.screen);
  }
  sendState(s.channelId);
}

export function setUserVolume(userId: string, pct: number): void {
  useVoice.getState().setVolume(userId, pct);
  session?.transport.setVolume(userId, pct);
}

export function setUserLocalMute(userId: string, on: boolean): void {
  useVoice.getState().setLocalMute(userId, on);
  session?.transport.setLocalMute(userId, on);
}

export function inVoice(): string | null {
  return session?.channelId ?? null;
}

/** Live link quality for the indicator. */
export function voiceStats(): Promise<{ rtt: number; loss: number }> | null {
  return session ? session.transport.stats() : null;
}

// --- gateway events --------------------------------------------------------

function syncPeers(): void {
  const s = session;
  const myId = me();
  if (!s || !myId) return;
  const wanted = new Set(participantsOf(useVoice.getState().byChannel, s.channelId).map((p) => p.user_id).filter((id) => id !== myId));
  for (const id of s.transport.peerIds()) if (!wanted.has(id)) s.transport.removePeer(id), useVoice.getState().removePeer(id);
}

export function handleVoiceEvent(e: GatewayEvent): void {
  const myId = me();
  const store = useVoice.getState();
  switch (e.t) {
    case "voice_state": {
      const vs = e.d;
      const before = vs.channel_id ? null : channelOfUser(vs.user_id);
      store.applyState(vs);
      if (vs.user_id === myId) {
        if (vs.channel_id) {
          store.setMine(vs);
          store.setJoining(null);
          if (session && session.channelId !== vs.channel_id) {
            // moved by a moderator: rebuild peers for the new room
            for (const id of session.transport.peerIds()) session.transport.removePeer(id), store.removePeer(id);
            session.channelId = vs.channel_id;
          }
          if (session) {
            for (const p of participantsOf(useVoice.getState().byChannel, vs.channel_id)) {
              if (p.user_id !== myId) session.transport.addPeer(p.user_id, true);
            }
          }
          applyTransmit();
        } else if (session && (vs.old_channel_id === session.channelId || !vs.old_channel_id)) {
          // disconnected server-side (kick, channel deleted, moderator)
          void leaveVoice(false);
        }
        return;
      }
      if (!session) return;
      if (vs.channel_id === session.channelId) {
        if (!session.transport.peerIds().includes(vs.user_id)) {
          session.transport.addPeer(vs.user_id, false);
          playSound("join");
        }
      } else if (before === session.channelId || vs.old_channel_id === session.channelId) {
        session.transport.removePeer(vs.user_id);
        store.removePeer(vs.user_id);
        playSound("leave");
      }
      syncPeers();
      return;
    }
    case "voice_signal":
      if (session && e.d.channel_id === session.channelId) void session.transport.handleSignal(e.d.from, e.d.payload as SignalPayload);
      return;
    case "voice_error":
      store.setJoining(null);
      store.setError(e.d.message);
      useUI.getState().toast(e.d.message, "error");
      if (session && !useVoice.getState().mine) void leaveVoice(false);
      return;
    case "call_ring": {
      if (e.d.from === myId || session?.channelId === e.d.channel_id) return;
      store.setRinging(e.d.channel_id, e.d.from);
      playSound("ring");
      const old = ringTimers.get(e.d.channel_id);
      if (old) clearTimeout(old);
      ringTimers.set(e.d.channel_id, setTimeout(() => useVoice.getState().setRinging(e.d.channel_id, null), 60000));
      return;
    }
    case "call_end":
      if (e.d.reason === "ended" || e.d.user_id === myId) {
        store.setRinging(e.d.channel_id, null);
        const t = ringTimers.get(e.d.channel_id);
        if (t) clearTimeout(t);
      }
      return;
    default:
      return;
  }
}

function channelOfUser(userId: string): string | null {
  for (const [ch, users] of Object.entries(useVoice.getState().byChannel)) if (users[userId]) return ch;
  return null;
}

export function onReadyVoice(list: VoiceState[]): void {
  useVoice.getState().setAll(list);
  // after a reconnect the server has forgotten us: rejoin the room we were in
  const s = session;
  if (s) {
    for (const id of s.transport.peerIds()) s.transport.removePeer(id), useVoice.getState().removePeer(id);
    useVoice.getState().setMine(null);
    sendState(s.channelId);
  }
}

/** Declines an incoming DM call. */
export async function declineCall(channelId: string): Promise<void> {
  useVoice.getState().setRinging(channelId, null);
  try {
    await voiceApi.decline(channelId);
  } catch {
    /* the ring will time out */
  }
}

/** Registers the mute/deafen, push-to-talk and unload hooks once. */
export function installVoice(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  useVoiceLocal.subscribe((st, prev) => {
    if (st.muted !== prev.muted) playSound(st.muted ? "mute" : "unmute");
    session?.transport.setOutputMuted(st.deafened);
    applyTransmit();
    if (session) sendState(session.channelId);
  });
  useSettings.subscribe((st, prev) => {
    const a = st.settings.voice;
    const b = prev.settings.voice;
    if (!session) return;
    if (a.inputDeviceId !== b.inputDeviceId || a.noiseSuppression !== b.noiseSuppression || a.echoCancellation !== b.echoCancellation || a.autoGain !== b.autoGain) void refreshMic();
    if (a.outputDeviceId !== b.outputDeviceId) void session.transport.setOutputDevice(a.outputDeviceId);
    if (a.outputVolume !== b.outputVolume) session.transport.setMasterVolume(a.outputVolume);
    if (a.inputVolume !== b.inputVolume) applyInputGain();
    if (a.mode !== b.mode) applyTransmit();
  });
  const isPtt = (e: KeyboardEvent) => {
    const v = useSettings.getState().settings.voice;
    return v.mode === "ptt" && (e.key === v.pttKey || e.code === v.pttKey);
  };
  window.addEventListener("keydown", (e) => {
    if (!session || !isPtt(e) || e.repeat) return;
    session.pttHeld = true;
    applyTransmit();
  });
  window.addEventListener("keyup", (e) => {
    if (!session || !isPtt(e)) return;
    session.pttHeld = false;
    applyTransmit();
  });
  window.addEventListener("blur", () => {
    if (session?.pttHeld) {
      session.pttHeld = false;
      applyTransmit();
    }
  });
  window.addEventListener("beforeunload", () => {
    if (session) sendState(null);
  });
  // a channel that disappears takes its call with it
  useChannels.subscribe((st, prev) => {
    if (session && prev.byId[session.channelId] && !st.byId[session.channelId]) void leaveVoice(false);
  });
}
