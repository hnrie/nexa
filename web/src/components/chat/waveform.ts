/**
 * A voice note's real loudness, as a row of bars: the file is decoded once,
 * on this device (it is already here, decrypted), and each bar is the
 * loudness of its slice of the recording. The shape it replaced was drawn
 * from a hash of the file name, so every "audio.m4a" looked the same and a
 * silence looked like a shout.
 */

/** How many bars a player draws. */
export const BARS = 48;
/** Past this, decoding costs more memory than a picture of the sound is worth. */
const MAX_BYTES = 15 * 1024 * 1024;
/** Shapes already worked out, by attachment; a voice-note channel has a few dozen. */
const cache = new Map<string, number[]>();
const CACHE_MAX = 300;

/** Bars from samples: the loudness (RMS) of each slice, scaled so the loudest reaches the top. */
export function barsOf(samples: Float32Array, bars = BARS): number[] {
  const out: number[] = [];
  const per = Math.max(1, Math.floor(samples.length / bars));
  for (let b = 0; b < bars; b++) {
    const from = b * per;
    const to = Math.min(samples.length, from + per);
    let sum = 0;
    for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!;
    out.push(to > from ? Math.sqrt(sum / (to - from)) : 0);
  }
  const peak = Math.max(...out, 1e-6);
  // a floor, so a quiet stretch is still a bar that can be seen and aimed at
  return out.map((v) => 0.12 + 0.88 * Math.min(1, v / peak));
}

/** The shape of a decrypted recording at `src` (a blob: address), or null when it cannot be worked out here. */
export async function waveform(key: string, src: string): Promise<number[] | null> {
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof window === "undefined" || !src.startsWith("blob:")) return null;
  const Ctx = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctx) return null;
  try {
    const bytes = await (await fetch(src)).arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) return null;
    // an offline context decodes without the audio hardware, and without a tap first
    const audio = await new Ctx(1, 1, 44100).decodeAudioData(bytes);
    const shape = barsOf(audio.getChannelData(0));
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, shape);
    return shape;
  } catch {
    return null;
  }
}
