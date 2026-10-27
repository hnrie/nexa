import { describe, expect, it } from "vitest";
import { SpeechGate } from "./speechGate";

const rms = (a: Float32Array) => Math.sqrt(a.reduce((sum, x) => sum + x * x, 0) / a.length);
describe("neural speech gate", () => {
  it("attenuates residual non-speech noise without amplifying it", () => {
    const gate = new SpeechGate();
    let block = new Float32Array(480);
    for (let i = 0; i < 100; ++i) { block.fill(1000); gate.process(block, 0.01); }
    expect(rms(block)).toBeCloseTo(20, 1);
  });
  it("keeps quiet speech at its original level and retains its tail", () => {
    const gate = new SpeechGate();
    const block = new Float32Array(480);
    for (let i = 0; i < 100; ++i) { block.fill(3); gate.process(block, .9); }
    expect(rms(block)).toBeCloseTo(3, 4);
    for (let i = 0; i < 10; ++i) { block.fill(3); gate.process(block, .01); }
    expect(rms(block)).toBeCloseTo(3, 4);
  });
  it("opens the buffered onset when speech is detected in the next frame", () => {
    const gate = new SpeechGate();
    const block = new Float32Array(480);
    for (let i = 0; i < 100; ++i) { block.fill(0); gate.process(block, .01); }
    block.fill(500); gate.process(block, .01);
    block.fill(500); gate.process(block, .9);
    block.fill(500); gate.process(block, .9);
    expect(block[479]).toBeGreaterThan(499);
  });
});
