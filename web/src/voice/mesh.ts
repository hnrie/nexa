/**
 * Full-mesh WebRTC transport: one RTCPeerConnection per remote participant,
 * perfect negotiation (the peer with the lower user id is polite), signalling
 * relayed through the gateway. Media is DTLS-SRTP peer to peer; the server
 * never sees it. Playback goes through WebAudio so per-user volume can exceed
 * 100 % and the output device can be chosen.
 */
import { LevelMeter, audioContext } from "./media";

export type MediaKind = "audio" | "video" | "screen";

export interface SignalPayload {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
  /** Which of my stream ids carries which kind, so the receiver can label tracks. */
  streams?: Partial<Record<MediaKind, string>>;
}

export interface TransportEvents {
  onSignal: (to: string, payload: SignalPayload) => void;
  onPeerState: (userId: string, state: RTCPeerConnectionState) => void;
  onRemoteStream: (userId: string, kind: MediaKind, stream: MediaStream | null) => void;
  onSpeaking: (userId: string, speaking: boolean) => void;
}

interface Peer {
  userId: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  remoteStreams: Partial<Record<MediaKind, string>>;
  pendingCandidates: RTCIceCandidateInit[];
  audioSender: RTCRtpSender | null;
  videoSender: RTCRtpSender | null;
  screenSenders: RTCRtpSender[];
  playback: { source: MediaStreamAudioSourceNode; gain: GainNode; el: HTMLAudioElement; meter: LevelMeter; timer: ReturnType<typeof setInterval> } | null;
  speaking: boolean;
  restartTimer: ReturnType<typeof setTimeout> | null;
  /** A negotiation we had to skip because the exchange was mid-flight. */
  renegotiate: boolean;
  /** Fires if the connection never comes up, so the peer can be rebuilt. */
  watchdog: ReturnType<typeof setTimeout> | null;
  attempts: number;
  /** Every description this peer touches runs through here, one at a time. */
  ops: Promise<void>;
}

function lower(a: string, b: string): boolean {
  if (a.length !== b.length) return a.length < b.length;
  return a < b;
}

/** How many early signals to hold for a peer we have not been told about yet. */
const EARLY_SIGNAL_LIMIT = 32;
/** How long to give a peer to come up before rebuilding it from scratch. */
const CONNECT_DEADLINE_MS = 12_000;
/** How many rebuilds before leaving the tile showing trouble. */
const MAX_REBUILDS = 3;

export class MeshTransport {
  private peers = new Map<string, Peer>();
  private audioTrack: MediaStreamTrack | null = null;
  private videoTrack: MediaStreamTrack | null = null;
  private screen: MediaStream | null = null;
  private audioStream = new MediaStream();
  private videoStream = new MediaStream();
  private screenStream = new MediaStream();
  private outputMuted = false;
  /** Master output level, 0–200 %, from settings. */
  private masterVolume = 100;
  private volumes = new Map<string, number>();
  /** Signals that beat the roster: an offer can arrive before we know the sender. */
  private early = new Map<string, SignalPayload[]>();
  private localMutes = new Set<string>();
  private screenBitrate = 5_000_000;
  private closed = false;

  constructor(
    private meId: string,
    private ice: RTCIceServer[],
    private events: TransportEvents,
  ) {}

  // --- local media -------------------------------------------------------

  setLocalAudio(track: MediaStreamTrack | null): void {
    this.audioTrack = track;
    this.audioStream = new MediaStream(track ? [track] : []);
    for (const p of this.peers.values()) this.syncSenders(p);
  }

  setLocalVideo(track: MediaStreamTrack | null): void {
    this.videoTrack = track;
    this.videoStream = new MediaStream(track ? [track] : []);
    for (const p of this.peers.values()) this.syncSenders(p);
  }

  setLocalScreen(stream: MediaStream | null, bitrate = 5_000_000): void {
    this.screen = stream;
    this.screenBitrate = bitrate;
    this.screenStream = stream ?? new MediaStream();
    for (const p of this.peers.values()) this.syncSenders(p);
  }

  // --- peers -------------------------------------------------------------

