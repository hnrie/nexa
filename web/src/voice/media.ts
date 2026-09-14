/**
 * Local media: microphone, camera and screen capture with the user's voice
 * settings applied, plus a small RMS level meter used for voice activity and
 * the settings page.
 */
import type { ShareFps, ShareResolution, VoiceSettings } from "@/stores/settings";
import { shareVideoConstraints } from "./shareQuality";

/** Why the microphone that opened is the one that opened. */
export type InputChoice = "default" | "chosen" | "matched-by-name" | "missing";

let lastChoice: InputChoice = "default";

/** How the last microphone was picked, for the settings page to explain. */
export function lastInputChoice(): InputChoice {
  return lastChoice;
}

function micConstraints(v: VoiceSettings): MediaTrackConstraints {
  return {
    echoCancellation: v.echoCancellation,
    noiseSuppression: v.noiseSuppression,
    autoGainControl: v.autoGain,
    channelCount: 1,
  };
}

/**
 * Opens the microphone the person chose.
 *
 * The device is asked for exactly, not as a preference: a preference is
 * silently ignored when the id no longer matches anything, and the call then
 * carries a different microphone than the one on screen. When the id has gone
 * stale the device is looked up again by name, which also covers the same
 * microphone on another computer, where ids never match.
 */
export async function getMic(v: VoiceSettings): Promise<MediaStream> {
  const audio = micConstraints(v);
  if (!v.inputDeviceId && !v.inputDeviceLabel) {
    lastChoice = "default";
    return navigator.mediaDevices.getUserMedia({ audio, video: false });
  }
  if (v.inputDeviceId) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...audio, deviceId: { exact: v.inputDeviceId } }, video: false });
      lastChoice = "chosen";
      return stream;
    } catch (err) {
      if (err instanceof DOMException && err.name !== "OverconstrainedError" && err.name !== "NotFoundError") throw err;
    }
  }
  if (v.inputDeviceLabel) {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const match = all.find((d) => d.kind === "audioinput" && d.label === v.inputDeviceLabel && d.deviceId && d.deviceId !== "default");
      if (match) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...audio, deviceId: { exact: match.deviceId } }, video: false });
        lastChoice = "matched-by-name";
        return stream;
      }
    } catch {
      /* fall through to the default below */
    }
  }
  lastChoice = "missing";
  return navigator.mediaDevices.getUserMedia({ audio, video: false });
}

export type CameraFacing = "user" | "environment";

export async function getCamera(facing: CameraFacing = "user"): Promise<MediaStream> {
  const video: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: { ideal: facing } };
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

/** Whether this device has more than one camera to switch between. */
export async function hasSeveralCameras(): Promise<boolean> {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    return list.filter((d) => d.kind === "videoinput").length > 1;
  } catch {
    return false;
  }
}

/** Whether this browser can share a screen at all; phone browsers cannot. */
export const canShareScreen = typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";

let shareAudioAsked = false;

/** Whether the share being picked right now asked for sound; the desktop app's picker follows it. */
export function shareAudioRequested(): boolean {
  return shareAudioAsked;
}

/**
 * Whether a captured audio track is the whole system's sound with this app's
 * own playback still in it. restrictOwnAudio is only a request: where the
 * system cannot honour it the capture keeps the call's sound, and everyone
 * else would hear themselves echo back through the share.
 */
export function echoesOwnAudio(settings: MediaTrackSettings & { restrictOwnAudio?: boolean }): boolean {
  const id = typeof settings.deviceId === "string" ? settings.deviceId : "";
  if (!id.startsWith("loopback")) return false;
  return settings.restrictOwnAudio !== true && id !== "loopbackWithoutChrome";
}

export interface ScreenCapture {
  stream: MediaStream;
  /** Sound was asked for and came, but with the call in it, so it was left out. */
  droppedEchoingAudio: boolean;
}

export async function getScreen(res: ShareResolution, fps: ShareFps, withAudio = true): Promise<ScreenCapture> {
  const video = shareVideoConstraints(res, fps);
  // System audio where the browser allows it (Chrome asks per window or tab).
  // restrictOwnAudio leaves this app's own sound out of it, the call included:
  // without it everyone in the call hears themselves come back through the
  // share. Chrome honours it for system audio on Windows, and the desktop app
  // swaps its loopback for one that skips its own playback.
  const audio = withAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48000, channelCount: 2, restrictOwnAudio: true, suppressLocalAudioPlayback: false } : false;
  const opts = { video, audio, systemAudio: withAudio ? "include" : "exclude", surfaceSwitching: "include", selfBrowserSurface: "exclude" } as DisplayMediaStreamOptions & { systemAudio: string; surfaceSwitching: string; selfBrowserSurface: string };
  shareAudioAsked = withAudio;
  const stream = await navigator.mediaDevices.getDisplayMedia(opts);
  let droppedEchoingAudio = false;
  for (const t of stream.getAudioTracks()) {
    if (!echoesOwnAudio(t.getSettings())) continue;
    t.stop();
    stream.removeTrack(t);
    droppedEchoingAudio = true;
  }
  // Under a squeezed connection the encoder gives up detail or smoothness.
  // Whoever picked 60 fps wants motion kept; anything slower is usually text.
  const track = stream.getVideoTracks()[0];
  if (track && "contentHint" in track) track.contentHint = fps >= 60 ? "motion" : "detail";
  return { stream, droppedEchoingAudio };
}

