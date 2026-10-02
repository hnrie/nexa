/**
 * When someone counts as speaking, for the green ring. Speech is full of short
 * gaps between syllables and words, and following the level reading by reading
 * made the ring blink on and off several times a second. It lights up on the
 * first loud reading and goes out only once it has been quiet for a while.
 */

/** How long it stays lit after the last loud reading. */
export const SPEAKING_HOLD_MS = 600;

/**
 * The level (LevelMeter's, 0–1) above which sound can be heard, and so lights
 * a ring. The ring says sound is coming through: everyone's, worked out from
 * what arrives (playback.ts), and this device's own, from what it sends while
 * its microphone is open (engine.ts). It sits below the lowest level that can
 * open a microphone (sensitivityToThreshold's 0.005), so anything let through
 * lights the ring. It was 0.02 for other people, above where many people set
 * their sensitivity, and quiet sound came through with no ring.
 */
export const AUDIBLE_LEVEL = 0.004;

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
