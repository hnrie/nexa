/**
 * What a call carries of this device's microphone, and when it is silent.
 *
 * The call carries a copy of the microphone's track, never the track itself.
 * Voice activity, push to talk and mute silence the copy, which goes on sending
 * silence (with DTX, a packet every 400 ms: see opus.ts), so every packet's
 * timestamp keeps pace with the clock. The meter listens to the microphone
 * itself and opens the copy again the moment speech starts.
 *
 * Calls used to take their track away between phrases instead (replaceTrack
 * with null). Nothing at all was sent in a pause, and the first packet after
 * it carried the timestamp that followed on from the last one before it, so
 * to every listener's jitter buffer it looked held up in the network for as
 * long as the pause had lasted. The buffers grew to cover a delay that never
 * happened: a call with no network delay at all played every phrase after the
 * first pause about 0.7 s late, and a call across a country later still.
 */
export class VoiceSend {
  private source: MediaStreamTrack | null = null;
  private copy: MediaStreamTrack | null = null;
  private open = false;

  /** The copy the call sends of `source`, made again whenever the source changes; null for none. */
  track(source: MediaStreamTrack | null): MediaStreamTrack | null {
    if (source === this.source) return this.copy;
    this.copy?.stop();
    this.source = source;
    this.copy = source ? source.clone() : null;
    if (this.copy) this.copy.enabled = this.open;
    return this.copy;
  }

  /** Lets the voice through, or silences it. */
  setOpen(open: boolean): void {
    this.open = open;
    if (this.copy) this.copy.enabled = open;
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Lets go of the copy; the microphone itself is its owner's to stop. */
  stop(): void {
    this.copy?.stop();
    this.copy = null;
    this.source = null;
  }
}
