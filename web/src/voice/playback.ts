/**
 * Plays other people's call audio through WebAudio, so one person can be
 * turned up past 100 %, muted just here, silenced by deafen, and sent to a
 * chosen output device. Their screen share's sound only plays while it is
 * watched. Shared by both call transports.
 */
import { LevelMeter, audioContext } from "./media";
import { AUDIBLE_LEVEL, SpeakingGate } from "./speaking";

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

type SinkContext = AudioContext & { setSinkId?: (id: string | { type: "none" }) => Promise<void> };
type SinkElement = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

/**
 * Where call audio goes when the audio context cannot pick a device itself
 * (Firefox): into a stream that one element plays on the chosen device. Null
 * while the context's own output is used. Shared, like the context.
 */
let routed: { dest: MediaStreamAudioDestinationNode; el: SinkElement } | null = null;
/** Every Playback, so a change of device reaches all of them. */
const players = new Set<Playback>();

function outputOf(ctx: AudioContext): AudioNode {
  return routed?.dest ?? ctx.destination;
}

/** Everyone else's level while a Priority Speaker talks, as Discord does: about 12 dB down. */
export const PRIORITY_DUCK = 0.25;

export class Playback {
  private voices = new Map<string, VoiceOut>();
  private screens = new Map<string, ScreenOut>();
  private outputMuted = false;
  /** Master output level, 0–200 %, from settings. */
  private masterVolume = 100;
  private volumes = new Map<string, number>();
  private localMutes = new Set<string>();
  /**
   * People a moderator muted or deafened in the server. Their own app sends
   * nothing then; this keeps them silent here too, should an app keep sending.
   */
  private modMutes = new Set<string>();
  /** People talking as Priority Speaker: while one of them is heard, everyone else is turned down. */
  private priority = new Set<string>();
  /** A screen share's sound has its own level and mute, apart from the person's voice. */
  private streamVolumes = new Map<string, number>();
  private streamMutes = new Set<string>();
  /** Whose screen shares are being watched; the others' share audio stays silent. */
  private watching = new Set<string>();
  /**
   * Sound held silent until it is known to be opened ("voice:<id>", "screen:<id>"):
   * a track whose frames skip decryption plays noise at full volume.
   */
  private held = new Set<string>();

  constructor(private onSpeaking: (userId: string, speaking: boolean) => void) {
    players.add(this);
  }

  /** Sends everything playing to wherever call audio goes now (see setOutputDevice). */
  reroute(): void {
    const ctx = audioContext();
    for (const out of [...this.voices.values(), ...this.screens.values()]) {
      try {
        out.gain.disconnect();
        out.gain.connect(outputOf(ctx));
      } catch {
        /* already gone */
      }
    }
  }

