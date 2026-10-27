/** Modern Xiph RNNoise with speech probability gating, after browser echo cancellation. */
import workletUrl from "./denoise.worklet.ts?worker&url";
export const DENOISE_RATE = 48000;
const prepared = new WeakMap<AudioContext, Promise<boolean>>();
export function prepareDenoiser(ctx: AudioContext): Promise<boolean> {
  let ready = prepared.get(ctx);
  if (!ready) {
    ready = (async () => {
      if (ctx.sampleRate !== DENOISE_RATE || !ctx.audioWorklet) return false;
      await ctx.audioWorklet.addModule(workletUrl);
      return true;
    })().catch(() => { prepared.delete(ctx); return false; });
    prepared.set(ctx, ready);
  }
  return ready;
}
export async function makeDenoiser(ctx: AudioContext): Promise<AudioNode | null> {
  if (!await prepareDenoiser(ctx)) return null;
  const node = new AudioWorkletNode(ctx, "nexa-denoise", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1 });
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { releaseDenoiser(node); resolve(null); }, 15000);
    node.port.onmessage = ({ data }) => {
      clearTimeout(timeout);
      node.port.onmessage = null;
      if (data === "ready") resolve(node);
      else { releaseDenoiser(node); resolve(null); }
    };
    node.onprocessorerror = () => { clearTimeout(timeout); releaseDenoiser(node); resolve(null); };
  });
}
export function releaseDenoiser(node: AudioNode | null): void {
  if (!node) return;
  node.disconnect();
  if (node instanceof AudioWorkletNode) { node.port.postMessage("destroy"); node.port.close(); }
}
