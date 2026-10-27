/** RNNoise probability gating, as used by noise-suppression-for-voice: retain consonant onsets and speech tails. */
export class SpeechGate {
  private hold = 0;
  private gain = 1;
  private readonly frames = Array.from({ length: 3 }, () => new Float32Array(480));
  private readonly audible = [true, true, true];
  private index = 0;
  process(frame: Float32Array, probability: number): void {
    const speech = probability >= (this.hold ? 0.2 : 0.5);
    if (speech) { this.hold = 20; this.audible.fill(true); }
    else this.hold = Math.max(0, this.hold - 1);
    this.frames[this.index]!.set(frame);
    this.audible[this.index] = this.hold > 0;
    this.index = (this.index + 1) % 3;
    const target = this.audible[this.index] ? 1 : 0.02;
    const old = this.frames[this.index]!;
    for (let i = 0; i < 480; ++i) {
      this.gain += (target - this.gain) * (target > this.gain ? 0.02 : 0.002);
      frame[i] = old[i]! * this.gain;
    }
  }
}