  /**
   * Starts a connection to one peer. Who offers first does not matter: both
   * sides offer as soon as they have media and the politeness rule settles
   * the collision.
   */
  addPeer(userId: string, attempts = 0): void {
    if (this.closed || this.peers.has(userId) || userId === this.meId) return;
    const pc = new RTCPeerConnection({ iceServers: this.ice, bundlePolicy: "max-bundle" });
    const peer: Peer = { userId, pc, polite: lower(this.meId, userId), makingOffer: false, ignoreOffer: false, remoteStreams: {}, pendingCandidates: [], audioSender: null, videoSender: null, screenSenders: [], playback: null, speaking: false, restartTimer: null, renegotiate: false, watchdog: null, attempts, ops: Promise.resolve() };
    this.peers.set(userId, peer);
    pc.onicecandidate = (e) => this.events.onSignal(userId, { candidate: e.candidate ? e.candidate.toJSON() : null });
    pc.onnegotiationneeded = () => this.enqueue(peer, () => this.negotiate(peer));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected" && peer.watchdog) {
        clearTimeout(peer.watchdog);
        peer.watchdog = null;
      }
      this.events.onPeerState(userId, pc.connectionState);
      if (pc.connectionState === "failed" && !peer.restartTimer) {
        peer.restartTimer = setTimeout(() => {
          peer.restartTimer = null;
          if (pc.connectionState === "failed" && !peer.polite) pc.restartIce();
        }, 1500);
      }
    };
    pc.ontrack = (e) => this.onTrack(peer, e);
    this.syncSenders(peer);
    this.events.onPeerState(userId, pc.connectionState);
    peer.watchdog = setTimeout(() => this.rebuild(userId, attempts), CONNECT_DEADLINE_MS);
    this.drainEarly(userId);
  }

  /**
   * A peer that has not connected by the deadline is thrown away and made
   * again. Signalling can stall in ways neither side notices: a lost offer, a
   * collision resolved the wrong way, a socket that dropped mid-exchange.
   */
  private rebuild(userId: string, attempts: number): void {
    const peer = this.peers.get(userId);
    if (!peer || this.closed) return;
    peer.watchdog = null;
    if (peer.pc.connectionState === "connected") return;
    if (attempts + 1 >= MAX_REBUILDS) {
      console.warn("voice: giving up on", userId, "after", attempts + 1, "attempts");
      return;
    }
    console.warn("voice: rebuilding the connection to", userId);
    this.removePeer(userId);
    this.addPeer(userId, attempts + 1);
  }

  /** Replays, in order, anything this peer sent before we knew about them. */
  private drainEarly(userId: string): void {
    const waiting = this.early.get(userId);
    if (!waiting?.length) return;
    this.early.delete(userId);
    for (const payload of waiting) this.handleSignal(userId, payload);
  }

  removePeer(userId: string): void {
    const p = this.peers.get(userId);
    if (!p) return;
    this.peers.delete(userId);
    this.teardownPlayback(p);
    if (p.restartTimer) clearTimeout(p.restartTimer);
    p.pc.onicecandidate = null;
    p.pc.onnegotiationneeded = null;
    p.pc.ontrack = null;
    p.pc.onconnectionstatechange = null;
    if (p.watchdog) clearTimeout(p.watchdog);
    p.pc.close();
    this.early.delete(userId);
    for (const kind of ["audio", "video", "screen"] as const) this.events.onRemoteStream(userId, kind, null);
  }

  peerIds(): string[] {
    return [...this.peers.keys()];
  }

  close(): void {
    this.closed = true;
    this.early.clear();
    for (const id of [...this.peers.keys()]) this.removePeer(id);
  }

  // --- signalling --------------------------------------------------------

  /**
   * Runs one description-touching step at a time per peer. Two of them
   * interleaved leave the connection in a state neither expects, which is how
   * a call ends up stuck with both sides waiting for the other.
   */
  private enqueue(peer: Peer, step: () => Promise<void>): void {
    peer.ops = peer.ops.then(step).catch((err: unknown) => console.warn("voice: signalling", peer.userId, err));
  }

  handleSignal(from: string, payload: SignalPayload): void {
    const peer = this.peers.get(from);
    if (!peer) {
      // Whoever joins second offers immediately, which can outrun the roster
      // update that introduces them. Dropping that offer deadlocks the call:
      // we would offer in turn and the other side, being impolite, would
      // ignore it. So hold onto it until the peer exists.
      if (this.closed || from === this.meId) return;
      const queued = this.early.get(from) ?? [];
      queued.push(payload);
      this.early.set(from, queued.slice(-EARLY_SIGNAL_LIMIT));
      return;
    }
    this.enqueue(peer, () => this.applySignal(peer, payload));
  }

  private async applySignal(peer: Peer, payload: SignalPayload): Promise<void> {
    const from = peer.userId;
    if (payload.streams) peer.remoteStreams = { ...peer.remoteStreams, ...payload.streams };
    const pc = peer.pc;
    try {
      if (payload.description) {
        const desc = payload.description;
        const offerCollision = desc.type === "offer" && (peer.makingOffer || pc.signalingState !== "stable");
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(desc);
        for (const c of peer.pendingCandidates.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        if (desc.type === "offer") {
          await pc.setLocalDescription();
          this.events.onSignal(from, { description: pc.localDescription!.toJSON(), streams: this.streamIds() });
        }
        if (peer.renegotiate && pc.signalingState === "stable") this.enqueue(peer, () => this.negotiate(peer));
      } else if (payload.candidate !== undefined) {
        const c = payload.candidate;
        if (!pc.remoteDescription) {
          if (c) peer.pendingCandidates.push(c);
          return;
        }
        try {
          await pc.addIceCandidate(c ?? undefined);
        } catch (err) {
          if (!peer.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.warn("voice: signal error from", from, err);
    }
  }

  private streamIds(): Partial<Record<MediaKind, string>> {
    return { audio: this.audioStream.id, video: this.videoStream.id, screen: this.screenStream.id };
  }

  private async negotiate(peer: Peer): Promise<void> {
    const pc = peer.pc;
    // Mid-exchange the other side's description is already on its way; a
    // second offer now would talk over it, so it waits for the lull.
    if (this.closed) return;
    if (pc.signalingState !== "stable") {
      peer.renegotiate = true;
      return;
    }
    peer.renegotiate = false;
    try {
      peer.makingOffer = true;
      await pc.setLocalDescription();
      this.events.onSignal(peer.userId, { description: pc.localDescription!.toJSON(), streams: this.streamIds() });
    } catch (err) {
      console.warn("voice: negotiation failed", err);
    } finally {
      peer.makingOffer = false;
    }
  }

  // --- senders -----------------------------------------------------------

  private syncSenders(peer: Peer): void {
    const pc = peer.pc;
    // audio: one sender, replaced in place so renegotiation is rare
    if (this.audioTrack) {
      if (peer.audioSender) void peer.audioSender.replaceTrack(this.audioTrack);
      else peer.audioSender = pc.addTrack(this.audioTrack, this.audioStream);
    } else if (peer.audioSender) {
      void peer.audioSender.replaceTrack(null);
    }
    if (this.videoTrack) {
      if (peer.videoSender) void peer.videoSender.replaceTrack(this.videoTrack);
      else {
        peer.videoSender = pc.addTrack(this.videoTrack, this.videoStream);
        this.capBitrate(peer.videoSender, 2_500_000);
      }
    } else if (peer.videoSender) {
      pc.removeTrack(peer.videoSender);
      peer.videoSender = null;
    }
    const screenTracks = this.screen ? this.screen.getTracks() : [];
    const wanted = new Set(screenTracks.map((t) => t.id));
    for (const s of [...peer.screenSenders]) {
      if (!s.track || !wanted.has(s.track.id)) {
        pc.removeTrack(s);
        peer.screenSenders = peer.screenSenders.filter((x) => x !== s);
      }
    }
    for (const t of screenTracks) {
      if (!peer.screenSenders.some((s) => s.track?.id === t.id)) {
        const sender = pc.addTrack(t, this.screenStream);
        if (t.kind === "video") this.capBitrate(sender, this.screenBitrate);
        peer.screenSenders.push(sender);
      }
    }
  }

  private capBitrate(sender: RTCRtpSender, maxBitrate: number): void {
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      params.encodings[0]!.maxBitrate = maxBitrate;
      void sender.setParameters(params).catch(() => {});
    } catch {
      /* not supported */
    }
  }

  // --- receiving ---------------------------------------------------------

  private onTrack(peer: Peer, e: RTCTrackEvent): void {
    const stream = e.streams[0];
    if (!stream) return;
    let kind: MediaKind = e.track.kind === "audio" ? "audio" : "video";
    for (const [k, id] of Object.entries(peer.remoteStreams)) if (id === stream.id) kind = k as MediaKind;
    if (kind === "screen") {
      // screen audio and video share one stream; expose it once
      this.events.onRemoteStream(peer.userId, "screen", stream);
      if (e.track.kind === "audio") this.attachScreenAudio(peer, stream);
    } else if (kind === "audio") {
      this.setupPlayback(peer, stream);
      this.events.onRemoteStream(peer.userId, "audio", stream);
    } else {
      this.events.onRemoteStream(peer.userId, "video", stream);
    }
    e.track.onended = () => this.events.onRemoteStream(peer.userId, kind, null);
    stream.onremovetrack = () => {
      if (stream.getTracks().length === 0) this.events.onRemoteStream(peer.userId, kind, null);
    };
  }

  private setupPlayback(peer: Peer, stream: MediaStream): void {
    this.teardownPlayback(peer);
    const ctx = audioContext();
    // Chrome only delivers remote WebRTC audio into WebAudio when an element also plays it
    const el = document.createElement("audio");
    el.srcObject = stream;
    el.muted = true;
    el.autoplay = true;
    el.setAttribute("data-voice-peer", peer.userId);
    document.body.appendChild(el);
    void el.play().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = this.effectiveGain(peer.userId);
    source.connect(gain).connect(ctx.destination);
    const meter = new LevelMeter(ctx, stream);
    const timer = setInterval(() => {
      const on = meter.level() > 0.02 && !this.localMutes.has(peer.userId);
      if (on !== peer.speaking) {
        peer.speaking = on;
        this.events.onSpeaking(peer.userId, on);
      }
    }, 100);
    peer.playback = { source, gain, el, meter, timer };
  }

  private attachScreenAudio(peer: Peer, stream: MediaStream): void {
    const ctx = audioContext();
    const el = document.createElement("audio");
    el.srcObject = new MediaStream(stream.getAudioTracks());
    el.muted = true;
    el.autoplay = true;
    el.setAttribute("data-voice-screen", peer.userId);
    document.body.appendChild(el);
    void el.play().catch(() => {});
    const source = ctx.createMediaStreamSource(el.srcObject as MediaStream);
    const gain = ctx.createGain();
    gain.gain.value = this.effectiveGain(peer.userId);
    source.connect(gain).connect(ctx.destination);
    stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      source.disconnect();
      gain.disconnect();
      el.remove();
    });
  }

  private teardownPlayback(peer: Peer): void {
    const pb = peer.playback;
    if (!pb) return;
    clearInterval(pb.timer);
    pb.meter.close();
    try {
      pb.source.disconnect();
      pb.gain.disconnect();
    } catch {
      /* already gone */
    }
    pb.el.srcObject = null;
    pb.el.remove();
    peer.playback = null;
    for (const el of document.querySelectorAll(`audio[data-voice-screen="${peer.userId}"]`)) el.remove();
    if (peer.speaking) {
      peer.speaking = false;
      this.events.onSpeaking(peer.userId, false);
    }
  }

  // --- output control ----------------------------------------------------

  private effectiveGain(userId: string): number {
    if (this.outputMuted || this.localMutes.has(userId)) return 0;
    return ((this.volumes.get(userId) ?? 100) / 100) * (this.masterVolume / 100);
  }

  private applyGains(): void {
    for (const p of this.peers.values()) {
      if (p.playback) p.playback.gain.gain.value = this.effectiveGain(p.userId);
    }
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

  /** Master output level for every peer, 0–200 %. */
  setMasterVolume(pct: number): void {
    this.masterVolume = Math.max(0, Math.min(200, pct));
    this.applyGains();
  }

  async setOutputDevice(deviceId: string | null): Promise<void> {
    const ctx = audioContext() as AudioContext & { setSinkId?: (id: string | { type: "none" }) => Promise<void> };
    if (typeof ctx.setSinkId === "function") await ctx.setSinkId(deviceId ?? "").catch(() => {});
  }

  /** Aggregate stats: round-trip time and packet loss over all peers, for a quality indicator. */
  async stats(): Promise<{ rtt: number; loss: number }> {
    let rtt = 0;
    let n = 0;
    let lost = 0;
    let received = 0;
    for (const p of this.peers.values()) {
      const report = await p.pc.getStats().catch(() => null);
      if (!report) continue;
      report.forEach((r) => {
        if (r.type === "candidate-pair" && (r as RTCIceCandidatePairStats).state === "succeeded" && (r as RTCIceCandidatePairStats).currentRoundTripTime !== undefined) {
          rtt += (r as RTCIceCandidatePairStats).currentRoundTripTime! * 1000;
          n++;
        }
        if (r.type === "inbound-rtp") {
          const x = r as RTCInboundRtpStreamStats;
          lost += x.packetsLost ?? 0;
          received += x.packetsReceived ?? 0;
        }
      });
    }
    return { rtt: n ? rtt / n : 0, loss: received + lost > 0 ? lost / (received + lost) : 0 };
  }
}
