/**
 * The voice session: joins and leaves channels, owns local media, drives the
 * mesh transport from gateway events, and applies mute/deafen/PTT/VAD.
 */
import { voice as voiceApi } from "@/api/voice";
import type { VoiceState } from "@/api/types";
import type { GatewayEvent } from "@/gateway/events";
import { gateway } from "@/gateway/session";
import { holdReload } from "@/lib/busy";
import { playSound, startRinging, stopRinging } from "@/lib/sounds";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useVoice, participantsOf } from "@/stores/voice";
import { useVoiceLocal } from "@/stores/voiceLocal";
import { LevelMeter, audioContext, getCamera, getMic, getScreen, lastInputChoice, resumeAudio, screenBitrate, sensitivityToThreshold, sentStream, type CameraFacing } from "./media";
import { MeshTransport, type SignalPayload } from "./mesh";

interface Session {
  channelId: string;
  transport: MeshTransport;
  /** The raw capture; what peers get is the gain-staged copy. */
  mic: MediaStream | null;
  micRaw: MediaStream | null;
  inputGain: GainNode | null;
  inputSource: MediaStreamAudioSourceNode | null;
  meter: LevelMeter | null;
  meterTimer: ReturnType<typeof setInterval> | null;
  camera: MediaStream | null;
  screen: MediaStream | null;
  /** A camera or screen request is waiting on the browser; a second tap must not open another. */
  cameraPending: boolean;
  screenPending: boolean;
  noiseFloor: number;
  pttHeld: boolean;
  /** Whether voice activity currently hears speech, and until when it keeps listening after. */
  vadOpen: boolean;
  vadHoldUntil: number;
  /** The server has been told about this call, so leaving has to tell it too. */
  announced: boolean;
}

let session: Session | null = null;
/** Keeps a new version of the app from reloading the page while in a call. */
let releaseCall: (() => void) | null = null;
let iceCache: { servers: RTCIceServer[]; at: number } | null = null;
/** Bumped by every join and leave, so a join still waiting on the network can tell it was overtaken. */
let joinSeq = 0;
/** This connection's gateway session, to tell this device's call from the same account's other devices. */
let mySessionId: string | null = null;
let installed = false;
let ringTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Relay credentials expire, so the list is fetched again after this long. */
const ICE_CACHE_MS = 30 * 60 * 1000;
/** How long voice activity keeps the mic open after speech drops, so word endings and short pauses get through. */
const VAD_HOLD_MS = 400;
/** Refusals of a voice_signal: they race people leaving and reconnects, and say nothing about our own place in the call. */
const SIGNAL_ERRORS = new Set(["not_in_voice", "peer_gone", "too_large"]);

function me(): string | undefined {
  return useAuth.getState().me?.id;
}

/** `resume` marks a rejoin after a reconnect, so the server does not treat it as a new call. */
function sendState(channelId: string | null, resume = false): void {
  const local = useVoiceLocal.getState();
  const st = useVoice.getState();
  gateway()?.send("voice_state", {
    channel_id: channelId,
    self_mute: local.muted,
    self_deaf: local.deafened,
    video: !!st.localVideo,
    streaming: !!st.localScreen,
    ...(resume ? { resume: true } : {}),
  });
}