  /** Starts playing someone's voice, replacing what played for them before; `held` keeps it silent until setHeld lets it go. */
  attachVoice(userId: string, stream: MediaStream, held = false): void {
    this.detachVoice(userId);
    if (held) this.held.add(`voice:${userId}`);
    else this.held.delete(`voice:${userId}`);
    const ctx = audioContext();
    // Chrome only delivers remote WebRTC audio into WebAudio when an element also plays it
    const el = document.createElement("audio");
    el.srcObject = stream;
    el.muted = true;
    el.autoplay = true;
    el.setAttribute("data-voice-peer", userId);
    el.setAttribute("data-held", String(held));
    document.body.appendChild(el);
    void el.play().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = this.effectiveGain(userId);
    source.connect(gain).connect(outputOf(ctx));
    const meter = new LevelMeter(ctx, stream);
    const gate = new SpeakingGate();
    const out: VoiceOut = { source, gain, el, meter, timer: null, speaking: false };
    out.timer = setInterval(() => {
      // lit whenever their sound can be heard: a microphone that is shut sends silence
      const loud = gate.update(meter.level() > AUDIBLE_LEVEL, Date.now());
      // someone muted just here shows no ring, straight away, and neither does sound not yet known to be theirs
      const on = loud && !this.localMutes.has(userId) && !this.modMutes.has(userId) && !this.held.has(`voice:${userId}`);
      if (on !== out.speaking) {
        out.speaking = on;
        this.onSpeaking(userId, on);
        if (this.priority.has(userId)) this.applyGains();
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
    if (out.speaking) {
      this.onSpeaking(userId, false);
      if (this.priority.has(userId)) this.applyGains();
    }
  }

  /** Plays the sound of someone's screen share, while it is watched; `held` as for attachVoice. */
  attachScreenAudio(userId: string, stream: MediaStream, held = false): void {
    this.detachScreenAudio(userId);
    if (held) this.held.add(`screen:${userId}`);
    else this.held.delete(`screen:${userId}`);
    const ctx = audioContext();
    const el = document.createElement("audio");
    el.srcObject = new MediaStream(stream.getAudioTracks());
    el.muted = true;
    el.autoplay = true;
    el.setAttribute("data-voice-screen", userId);
    el.setAttribute("data-held", String(held));
    document.body.appendChild(el);
    void el.play().catch(() => {});
    const source = ctx.createMediaStreamSource(el.srcObject as MediaStream);
    const gain = ctx.createGain();
    gain.gain.value = this.screenGain(userId);
    source.connect(gain).connect(outputOf(ctx));
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
    players.delete(this);
  }

  // --- levels --------------------------------------------------------------

  /** Holds someone's voice or share sound silent, or lets it play. */
  setHeld(userId: string, kind: "voice" | "screen", held: boolean): void {
    const key = `${kind}:${userId}`;
    if (held === this.held.has(key)) return;
    if (held) this.held.add(key);
    else this.held.delete(key);
    // said on the element too, where a test (or someone debugging) can see it
    (kind === "voice" ? this.voices : this.screens).get(userId)?.el.setAttribute("data-held", String(held));
    this.applyGains();
  }

  private effectiveGain(userId: string): number {
    if (this.outputMuted || this.localMutes.has(userId) || this.modMutes.has(userId) || this.held.has(`voice:${userId}`)) return 0;
    return ((this.volumes.get(userId) ?? 100) / 100) * (this.masterVolume / 100) * this.duck(userId);
  }

  /** How far someone is turned down while a Priority Speaker other than them is talking. */
  private duck(userId: string): number {
    for (const id of this.priority) if (id !== userId && this.voices.get(id)?.speaking) return PRIORITY_DUCK;
    return 1;
  }

  /** A share is offered, not forced: its sound only plays while it is watched, at the stream's own level. */
  private screenGain(userId: string): number {
    if (!this.watching.has(userId) || this.outputMuted || this.streamMutes.has(userId) || this.held.has(`screen:${userId}`)) return 0;
    return ((this.streamVolumes.get(userId) ?? 100) / 100) * (this.masterVolume / 100) * this.duck("");
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

  /** A moderator's mute or deafen of someone, from the call's voice states. */
  setModMuted(userId: string, on: boolean): void {
    if (on === this.modMutes.has(userId)) return;
    if (on) this.modMutes.add(userId);
    else this.modMutes.delete(userId);
    this.applyGains();
  }

  /** Whether someone is talking as Priority Speaker now, from the call's voice states. */
  setPriority(userId: string, on: boolean): void {
    if (on === this.priority.has(userId)) return;
    if (on) this.priority.add(userId);
    else this.priority.delete(userId);
    this.applyGains();
  }

  setStreamVolume(userId: string, pct: number): void {
    this.streamVolumes.set(userId, pct);
    this.applyGains();
  }

  setStreamMuted(userId: string, on: boolean): void {
    if (on) this.streamMutes.add(userId);
    else this.streamMutes.delete(userId);
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
    const ctx = audioContext() as SinkContext;
    if (typeof ctx.setSinkId === "function") {
      await ctx.setSinkId(deviceId ?? "").catch(() => {});
      return;
    }
    // Firefox picks a device only for elements: the call plays through one
    // on the chosen device, and through the context again for the default.
    if (typeof HTMLMediaElement === "undefined" || !("setSinkId" in HTMLMediaElement.prototype)) return;
    if (!deviceId) {
      if (!routed) return;
      const was = routed;
      routed = null;
      for (const p of players) p.reroute();
      was.el.pause();
      was.el.srcObject = null;
      return;
    }
    if (!routed) {
      const el: SinkElement = new Audio();
      el.autoplay = true;
      routed = { dest: ctx.createMediaStreamDestination(), el };
      el.srcObject = routed.dest.stream;
      for (const p of players) p.reroute();
    }
    const el = routed.el;
    await el.setSinkId?.(deviceId).catch(() => {});
    void el.play().catch(() => {});
  }
}
