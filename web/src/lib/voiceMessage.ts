/**
 * Voice messages: recorded in the message box, sent as an encrypted audio
 * file with `voice` set, how long it runs and the shape of its sound (`wave`,
 * a byte of loudness per bar), so every app draws it at once without
 * downloading it first. Android records the same (data/VoiceMessages.kt).
 */

import { recordingInput } from "@/voice/recordingInput";
import { useSettings } from "@/stores/settings";

/** How many bars a voice message's shape has. */
export const WAVE_BARS = 48;
/** How many bars a voice message is drawn with: fewer than it carries, so each is wide enough to see and aim at. */
export const SHOWN_BARS = 32;
/** The longest recording: ten minutes, a few megabytes at most. */
export const MAX_SECONDS = 600;
/** Shorter than this is a slip of the finger, not a message. */
export const MIN_SECONDS = 0.5;

/**
 * Formats in the order they are tried. AAC in MP4 plays everywhere (every
 * browser, Android, the desktop app), so it goes first where the browser can
 * make it; Opus in WebM or Ogg otherwise.
 */
const TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"];

export function canRecordVoice(): boolean {
  return typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

function recordType(): string | undefined {
  return TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
}

/** A file name to match what it holds, for whoever downloads it. */
export function voiceFileName(type: string, at = new Date()): string {
  const ext = type.startsWith("audio/mp4") ? "m4a" : type.startsWith("audio/ogg") ? "ogg" : "webm";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `voice-message-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}.${ext}`;
}

/** Loudness samples (any number, 0 and up) to `bars` bars from 0 to 1, the loudest reaching the top. */
export function shapeOf(levels: number[], bars = WAVE_BARS): number[] {
  if (!levels.length) return Array.from({ length: bars }, () => 0);
  const out: number[] = [];
  for (let b = 0; b < bars; b++) {
    const from = Math.floor((b * levels.length) / bars);
    const to = Math.max(from + 1, Math.floor(((b + 1) * levels.length) / bars));
    let peak = 0;
    for (let i = from; i < to && i < levels.length; i++) peak = Math.max(peak, levels[i]!);
    out.push(peak);
  }
  const top = Math.max(...out, 1e-6);
  return out.map((v) => Math.min(1, v / top));
}

/** A shape as it travels: a byte a bar, in base64. */
export function encodeWave(shape: number[]): string {
  let s = "";
  for (const v of shape.slice(0, 96)) s += String.fromCharCode(Math.round(Math.max(0, Math.min(1, v)) * 255));
  return btoa(s);
}

/** The bars of a received shape, from 0 to 1; null when it cannot be read. */
export function decodeWave(wave: string | undefined): number[] | null {
  if (!wave) return null;
  try {
    const s = atob(wave);
    if (!s.length) return null;
    return Array.from(s, (c) => c.charCodeAt(0) / 255);
  } catch {
    return null;
  }
}

export interface Recording {
  blob: Blob;
  type: string;
  duration: number;
  wave: string;
}

export interface Recorder {
  /** Seconds recorded so far. */
  elapsed(): number;
  /** The loudness now, from 0 to 1, for the bars drawn while recording. */
  level(): number;
  /** Ends the recording; null when it was too short to keep. */
  stop(): Promise<Recording | null>;
  /** Ends it and throws it away. */
  cancel(): void;
}

/**
 * Starts recording from the microphone chosen in Voice & Video, with the
 * call's Enhanced noise suppression and echo cancellation, without capture gain boosts. `onLimit` is called when
 * the recording reaches MAX_SECONDS and has stopped by itself.
 */
export async function startRecording(onLimit: () => void): Promise<Recorder> {
  const input = await recordingInput(useSettings.getState().settings.voice);
  const { stream } = input;
  const type = recordType();
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 128_000 });
  } catch (err) {
    input.release();
    throw err;
  }
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  // the loudness, read from the same stream: what the bars show is what is being kept
  const ctx = input.ctx;
  const analyser = ctx?.createAnalyser() ?? null;
  if (ctx && analyser) {
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    void ctx.resume().catch(() => undefined);
  }
  const buf = new Float32Array(analyser?.fftSize ?? 0);
  const levels: number[] = [];
  let now = 0;
  const sample = () => {
    if (!analyser) return;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
    // speech sits far below full scale: lifted so a normal voice fills most of the height
    now = Math.min(1, Math.sqrt(sum / buf.length) * 4);
    levels.push(now);
  };
  const started = performance.now();
  let ended = 0;
  const elapsed = () => ((ended || performance.now()) - started) / 1000;
  const tick = setInterval(() => {
    sample();
    if (elapsed() >= MAX_SECONDS) onLimit();
  }, 50);
  const release = () => {
    clearInterval(tick);
    ended ||= performance.now();
    input.release();
  };
  rec.start(1000);
  return {
    elapsed,
    level: () => now,
    cancel() {
      rec.ondataavailable = null;
      if (rec.state !== "inactive") rec.stop();
      release();
    },
    stop() {
      return new Promise((resolve) => {
        const finish = () => {
          release();
          const duration = Math.min(MAX_SECONDS, elapsed());
          if (duration < MIN_SECONDS || !chunks.length) return resolve(null);
          const kind = (rec.mimeType || type || "audio/webm").split(";")[0]!;
          resolve({ blob: new Blob(chunks, { type: kind }), type: kind, duration: Math.round(duration * 10) / 10, wave: encodeWave(shapeOf(levels)) });
        };
        if (rec.state === "inactive") return finish();
        rec.onstop = finish;
        rec.stop();
      });
    },
  };
}