async function iceServers(): Promise<RTCIceServer[]> {
  if (iceCache && Date.now() - iceCache.at < ICE_CACHE_MS) return iceCache.servers;
  try {
    const res = await voiceApi.ice();
    iceCache = { servers: res.ice_servers as RTCIceServer[], at: Date.now() };
    return iceCache.servers;
  } catch {
    // Not kept: the next call should ask again rather than go without a relay.
    return [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
  }
}

/**
 * A touch screen with no hover has no key to hold. Push to talk follows the
 * account from the desktop, so there it falls back to voice activity instead
 * of leaving the phone silent for good.
 */
function noKeyToHold(): boolean {
  return typeof matchMedia === "function" && matchMedia("(hover: none) and (pointer: coarse)").matches;
}

/** True when the local mic may be on at all: not muted, and the push-to-talk key held where there is one. */
function shouldTransmit(): boolean {
  const local = useVoiceLocal.getState();
  const mine = useVoice.getState().mine;
  if (local.muted || local.deafened || mine?.server_mute) return false;
  const v = useSettings.getState().settings.voice;
  if (v.mode === "ptt" && !noKeyToHold()) return !!session?.pttHeld;
  return true;
}

/** True when voice activity lets the mic through: it heard speech, or push to talk is doing the job. */
function gateOpen(): boolean {
  const s = session;
  if (!s) return true;
  if (s.pttHeld) return true;
  if (useSettings.getState().settings.voice.mode === "ptt" && !noKeyToHold()) return true;
  // The gate is worked by a timer, which a hidden page has throttled or
  // frozen; it stays open there rather than cut the speaker off mid-sentence.
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return true;
  return s.vadOpen;
}

function applyTransmit(): void {
  if (!session?.mic) return;
  const on = shouldTransmit();
  for (const t of session.mic.getAudioTracks()) t.enabled = on;
  // The gate pauses the senders rather than the track, so the meter keeps hearing the mic and can open it again.
  session.transport.setAudioGate(gateOpen());
}

/** Scales the microphone before it reaches the peers, for the input slider. */
function applyInputGain(): void {
  const s = session;
  if (!s?.micRaw) return;
  const volume = useSettings.getState().settings.voice.inputVolume;
  if (s.inputGain) {
    // moving back to 100% takes the extra stage out of the way again
    if (volume === 100) rebuildInput(s);
    else s.inputGain.gain.value = volume / 100;
    return;
  }
  if (volume !== 100) rebuildInput(s);
}

/** Rebuilds the path from the microphone to the peers after a volume change. */
function rebuildInput(s: Session): void {
  if (!s.micRaw) return;
  // the meter listens to the sent stream, which is about to be replaced
  stopMeter(s);
  disconnectInput(s);
  if (s.mic && s.mic !== s.micRaw) s.mic.getTracks().forEach((t) => t.stop());
  s.mic = withInputGain(s, s.micRaw);
  const track = s.mic.getAudioTracks()[0] ?? null;
  s.transport.setLocalAudio(track);
  startMeter(s);
  applyTransmit();
}

/** Join a voice channel (or DM call). Leaves the current one first. */
export async function joinVoice(channelId: string): Promise<void> {
  const myId = me();
  if (!myId) return;
  // Made here, inside the tap, because iOS only lets audio start in a gesture
  // and nothing else in a call without a microphone would get it running.
  audioContext();
  const store = useVoice.getState();
  if (session?.channelId === channelId) return;
  // Moving says so first: if the new channel refuses us, the server must not
  // keep us sitting in the old one.
  if (session) await leaveVoice(true);
  const seq = ++joinSeq;
  store.setError(null);
  store.setJoining(channelId);
  clearRing(channelId);
  const ice = await iceServers();
  if (seq !== joinSeq) return; // disconnected, or joined elsewhere, while fetching
  const transport = new MeshTransport(myId, ice, {
    onSignal: (to, payload) => {
      const gw = gateway();
      // Losing the socket mid-call would otherwise strand the peer silently.
      if (!gw) {
        console.warn("voice: no gateway to signal through");
        return;
      }
      gw.send("voice_signal", { to, payload });
    },
    onPeerState: (uid, state) => useVoice.getState().setPeer(uid, state),
    onRemoteStream: (uid, kind, stream) => useVoice.getState().setRemote(uid, kind, stream),
    onSpeaking: (uid, on) => useVoice.getState().setSpeaking(uid, on),
  });
  const s: Session = { channelId, transport, mic: null, micRaw: null, inputGain: null, inputSource: null, meter: null, meterTimer: null, camera: null, screen: null, cameraPending: false, screenPending: false, noiseFloor: 0.01, pttHeld: false, vadOpen: false, vadHoldUntil: 0, announced: false };
  session = s;
  releaseCall ??= holdReload();
  let mic: MediaStream | null = null;
  try {
    mic = await getMic(useSettings.getState().settings.voice);
  } catch {
    if (session === s) useUI.getState().toast("Microphone access was denied. You can listen, but nobody can hear you.", "error");
  }
  if (session !== s || seq !== joinSeq) {
    // left while asking for the mic: leaving already closed the transport, but
    // this capture came too late for it to stop
    mic?.getTracks().forEach((t) => t.stop());
    return;
  }
  if (mic) {
    s.micRaw = mic;
    s.mic = withInputGain(s, mic);
    if (lastInputChoice() === "missing") {
      // Better to say so than to carry a microphone nobody is talking into.
      useUI.getState().toast("The microphone you picked is not available, so this call is using the system default.", "error");
    }
    const track = s.mic.getAudioTracks()[0] ?? null;
    transport.setLocalAudio(track);
    startMeter(s);
  }
  const voiceStore = useVoice.getState();
  for (const uid of Object.keys(voiceStore.localMutes)) transport.setLocalMute(uid, true);
  for (const [uid, pct] of Object.entries(voiceStore.volumes)) transport.setVolume(uid, pct);
  for (const uid of Object.keys(voiceStore.watching)) transport.setWatching(uid, true);
  transport.setOutputMuted(useVoiceLocal.getState().deafened);
  transport.setMasterVolume(useSettings.getState().settings.voice.outputVolume);
  const out = useSettings.getState().settings.voice.outputDeviceId;
  if (out) void transport.setOutputDevice(out);
  applyTransmit();
  s.announced = true;
  sendState(channelId);
  playSound("join");
}

/** Leave voice; tells the server unless the connection is already gone. */
export async function leaveVoice(notify = true): Promise<void> {
  joinSeq++;
  const s = session;
  session = null;
  releaseCall?.();
  releaseCall = null;
  if (s) {
    stopMeter(s);
    disconnectInput(s);
    s.transport.close();
    s.mic?.getTracks().forEach((t) => t.stop());
    s.micRaw?.getTracks().forEach((t) => t.stop());
    s.camera?.getTracks().forEach((t) => t.stop());
    s.screen?.getTracks().forEach((t) => t.stop());
    if (notify && s.announced) sendState(null);
    playSound("leave");
  }
  useVoice.getState().resetSession();
}

/**
 * Routes the capture through a gain node so the input slider does something.
 * At 100% the microphone's own track is sent instead: a graph that produces
 * silence on some devices is not worth inserting for no change in level.
 */
function withInputGain(s: Session, raw: MediaStream): MediaStream {
  const { stream, gain, source } = sentStream(audioContext(), raw, useSettings.getState().settings.voice.inputVolume);
  s.inputGain = gain;
  s.inputSource = source;
  return stream;
}

/** Lets go of the slider's audio graph, which would otherwise stay wired to the live microphone. */
function disconnectInput(s: Session): void {
  try {
    s.inputSource?.disconnect();
    s.inputGain?.disconnect();
  } catch {
    /* already gone */
  }
  s.inputSource = null;
  s.inputGain = null;
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
    const now = Date.now();
    if (level > threshold) s.vadHoldUntil = now + VAD_HOLD_MS;
    // A stopped audio engine reads silence, which must not shut the mic.
    const open = ctx.state !== "running" || now < s.vadHoldUntil;
    if (open !== s.vadOpen && session === s) {
      s.vadOpen = open;
      applyTransmit();
    }
    const speaking = shouldTransmit() && gateOpen() && level > threshold;
    useVoice.getState().setSpeaking(myId, speaking);
  }, 80);
}

