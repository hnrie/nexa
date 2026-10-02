/**
 * Enhanced noise suppression: RNNoise (xiph's small recurrent network for
 * taking noise out of speech), run on this device in an AudioWorklet before
 * the microphone reaches the call. Keyboards, fans, traffic and the hum of a
 * room are taken out of what is sent; the voice is left.
 *
 * It needs AudioWorklet and WebAssembly, which every browser Nexa supports
 * has, and an audio engine running at 48 kHz, the rate RNNoise works at, which
 * media.ts asks for. Where it cannot start, the call uses the browser's own
 * noise suppression instead (engine.ts says so once).
 *
 * The node and its WebAssembly come from @sapphi-red/web-noise-suppressor
 * (MIT), built on @shiguredo/rnnoise-wasm (Apache-2.0) and RNNoise (BSD).
 */
import workletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import wasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import simdUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";

/** The rate RNNoise works at, and so the rate the audio engine is asked for. */
export const DENOISE_RATE = 48000;

// The package is loaded the first time it is wanted: it is only needed in a
// call or a microphone test, and its node is declared as a class extending
// AudioWorkletNode, which has to exist by the time the module runs.
type Package = typeof import("@sapphi-red/web-noise-suppressor");
let pkg: Promise<Package> | null = null;
let binary: Promise<ArrayBuffer> | null = null;
const prepared = new WeakMap<BaseAudioContext, Promise<boolean>>();

/** Loads RNNoise into an audio context once; false where it cannot run there. */
export function prepareDenoiser(ctx: AudioContext): Promise<boolean> {
  let ready = prepared.get(ctx);
  if (!ready) {
    ready = (async () => {
      if (ctx.sampleRate !== DENOISE_RATE || !ctx.audioWorklet || typeof WebAssembly === "undefined") return false;
      pkg ??= import("@sapphi-red/web-noise-suppressor");
      const { loadRnnoise } = await pkg;
      binary ??= loadRnnoise({ url: wasmUrl, simdUrl });
      const [, wasm] = await Promise.all([ctx.audioWorklet.addModule(workletUrl), binary]);
      return wasm.byteLength > 0;
    })().catch(() => {
      // a failed fetch is tried again by the next call rather than remembered
      pkg = null;
      binary = null;
      prepared.delete(ctx);
      return false;
    });
    prepared.set(ctx, ready);
  }
  return ready;
}

/** A node that takes the noise out of a voice, or null where RNNoise cannot run. Let go of it with releaseDenoiser. */
export async function makeDenoiser(ctx: AudioContext): Promise<AudioNode | null> {
  if (!(await prepareDenoiser(ctx)) || !binary || !pkg) return null;
  try {
    const { RnnoiseWorkletNode } = await pkg;
    // each node is handed its own copy, which goes across to the audio thread
    return new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: (await binary).slice(0) });
  } catch {
    return null;
  }
}

/** Disconnects a denoiser and frees what RNNoise holds for it on the audio thread. */
export function releaseDenoiser(node: AudioNode | null): void {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    /* already disconnected */
  }
  (node as AudioNode & { destroy?: () => void }).destroy?.();
}
