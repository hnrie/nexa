/**
 * When someone counts as speaking, for the green ring. Speech is full of short
 * gaps between syllables and words, and following the level reading by reading
 * made the ring blink on and off several times a second. It lights up on the
 * first loud reading and goes out only once it has been quiet for a while.
 */

/** How long it stays lit after the last loud reading. */
export const SPEAKING_HOLD_MS = 600;

export class SpeakingGate {
  private until = 0;

  constructor(private readonly holdMs = SPEAKING_HOLD_MS) {}

  /** Takes one reading and says whether they count as speaking now. */
  update(loud: boolean, now: number): boolean {
    if (loud) this.until = now + this.holdMs;
    return now < this.until;
  }

  /** Muted or cut off: out straight away. */
  reset(): void {
    this.until = 0;
  }
}