function stopMeter(s: Session): void {
  if (s.meterTimer) clearInterval(s.meterTimer);
  s.meter?.close();
  s.meter = null;
  s.meterTimer = null;
  s.vadOpen = false;
  s.vadHoldUntil = 0;
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
    disconnectInput(s);
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

/** Which way the camera points; a phone can turn it round mid-call. */
let cameraFacing: CameraFacing = "user";

export function currentCameraFacing(): CameraFacing {
  return cameraFacing;
}

/**
 * Turns the camera round. The new stream replaces the old one in place, so
 * the other side sees the picture change without renegotiating.
 */
export async function flipCamera(): Promise<void> {
  const s = session;
  if (!s?.camera || s.cameraPending) return;
  const next: CameraFacing = cameraFacing === "user" ? "environment" : "user";
  // Many phones cannot open a second camera while the first is live, so the
  // old one is let go before asking for the other. Its ended handler would
  // otherwise turn the camera off halfway through.
  const old = s.camera;
  for (const t of old.getTracks()) {
    t.onended = null;
    t.stop();
  }
  s.cameraPending = true;
  let stream: MediaStream | null = null;
  let facing = next;
  try {
    stream = await getCamera(next);
  } catch {
    facing = cameraFacing;
    stream = await getCamera(cameraFacing).catch(() => null);
    if (stream && session === s) useUI.getState().toast("This device has no other camera.", "error");
  }
  s.cameraPending = false;
  if (session !== s) {
    stream?.getTracks().forEach((t) => t.stop());
    return;
  }
  if (!stream) {
    s.camera = null;
    s.transport.setLocalVideo(null);
    useVoice.getState().setLocalVideo(null);
    sendState(s.channelId);
    useUI.getState().toast("Could not switch the camera.", "error");
    return;
  }
  cameraFacing = facing;
  s.camera = stream;
  const track = stream.getVideoTracks()[0] ?? null;
  if (track) track.onended = () => void toggleCamera();
  s.transport.setLocalVideo(track);
  useVoice.getState().setLocalVideo(stream);
}

export async function toggleCamera(): Promise<void> {
  const s = session;
  if (!s || s.cameraPending) return;
  if (s.camera) {
    s.camera.getTracks().forEach((t) => t.stop());
    s.camera = null;
    s.transport.setLocalVideo(null);
    useVoice.getState().setLocalVideo(null);
  } else {
    s.cameraPending = true;
    let stream: MediaStream;
    try {
      stream = await getCamera(cameraFacing);
    } catch {
      s.cameraPending = false;
      if (session === s) useUI.getState().toast("Camera access was denied.", "error");
      return;
    }
    s.cameraPending = false;
    if (session !== s) {
      // hung up while the camera was opening
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    s.camera = stream;
    const track = stream.getVideoTracks()[0] ?? null;
    if (track) track.onended = () => void toggleCamera();
    s.transport.setLocalVideo(track);
    useVoice.getState().setLocalVideo(stream);
  }
  sendState(s.channelId);
}

export async function toggleScreen(): Promise<void> {
  const s = session;
  if (!s || s.screenPending) return;
  if (s.screen) {
    s.screen.getTracks().forEach((t) => t.stop());
    s.screen = null;
    s.transport.setLocalScreen(null);
    useVoice.getState().setLocalScreen(null);
  } else {
    const q = useSettings.getState().settings.voice.streamQuality;
    s.screenPending = true;
    let stream: MediaStream;
    try {
      stream = await getScreen(q);
    } catch {
      s.screenPending = false;
      return; // the user cancelled the picker
    }
    s.screenPending = false;
    if (session !== s) {
      // hung up while the picker was open
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    s.screen = stream;
    const video = stream.getVideoTracks()[0];
    if (video) video.onended = () => void toggleScreen();
    s.transport.setLocalScreen(stream, screenBitrate(q));
    useVoice.getState().setLocalScreen(stream);
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

/** Stops ringing for a channel, and the timeout that would have stopped it. */
function clearRing(channelId: string): void {
  useVoice.getState().setRinging(channelId, null);
  const t = ringTimers.get(channelId);
  if (t) clearTimeout(t);
  ringTimers.delete(channelId);
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
        // The server keeps one call per account and tells all its devices.
        // A state from another device's session is that device's call.
        const elsewhere = !!mySessionId && !!vs.session_id && vs.session_id !== mySessionId;
        if (vs.channel_id) {
          if (elsewhere) {
            clearRing(vs.channel_id);
            if (session) {
              void leaveVoice(false);
              useUI.getState().toast("Your call moved to another device.");
            } else if (store.mine) store.setMine(null);
            return;
          }
          // a join this device has since given up on; its leave is on the way
          if (!session) return;
          store.setMine(vs);
          store.setJoining(null);
          if (session.channelId !== vs.channel_id) {
            // moved by a moderator: rebuild peers for the new room
            for (const id of session.transport.peerIds()) session.transport.removePeer(id), store.removePeer(id);
            session.channelId = vs.channel_id;
          }
          for (const p of participantsOf(useVoice.getState().byChannel, vs.channel_id)) {
            if (p.user_id !== myId) session.transport.addPeer(p.user_id);
          }
          applyTransmit();
        } else if (!elsewhere && session && (vs.old_channel_id === session.channelId || !vs.old_channel_id)) {
          // disconnected server-side (kick, channel deleted, moderator)
          void leaveVoice(false);
        }
        return;
      }
      if (!session) return;
      if (vs.channel_id === session.channelId) {
        if (!session.transport.peerIds().includes(vs.user_id)) {
          session.transport.addPeer(vs.user_id);
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
      if (session && e.d.channel_id === session.channelId) session.transport.handleSignal(e.d.from, e.d.payload as SignalPayload);
      return;
    case "voice_error":
      if (SIGNAL_ERRORS.has(e.d.code)) {
        console.warn("voice: signal refused:", e.d.code);
        return;
      }
      store.setJoining(null);
      store.setError(e.d.message);
      useUI.getState().toast(e.d.message, "error");
      if (session && !useVoice.getState().mine) void leaveVoice(false);
      return;
    case "call_ring": {
      if (e.d.from === myId || session?.channelId === e.d.channel_id) return;
      // the ringing store starts the repeating ring (see installVoice)
      store.setRinging(e.d.channel_id, e.d.from);
      const old = ringTimers.get(e.d.channel_id);
      if (old) clearTimeout(old);
      ringTimers.set(e.d.channel_id, setTimeout(() => clearRing(e.d.channel_id), 60000));
      return;
    }
    case "call_end":
      if (e.d.reason === "ended" || e.d.user_id === myId) clearRing(e.d.channel_id);
      return;
    default:
      return;
  }
}

function channelOfUser(userId: string): string | null {
  for (const [ch, users] of Object.entries(useVoice.getState().byChannel)) if (users[userId]) return ch;
  return null;
}

export function onReadyVoice(list: VoiceState[], sessionId?: string): void {
  mySessionId = sessionId ?? null;
  useVoice.getState().setAll(list);
  // after a reconnect the server has forgotten us: rejoin the room we were in
  // (a join still asking for the mic announces itself when it gets there)
  const s = session;
  if (s?.announced) {
    for (const id of s.transport.peerIds()) s.transport.removePeer(id), useVoice.getState().removePeer(id);
    useVoice.getState().setMine(null);
    sendState(s.channelId, true);
  }
}

/** Declines an incoming DM call. */
export async function declineCall(channelId: string): Promise<void> {
  clearRing(channelId);
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
  useVoice.subscribe((st, prev) => {
    // One ring for however many calls are coming in, until the last is answered, declined or gone.
    if (st.ringing !== prev.ringing) {
      const now = Object.keys(st.ringing).length > 0;
      const was = Object.keys(prev.ringing).length > 0;
      if (now && !was) startRinging();
      else if (!now && was) stopRinging();
    }
    // A share's sound plays only while it is watched.
    if (session && st.watching !== prev.watching) {
      for (const id of new Set([...Object.keys(st.watching), ...Object.keys(prev.watching)])) session.transport.setWatching(id, !!st.watching[id]);
    }
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
  document.addEventListener("visibilitychange", () => {
    if (session) applyTransmit();
  });
  // iOS keeps a suspended AudioContext silent until a gesture resumes it.
  const wake = () => {
    if (session) resumeAudio();
  };
  for (const type of ["touchend", "click", "keydown"]) window.addEventListener(type, wake, { capture: true, passive: true });
  window.addEventListener("beforeunload", () => {
    if (session?.announced) sendState(null);
  });
  // a channel that disappears takes its call with it
  useChannels.subscribe((st, prev) => {
    const s = session;
    if (!s || !prev.byId[s.channelId] || st.byId[s.channelId]) return;
    // A reconnect empties the list and fills it again in the same turn, so
    // only a channel still missing afterwards has really gone. The server
    // does not end our call when a DM is closed, so it is told.
    queueMicrotask(() => {
      if (session === s && !useChannels.getState().byId[s.channelId]) void leaveVoice(true);
    });
  });
}
