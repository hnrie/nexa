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
}

function lower(a: string, b: string): boolean {
  if (a.length !== b.length) return a.length < b.length;
  return a < b;
}

export class MeshTransport {
  private peers = new Map<string, Peer>();
  private audioTrack: MediaStreamTrack | null = null;
  private videoTrack: MediaStreamTrack | null = null;
  private screen: MediaStream | null = null;
  private audioStream = new MediaStream();
  private videoStream = new MediaStream();
  private screenStream = new MediaStream();
  private outputMuted = false;
  private volumes = new Map<string, number>();
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

  addPeer(userId: string, initiator: boolean): void {
    if (this.closed || this.peers.has(userId) || userId === this.meId) return;
    const pc = new RTCPeerConnection({ iceServers: this.ice, bundlePolicy: "max-bundle" });
    const peer: Peer = { userId, pc, polite: lower(this.meId, userId), makingOffer: false, ignoreOffer: false, remoteStreams: {}, pendingCandidates: [], audioSender: null, videoSender: null, screenSenders: [], playback: null, speaking: false, restartTimer: null };
    this.peers.set(userId, peer);
    pc.onicecandidate = (e) => this.events.onSignal(userId, { candidate: e.candidate ? e.candidate.toJSON() : null });
    pc.onnegotiationneeded = () => void this.negotiate(peer);
    pc.onconnectionstatechange = () => {
      this.events.onPeerState(userId, pc.connectionState);
      if (pc.connectionState === "failed" && !peer.restartTimer) {
        peer.restartTimer = setTimeout(() => {
          peer.restartTimer = null;
          if (pc.connectionState === "failed" && !peer.polite) pc.restartIce();
        }, 1500);
      }
    };
    pc.ontrack = (e) => this.onTrack(peer, e);
    // receive-only transceivers so the remote can send even before we do
    if (initiator) {
      this.syncSenders(peer);
    } else {
      this.syncSenders(peer);
    }
    this.events.onPeerState(userId, pc.connectionState);
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
    p.pc.close();
    for (const kind of ["audio", "video", "screen"] as const) this.events.onRemoteStream(userId, kind, null);
  }

  peerIds(): string[] {
    return [...this.peers.keys()];
  }

  close(): void {
    this.closed = true;
    for (const id of [...this.peers.keys()]) this.removePeer(id);
  }

  // --- signalling --------------------------------------------------------

  async handleSignal(from: string, payload: SignalPayload): Promise<void> {
    const peer = this.peers.get(from);
    if (!peer) return;
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
    return (this.volumes.get(userId) ?? 100) / 100;
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
