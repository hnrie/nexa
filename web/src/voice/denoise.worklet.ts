import { Rnnoise, type DenoiseState } from "@shiguredo/rnnoise-wasm";
import { SpeechGate } from "./speechGate";

declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor { port: MessagePort; }

class DenoiseProcessor extends AudioWorkletProcessor {
  private state: DenoiseState | null = null;
  private destroyed = false;
  private readonly frame = new Float32Array(480);
  private readonly fifo = new Float32Array(4096);
  private readonly gate = new SpeechGate();
  private fill = 0;
  private read = 0;
  private write = 0;
  private count = 0;
  constructor() {
    super();
    this.port.onmessage = ({ data }) => { if (data === "destroy") { this.destroyed = true; this.state?.destroy(); this.state = null; } };
    // The embedded Emscripten build uses a window/worker sentinel but no DOM APIs.
    // AudioWorkletGlobalScope has neither sentinel; provide it only during initialization.
    const scope = globalThis as typeof globalThis & { window?: unknown };
    Object.defineProperty(scope, "window", { value: globalThis, configurable: true });
    void Rnnoise.load().finally(() => { Reflect.deleteProperty(scope, "window"); }).then((module) => {
      if (sampleRate !== 48000) throw new Error("sample rate");
      if (this.destroyed) return;
      this.state = module.createDenoiseState();
      this.port.postMessage("ready");
    }).catch(() => this.port.postMessage("failed"));
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.destroyed) return false;
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    if (!this.state || !input) { output.fill(0); return true; }
    for (let i = 0; i < output.length; ++i) {
      this.frame[this.fill++] = (input[i] ?? 0) * 32768;
      if (this.fill === 480) {
        const probability = this.state.processFrame(this.frame);
        this.gate.process(this.frame, probability);
        for (let j = 0; j < 480; ++j) { this.fifo[this.write] = this.frame[j]! / 32768; this.write = (this.write + 1) % 4096; }
        this.count += 480; this.fill = 0;
      }
      output[i] = this.count ? this.fifo[this.read]! : 0;
      if (this.count) { this.read = (this.read + 1) % 4096; --this.count; }
    }
    return true;
  }
}
registerProcessor("nexa-denoise", DenoiseProcessor);
