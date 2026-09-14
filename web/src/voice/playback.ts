/**
 * Plays other people's call audio through WebAudio, so one person can be
 * turned up past 100 %, muted just here, silenced by deafen, and sent to a
 * chosen output device. Their screen share's sound only plays while it is
 * watched. Shared by both call transports.
 */
import { LevelMeter, audioContext } from "./media";
import { SpeakingGate } from "./speaking";

interface VoiceOut {
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  el: HTMLAudioElement;
  meter: LevelMeter;
  timer: ReturnType<typeof setInterval> | null;
  speaking: boolean;
}

interface ScreenOut {
  stream: MediaStream;
  track: MediaStreamTrack | undefined;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  el: HTMLAudioElement;
}

export class Playback {
  private voices = new Map<string, VoiceOut>();
  private screens = new Map<string, ScreenOut>();
  private outputMuted = false;
  /** Master output level, 0–200 %, from settings. */
  private masterVolume = 100;
  private volumes = new Map<string, number>();
  private localMutes = new Set<string>();
  /** Whose screen shares are being watched; the others' share audio stays silent. */
  private watching = new Set<string>();

  constructor(private onSpeaking: (userId: string, speaking: boolean) => void) {}

  /** Starts playing someone's voice, replacing what played for them before. */
  attachVoice(userId: string, stream: MediaStream): void {
    this.detachVoice(userId);
    const ctx = audioContext();
    // Chrome only delivers remote WebRTC audio into WebAudio when an element also plays it
    const el = document.createElement("audio");
    el.srcObject = stream;
    el.muted = true;
    el.autoplay = true;
    el.setAttribute("data-voice-peer", userId);
    document.body.appendChild(el);
    void el.play().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = this.effectiveGain(userId);
    source.connect(gain).connect(ctx.destination);
    const meter = new LevelMeter(ctx, stream);
    const gate = new SpeakingGate();
    const out: VoiceOut = { source, gain, el, meter, timer: null, speaking: false };
    out.timer = setInterval(() => {
      const loud = gate.update(meter.level() > 0.02, Date.now());
      // someone muted just here shows no ring, straight away
      const on = loud && !this.localMutes.has(userId);
      if (on !== out.speaking) {
        out.speaking = on;
        this.onSpeaking(userId, on);
      }
    }, 100);
    this.voices.set(userId, out);
  }

  detachVoice(userId: string): void {
    const out = this.voices.get(userId);
    if (!out) return;
    this.voices.delete(userId);
    if (out.timer) clearInterval(out.timer);
    out.meter.close();
    try {
      out.source.disconnect();
      out.gain.disconnect();
    } catch {
      /* already gone */
    }
    out.el.srcObject = null;
    out.el.remove();
    if (out.speaking) this.onSpeaking(userId, false);
  }

  /** Plays the sound of someone's screen share, while it is watched. */
  attachScreenAudio(userId: string, stream: MediaStream): void {
    this.detachScreenAudio(userId);
    const ctx = audioContext();
    const el = document.createElement("audio");
    el.srcObject = new MediaStream(stream.getAudioTracks());
    el.muted = true;
    el.autoplay = true;
    el.setAttribute("data-voice-screen", userId);
    document.body.appendChild(el);
    void el.play().catch(() => {});
    const source = ctx.createMediaStreamSource(el.srcObject as MediaStream);
    const gain = ctx.createGain();
    gain.gain.value = this.screenGain(userId);
    source.connect(gain).connect(ctx.destination);
    const track = stream.getAudioTracks()[0];
    this.screens.set(userId, { stream, track, source, gain, el });
    track?.addEventListener(
      "ended",
      () => {
        if (this.screens.get(userId)?.track === track) this.detachScreenAudio(userId);
      },
      { once: true },
    );
  }

  /** The stream whose sound is playing as someone's share, if any. */
  screenAudioStream(userId: string): MediaStream | null {
    return this.screens.get(userId)?.stream ?? null;
  }

  detachScreenAudio(userId: string): void {
    const out = this.screens.get(userId);
    if (!out) return;
    this.screens.delete(userId);
    try {
      out.source.disconnect();
      out.gain.disconnect();
    } catch {
      /* already gone */
    }
    out.el.srcObject = null;
    out.el.remove();
  }

  /** Stops everything playing for someone. */
  detach(userId: string): void {
    this.detachVoice(userId);
    this.detachScreenAudio(userId);
  }

  close(): void {
    for (const id of new Set([...this.voices.keys(), ...this.screens.keys()])) this.detach(id);
  }

  // --- levels --------------------------------------------------------------

  private effectiveGain(userId: string): number {
    if (this.outputMuted || this.localMutes.has(userId)) return 0;
    return ((this.volumes.get(userId) ?? 100) / 100) * (this.masterVolume / 100);
  }

  /** A share is offered, not forced: its sound only plays while it is watched. */
  private screenGain(userId: string): number {
    return this.watching.has(userId) ? this.effectiveGain(userId) : 0;
  }

  private applyGains(): void {
    for (const [id, out] of this.voices) out.gain.gain.value = this.effectiveGain(id);
    for (const [id, out] of this.screens) out.gain.gain.value = this.screenGain(id);
  }

  setWatching(userId: string, on: boolean): void {
    if (on) this.watching.add(userId);
    else this.watching.delete(userId);
    this.applyGains();
  }

  isWatching(userId: string): boolean {
    return this.watching.has(userId);
  }

  setVolume(userId: string, pct: number): void {
    this.volumes.set(userId, pct);
    this.applyGains();
  }

  setLocalMute(userId: string, on: boolean): void {
    if (on) this.localMutes.add(userId);
    else this.localMutes.delete(userId);
    this.applyGains();
  }

  setOutputMuted(on: boolean): void {
    this.outputMuted = on;
    this.applyGains();
  }

  /** Master output level for everyone, 0–200 %. */
  setMasterVolume(pct: number): void {
    this.masterVolume = Math.max(0, Math.min(200, pct));
    this.applyGains();
  }

  async setOutputDevice(deviceId: string | null): Promise<void> {
    const ctx = audioContext() as AudioContext & { setSinkId?: (id: string | { type: "none" }) => Promise<void> };
    if (typeof ctx.setSinkId === "function") await ctx.setSinkId(deviceId ?? "").catch(() => {});
  }
}