export interface Devices {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
}

export async function listDevices(): Promise<Devices> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    inputs: all.filter((d) => d.kind === "audioinput"),
    outputs: all.filter((d) => d.kind === "audiooutput"),
    cameras: all.filter((d) => d.kind === "videoinput"),
  };
}

/** RMS level meter over an audio stream; level() is 0..1. */
export class LevelMeter {
  private analyser: AnalyserNode;
  private source: MediaStreamAudioSourceNode;
  private buf: Float32Array<ArrayBuffer>;

  constructor(ctx: AudioContext, stream: MediaStream) {
    this.source = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.4;
    this.source.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize) as Float32Array<ArrayBuffer>;
  }

  level(): number {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i]! * this.buf[i]!;
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 4);
  }

  close(): void {
    try {
      this.source.disconnect();
      this.analyser.disconnect();
    } catch {
      /* already closed */
    }
  }
}

/** Sensitivity in dBFS (-100..0) to a 0..1 threshold comparable with LevelMeter.level(). */
export function sensitivityToThreshold(db: number): number {
  return Math.min(1, Math.max(0.005, Math.pow(10, db / 20) * 4));
}

let sharedCtx: AudioContext | null = null;

/**
 * One AudioContext for meters and playback. The rate is left to the device:
 * asking for 48 kHz makes Chrome resample some USB microphones, and a few of
 * them come out silent when it does.
 */
export function audioContext(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  if (sharedCtx.state === "suspended") void sharedCtx.resume();
  return sharedCtx;
}

/**
 * Wakes the shared AudioContext during a tap or key press. iOS only lets a
 * suspended context start inside a gesture, and without a live microphone
 * (say its permission was refused) nothing else would ever get it running.
 */
export function resumeAudio(): void {
  if (sharedCtx && sharedCtx.state !== "running") void sharedCtx.resume().catch(() => {});
}

/**
 * The stream a call would send: the microphone through the input slider. At
 * 100% there is nothing to apply, so the microphone's own track goes out
 * untouched rather than through a graph that could go wrong.
 */
export function sentStream(ctx: AudioContext, mic: MediaStream, inputVolume: number): { stream: MediaStream; gain: GainNode | null; source: MediaStreamAudioSourceNode | null } {
  if (inputVolume === 100) return { stream: mic, gain: null, source: null };
  try {
    const src = ctx.createMediaStreamSource(mic);
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, inputVolume) / 100;
    const dest = ctx.createMediaStreamDestination();
    src.connect(gain).connect(dest);
    if (dest.stream.getAudioTracks().length === 0) {
      src.disconnect();
      return { stream: mic, gain: null, source: null };
    }
    return { stream: dest.stream, gain, source: src };
  } catch {
    return { stream: mic, gain: null, source: null };
  }
}

function choiceWords(c: InputChoice): string {
  switch (c) {
    case "chosen":
      return "the one you picked";
    case "matched-by-name":
      return "found again by name after its id changed";
    case "missing":
      return "NOT AVAILABLE — this is the system default instead";
    default:
      return "system default";
  }
}

/** What the microphone and the call are actually doing, in words. */
export function describeInput(ctx: AudioContext, mic: MediaStream, sent: MediaStream, inputVolume: number): string {
  const track = mic.getAudioTracks()[0];
  const st = track?.getSettings() ?? {};
  const out = sent.getAudioTracks()[0];
  const lines = [
    `device: ${track?.label || "unnamed"}`,
    `track: ${track?.readyState ?? "none"}, muted=${String(track?.muted ?? "?")}, enabled=${String(track?.enabled ?? "?")}`,
    `format: ${st.sampleRate ?? "?"} Hz, ${st.channelCount ?? "?"} channel(s)`,
    `processing: echo=${String(st.echoCancellation ?? "?")} noise=${String(st.noiseSuppression ?? "?")} gain=${String(st.autoGainControl ?? "?")}`,
    `audio engine: ${ctx.state}, ${Math.round(ctx.sampleRate)} Hz`,
    `input volume: ${inputVolume}% (${sent === mic ? "sent straight through" : "through the slider"})`,
    `chosen device: ${choiceWords(lastChoice)}`,
    `sent track: ${out?.readyState ?? "none"}`,
  ];
  return lines.join("\n");
}
