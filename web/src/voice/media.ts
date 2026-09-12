/**
 * Local media: microphone, camera and screen capture with the user's voice
 * settings applied, plus a small RMS level meter used for voice activity and
 * the settings page.
 */
import type { VoiceSettings } from "@/stores/settings";

export type StreamQuality = VoiceSettings["streamQuality"];

export function qualityConstraints(q: StreamQuality): { width?: number; height?: number; frameRate: number } {
  switch (q) {
    case "720p30":
      return { width: 1280, height: 720, frameRate: 30 };
    case "1080p60":
      return { width: 1920, height: 1080, frameRate: 60 };
    case "source":
      return { frameRate: 60 };
    default:
      return { width: 1920, height: 1080, frameRate: 30 };
  }
}

/** Bitrate cap for a screen share at a quality, in bits per second. */
export function screenBitrate(q: StreamQuality): number {
  switch (q) {
    case "720p30":
      return 2_500_000;
    case "1080p60":
      return 8_000_000;
    case "source":
      return 12_000_000;
    default:
      return 5_000_000;
  }
}

export async function getMic(v: VoiceSettings): Promise<MediaStream> {
  const audio: MediaTrackConstraints = {
    echoCancellation: v.echoCancellation,
    noiseSuppression: v.noiseSuppression,
    autoGainControl: v.autoGain,
    channelCount: 1,
    sampleRate: 48000,
  };
  if (v.inputDeviceId) audio.deviceId = { ideal: v.inputDeviceId };
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

export async function getScreen(q: StreamQuality): Promise<MediaStream> {
  const c = qualityConstraints(q);
  const video: MediaTrackConstraints = { frameRate: { ideal: c.frameRate, max: c.frameRate } };
  if (c.width) video.width = { ideal: c.width };
  if (c.height) video.height = { ideal: c.height };
  // system audio where the browser allows it; Chrome asks per window/tab
  const opts = { video, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48000, channelCount: 2 }, systemAudio: "include", surfaceSwitching: "include", selfBrowserSurface: "exclude" } as DisplayMediaStreamOptions & { systemAudio: string; surfaceSwitching: string; selfBrowserSurface: string };
  return navigator.mediaDevices.getDisplayMedia(opts);
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

/** One AudioContext for meters and playback; resumed on first use. */
export function audioContext(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext({ sampleRate: 48000 });
  if (sharedCtx.state === "suspended") void sharedCtx.resume();
  return sharedCtx;
}
