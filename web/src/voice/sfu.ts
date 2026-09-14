/**
 * Calls through Cloudflare Realtime SFU: one RTCPeerConnection to Cloudflare
 * for the whole call. This device publishes its microphone, camera and screen
 * there and pulls what it needs of everyone else's, through chatd, which
 * decides who may pull what. Every frame is sealed with the conversation's key
 * on the way out and opened on the way in, so Cloudflare forwards media it
 * cannot read, and nobody in the call learns anybody else's address.
 */
import { ApiError } from "@/api/client";
import { voice as voiceApi, type SfuDescription } from "@/api/voice";
import type { VoiceState } from "@/api/types";
import { FrameCrypto, voiceKeysFor } from "./e2ee";
import { CopyPlanner, LOSS_ONE_COPY } from "./copyPlanner";
import { Playback } from "./playback";
import type { SignalPayload, TransportEvents, VoiceTransport } from "./transport";

type PubKind = "audio" | "video" | "screen" | "screen_audio";

/** A track pulled from someone else, arriving on one of this connection's mids. */
interface Pulled {
  userId: string;
  kind: PubKind;
  /** The tag of the published track it is, and the tag that was asked for (the server may have had a newer one). */
  tag: string;
  asked: string;
  mid: string;
  /** The received track, once it has arrived. */
  track: MediaStreamTrack | null;
  /** This receiver's name in the frame crypto worker, new for every receiver. */
  cryptoId?: string;
  /** When the track arrived, whether any of its frames reached the worker yet, and whether one opened. */
  arrivedAt?: number;
  seen?: boolean;
  opened?: boolean;
  /** When its packets are next counted, and how long the wait after that grows to while none come (a camera that is off). */
  checkAt?: number;
  checkEvery?: number;
}

interface Want {
  userId: string;
  kind: PubKind;
  tag: string;
}

/** A pulled voice's counters, as getStats has them, and when. */
interface VoiceCounts {
  at: number;
  received: number;
  lost: number;
  concealed: number;
  samples: number;
  jbDelay: number;
  jbEmitted: number;
}

/** What was last reported for someone, so only changes are reported. */
interface Shown {
  audio: MediaStream | null;
  video: MediaStream | null;
  screen: MediaStream | null;
}

/** The camera is capped here, and the server charges pulls of it at this rate. */
const CAMERA_BPS = 1_500_000;
/**
 * How long a dropped connection gets before ICE is restarted, and how often
 * restarts are tried while it stays down. A blip comes back by itself well
 * within the first; a changed network (Wi-Fi to mobile) needs the restart.
 * The connection itself is kept while the SFU keeps its tracks (see
 * TRACKS_GONE_MS): a network that returns by then picks it straight back up.
 */
const RECOVER_AFTER_MS = 3_000;
const RESTART_EVERY_MS = 8_000;
/** Restarts that were answered yet never reconnected, before the connection is made again from nothing. */
const MAX_ICE_RESTARTS = 4;
/**
 * Cloudflare lets go of tracks after 30 s without their media. A connection
 * down this long (its media stopped a few seconds before it noticed) comes
 * back to tracks that are gone, silent both ways, so it is made again instead.
 */
const TRACKS_GONE_MS = 20_000;
/** How often the key ring is checked for a rotated key. */
const KEY_CHECK_MS = 4_000;
/** How long a request to chatd may take before the step gives up on it. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Retries wait this long, doubling with each failure in a row up to the most. */
const RETRY_BASE_MS = 1_000;
/**
 * A pull the SFU could not serve yet waits this long first. Cloudflare refuses
 * a track whose publisher is still connecting (not_found_track_error), which
 * is what someone who joined a moment ago looks like.
 */
const PULL_RETRY_BASE_MS = 400;
/** In a call a long wait is a long silence: retries never wait more than this. */
const RETRY_MAX_MS = 8_000;
/** A failure this long after the last one starts the wait from the beginning again. */
const FAILURES_FORGOTTEN_MS = 60_000;
/**
 * A pulled track that has received this many packets without one frame
 * reaching the decryption worker is playing sealed frames as they are, which
 * Chromium can end up doing when packets beat the receiver's transform. Such
 * a track is let go and pulled again.
 */
const BYPASS_PACKETS = 25;
/** How long a new track gets before its packets are counted against it. */
const BYPASS_GRACE_MS = 1_500;
/** Pulling the same track again stops after this many tries; it stays silent. */
const MAX_REPULLS = 3;
/** A track with too few packets to judge is counted again after this long, doubling up to the most. */
const BYPASS_RECHECK_MS = 1_000;
const BYPASS_RECHECK_MAX_MS = { audio: 8_000, video: 20_000 };
/** How often each pulled voice's losses are measured, and the most often a listener tells the speaker. */
const LOSS_CHECK_MS = 2_000;
const LOSS_REPORT_MS = 4_000;
/**
 * Losses are told when they last: over the checks kept (the last six seconds,
 * some 300 packets), so the odd loss on a good link does not turn copies on.
 * Heavy losses are told from one check (two seconds, some 100 packets).
 */
const LOSS_CHECKS_KEPT = 3;
const LOSS_SPAN_MIN_PACKETS = 150;
const LOSS_SPAN_MIN_MISSED = 6;
const LOSS_HEAVY = 0.08;
const LOSS_HEAVY_MIN_PACKETS = 40;
const LOSS_HEAVY_MIN_MISSED = 4;
/** This device's own voice is measured once it sent this many packets since the last check. */
const UPLINK_MIN_PACKETS = 40;
/** A pulled voice's first seconds are not counted: packets lost while a track starts say nothing about the link. */
const LOSS_GRACE_MS = 4_000;
/** After the server pauses video, this device leaves it alone this long before asking again. */
const VIDEO_PAUSE_MS = 10 * 60_000;
const VIDEO_PAUSED = "Video is paused until next month to keep calls free.";

/** Thrown by a step whose connection was replaced or closed while it waited. */
class Stale extends Error {}

/** A pull the server could not answer; nothing changed here, so asking again later is enough. */
class SyncLater extends Error {}

const media = (kind: PubKind): "audio" | "video" => (kind === "audio" || kind === "screen_audio" ? "audio" : "video");
const slot = (userId: string, kind: PubKind) => `${userId}:${kind}`;
const timeout = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

function description(d: RTCSessionDescription | null): SfuDescription {
  return { type: d!.type as "offer" | "answer", sdp: d!.sdp };
}

/** VP8 only: the encryption keeps its payload header readable, which H.264's differs from. */
function preferVp8(tr: RTCRtpTransceiver): void {
  if (typeof tr.setCodecPreferences !== "function") return;
  for (const caps of [RTCRtpReceiver.getCapabilities?.("video"), RTCRtpSender.getCapabilities?.("video")]) {
    const vp8 = caps?.codecs.filter((c) => c.mimeType === "video/VP8" || c.mimeType === "video/rtx") ?? [];
    if (!vp8.some((c) => c.mimeType === "video/VP8")) continue;
    try {
      tr.setCodecPreferences(vp8);
      return;
    } catch {
      /* this list is not the one the browser checks against; try the other */
    }
  }
}

function capBitrate(sender: RTCRtpSender, maxBitrate: number): void {
  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0]!.maxBitrate = maxBitrate;
    void sender.setParameters(params).catch(() => {});
  } catch {
    /* not supported */
  }
}

/** The stream already carrying exactly these tracks, or a new one for them; null for none. */
function streamOf(current: MediaStream | null, tracks: MediaStreamTrack[]): MediaStream | null {
  if (tracks.length === 0) return null;
  const have = current?.getTracks() ?? [];
  if (current && have.length === tracks.length && tracks.every((t) => have.includes(t))) return current;
  return new MediaStream(tracks);
}

export class SfuTransport implements VoiceTransport {
  private pc: RTCPeerConnection;
  private readonly crypto = new FrameCrypto();
  private readonly playback: Playback;
  private sessionId: string | null = null;
  /** Bumped whenever the connection is thrown away; queued steps of an older one do not run. */
  private generation = 0;
  /** Every step that touches the connection's descriptions runs here, one at a time. */
  private ops: Promise<void> = Promise.resolve();
  private closed = false;
  private connecting = false;

  private audioTrack: MediaStreamTrack | null = null;
  private audioGateOpen = true;
  private videoTrack: MediaStreamTrack | null = null;
  private screen: MediaStream | null = null;
  private screenBitrate = 5_000_000;
  private senders: Partial<Record<PubKind, RTCRtpTransceiver>> = {};
  private published = new Set<PubKind>();

  private roster = new Map<string, VoiceState>();
  private peers = new Set<string>();
  private watching = new Set<string>();
  /** One pull per person and kind. */
  private pulled = new Map<string, Pulled>();
  private byMid = new Map<string, Pulled>();
  private shown = new Map<string, Shown>();
  private syncQueued = false;

  private keyVersion = "";
  private keyTimer: ReturnType<typeof setInterval>;
  private bypassTimer: ReturnType<typeof setInterval>;
  private receiverSeq = 0;
  /** How often each person's track of each kind has been pulled again for skipping decryption. */
  private repulls = new Map<string, number>();
  private recoverTimer: ReturnType<typeof setTimeout> | null = null;
  private iceRestarts = 0;
  /** When this connection, having been up, went down; null while it is up (or never was). */
  private downSince: number | null = null;
  private wasUp = false;
  private retry: { timer: ReturnType<typeof setTimeout>; rebuild: boolean } | null = null;
  private failures = 0;
  private lastFailure = 0;
  private videoPausedUntil = 0;
  private lossTimer: ReturnType<typeof setInterval>;
  /** Per pulled voice (by mid), the counters at the last few checks, oldest first. */
  private lossSeen = new Map<string, VoiceCounts[]>();
  /** When this device last told each speaker about losses. */
  private lossTold = new Map<string, number>();
  /** This device's voice at the last check: packets sent, and lost as the SFU reports. */
  private voiceSent: { ssrc: number; sent: number; lost: number } | null = null;
  /** How many copies this device's voice frames carry, from what listeners report. */
  private copies = new CopyPlanner((depth) => this.crypto.setRedundancy(depth));

  constructor(
    private readonly meId: string,
    private channelId: string,
    private readonly ice: RTCIceServer[],
    private readonly events: TransportEvents,
  ) {
    this.playback = new Playback(events.onSpeaking);
    this.pc = this.newConnection();
    this.crypto.onSeen = (id, opened) => this.onFramesSeen(id, opened);
    this.refreshKeys();
    this.keyTimer = setInterval(() => this.refreshKeys(), KEY_CHECK_MS);
    this.bypassTimer = setInterval(() => void this.checkBypass(), 1_000);
    this.lossTimer = setInterval(() => void this.checkLoss(), LOSS_CHECK_MS);
  }

  // --- the connection ----------------------------------------------------

  private newConnection(): RTCPeerConnection {
    const config: RTCConfiguration & { encodedInsertableStreams?: boolean } = { iceServers: this.ice, bundlePolicy: "max-bundle" };
    if (FrameCrypto.legacy()) config.encodedInsertableStreams = true;
    const pc = new RTCPeerConnection(config);
    pc.ontrack = (e) => this.onTrack(e);
    pc.onconnectionstatechange = () => this.onConnectionState(pc);
    return pc;
  }

  /** Runs a step after the ones before it. Steps of a connection since thrown away are skipped, and what they throw is ignored. */
  private enqueue(step: () => Promise<void>): Promise<void> {
    const generation = this.generation;
    const run = this.ops.then(async () => {
      if (this.closed || generation !== this.generation) return;
      try {
        await step();
      } catch (err) {
        if (this.closed || generation !== this.generation || err instanceof Stale) return;
        this.fail(err);
      }
    });
    this.ops = run;
    return run;
  }

  /** Stops a step that waited while its connection was replaced or closed. */
  private live(pc: RTCPeerConnection): void {
    if (this.closed || pc !== this.pc) throw new Stale();
  }

  private fail(err: unknown): void {
    if (err instanceof ApiError && err.code === "video_paused") {
      this.pauseVideo(err.message);
      return;
    }
    console.warn("voice: sfu step failed", err);
    // a refused pull changed nothing here; anything else may have left the
    // connection half way through an exchange, so it is made again
    this.retryLater(!(err instanceof SyncLater));
  }

  /** Tries again after a wait that grows while failures keep coming. A rebuild replaces a waiting sync. */
  private retryLater(rebuild: boolean, baseMs = RETRY_BASE_MS): void {
    if (this.closed) return;
    if (this.retry) {
      if (!rebuild || this.retry.rebuild) return;
      clearTimeout(this.retry.timer);
    } else {
      const now = Date.now();
      if (now - this.lastFailure > FAILURES_FORGOTTEN_MS) this.failures = 0;
      this.lastFailure = now;
      this.failures++;
    }
    const delay = Math.min(RETRY_MAX_MS, baseMs * 2 ** (this.failures - 1));
    const timer = setTimeout(() => {
      this.retry = null;
      if (rebuild) this.rebuild();
      else this.scheduleSync();
    }, delay);
    this.retry = { timer, rebuild };
  }

  private refreshKeys(): void {
    // without a key for the channel nothing is sent at all, never in the clear or under another channel's key
    const k = voiceKeysFor(this.channelId) ?? { keys: [], send: 0, version: `none:${this.channelId}` };
    if (k.version === this.keyVersion) return;
    this.keyVersion = k.version;
    this.crypto.setKeys(k);
  }

  /** The server acknowledged this device in the call: open the session if there is none. */
  joined(_state?: VoiceState): void {
    this.connect();
  }

  /** A reconnect ended the server's copy of this call and closed its session; the next acknowledgement opens a new one. */
  reconnected(): void {
    this.reset();
  }

  /** Moved by a moderator: the old channel's session is gone and the key belongs to the new channel. */
  moveTo(channelId: string): void {
    if (channelId === this.channelId) return;
    this.channelId = channelId;
    this.refreshKeys();
    this.roster.clear();
    this.reset();
  }

  private connect(): void {
    if (this.closed || this.sessionId || this.connecting) return;
    this.connecting = true;
    const pc = this.pc;
    void this.enqueue(async () => {
      let session: string;
      try {
        ({ session_id: session } = await voiceApi.sfuSession(timeout()));
      } finally {
        if (pc === this.pc) this.connecting = false;
      }
      this.live(pc);
      this.sessionId = session;
      await this.publishNow(this.wantedKinds());
      this.scheduleSync();
    });
  }

  /** Throws the connection away and makes everything again: a new session, the same media, the same pulls. */
  private rebuild(): void {
    this.reset();
    this.connect();
  }

  /** A fresh connection with no session, nothing published and nothing pulled. */
  private reset(): void {
    if (this.closed) return;
    this.generation++;
    this.ops = Promise.resolve();
    if (this.recoverTimer) clearTimeout(this.recoverTimer);
    this.recoverTimer = null;
    if (this.retry) clearTimeout(this.retry.timer);
    this.retry = null;
    this.iceRestarts = 0;
    this.downSince = null;
    this.wasUp = false;
    const old = this.pc;
    old.ontrack = null;
    old.onconnectionstatechange = null;
    old.close();
    this.pc = this.newConnection();
    this.sessionId = null;
    this.connecting = false;
    this.senders = {};
    this.published.clear();
    this.pulled.clear();
    this.byMid.clear();
    this.present();
    for (const id of this.peers) this.events.onPeerState(id, this.pc.connectionState);
  }

  private onConnectionState(pc: RTCPeerConnection): void {
    if (pc !== this.pc || this.closed) return;
    const state = pc.connectionState;
    for (const id of this.peers) this.events.onPeerState(id, state);
    if (state === "connected") {
      if (this.recoverTimer) clearTimeout(this.recoverTimer);
      this.recoverTimer = null;
      this.iceRestarts = 0;
      this.failures = 0;
      const downFor = this.downSince === null ? 0 : Date.now() - this.downSince;
      this.downSince = null;
      this.wasUp = true;
      if (downFor >= TRACKS_GONE_MS) this.retryLater(true, 0);
    } else if (state === "disconnected" || state === "failed") {
      if (this.wasUp && this.downSince === null) this.downSince = Date.now();
      if (!this.recoverTimer) this.recoverTimer = setTimeout(() => this.recover(pc), state === "failed" ? 0 : RECOVER_AFTER_MS);
    }
  }

  /** The network looks back (the page came online, the gateway reconnected): a connection still down tries again now. */
  nudge(): void {
    const pc = this.pc;
    if (this.closed) return;
    if (this.retry?.rebuild) {
      clearTimeout(this.retry.timer);
      this.retry = null;
      this.failures = 0;
      this.rebuild();
      return;
    }
    if (pc.connectionState !== "disconnected" && pc.connectionState !== "failed") return;
    if (this.recoverTimer) clearTimeout(this.recoverTimer);
    this.recover(pc);
  }

  /** The SFU session this device's call holds, for resuming it on a new gateway connection. */
  currentSession(): string | null {
    return this.sessionId;
  }

  /**
   * A connection that stayed down: restart ICE, keeping the session, its
   * tracks and everyone's pulls, while the connection stays open to come back
   * by itself. Only restarts that were answered and still did not reconnect,
   * or a session the SFU no longer has, make it again from nothing.
   */
  private recover(pc: RTCPeerConnection): void {
    this.recoverTimer = null;
    if (pc !== this.pc || this.closed) return;
    const state = pc.connectionState;
    if (state !== "disconnected" && state !== "failed") return;
    const anchor = (["audio", "video", "screen", "screen_audio"] as const).find((k) => this.published.has(k) && this.senders[k]?.mid);
    if (this.iceRestarts >= MAX_ICE_RESTARTS || !this.sessionId || !anchor) {
      this.retryLater(true, 0);
      return;
    }
    this.recoverTimer = setTimeout(() => this.recover(pc), RESTART_EVERY_MS);
    const session = this.sessionId;
    const mid = this.senders[anchor]!.mid!;
    void this.enqueue(async () => {
      try {
        pc.restartIce();
        const offer = await pc.createOffer({ iceRestart: true });
        this.live(pc);
        await pc.setLocalDescription(offer);
        this.live(pc);
        const res = await voiceApi.sfuRestart({ session_id: session, offer: description(pc.localDescription), mid, kind: anchor }, timeout());
        this.live(pc);
        if (!res.answer) throw new Error("no answer to the ICE restart");
        await pc.setRemoteDescription(res.answer);
        this.iceRestarts++;
      } catch (err) {
        if (err instanceof Stale) throw err;
        if (pc.signalingState === "have-local-offer") await pc.setLocalDescription({ type: "rollback" }).catch(() => {});
        // a session the SFU let go of cannot come back; anything else (the network still down) waits for the next try
        if (err instanceof ApiError && (err.code === "sfu_session_gone" || err.code === "not_in_voice")) throw err;
        console.warn("voice: ICE restart did not go through", err);
      }
    });
  }

  // --- publishing --------------------------------------------------------

  private trackFor(kind: PubKind): MediaStreamTrack | null {
    switch (kind) {
      case "audio":
        return this.audioGateOpen ? this.audioTrack : null;
      case "video":
        return this.videoTrack;
      case "screen":
        return this.screen?.getVideoTracks()[0] ?? null;
      case "screen_audio":
        return this.screen?.getAudioTracks()[0] ?? null;
    }
  }

  private videoPaused(): boolean {
    return Date.now() < this.videoPausedUntil;
  }

  /** What has something to send just now; video is left out while the server has it paused. */
  private wantedKinds(): PubKind[] {
    const kinds: PubKind[] = [];
    if (this.audioTrack) kinds.push("audio");
    if (!this.videoPaused()) {
      if (this.videoTrack) kinds.push("video");
      if (this.screen?.getVideoTracks()[0]) {
        kinds.push("screen");
        if (this.screen.getAudioTracks()[0]) kinds.push("screen_audio");
      }
    }
    return kinds;
  }

  private publish(kinds: PubKind[]): void {
    if (!this.sessionId) return; // connecting publishes whatever is there by then
    void this.enqueue(async () => {
      await this.publishNow(kinds);
      this.scheduleSync();
    });
  }

  /** Adds the missing transceivers and publishes them in one offer. */
  private async publishNow(kinds: PubKind[]): Promise<void> {
    const session = this.sessionId;
    const pc = this.pc;
    const fresh = kinds.filter((k) => !this.published.has(k));
    if (!session || fresh.length === 0) return;
    const added: PubKind[] = [];
    for (const kind of fresh) {
      if (this.senders[kind]) continue;
      const tr = pc.addTransceiver(this.trackFor(kind) ?? media(kind), { direction: "sendonly" });
      if (media(kind) === "video") preferVp8(tr);
      // the microphone's frames carry copies of the ones before when listeners lose packets
      this.crypto.protectSender(tr.sender, media(kind), kind === "audio");
      if (kind === "video") capBitrate(tr.sender, CAMERA_BPS);
      if (kind === "screen") capBitrate(tr.sender, this.screenBitrate);
      this.senders[kind] = tr;
      added.push(kind);
    }
    let failed = 0;
    try {
      const offer = await pc.createOffer();
      this.live(pc);
      await pc.setLocalDescription(offer);
      this.live(pc);
      const res = await voiceApi.sfuPublish(
        {
          session_id: session,
          offer: description(pc.localDescription),
          tracks: fresh.map((kind) => ({ mid: this.senders[kind]!.mid!, kind, ...(kind === "screen" ? { bitrate: this.screenBitrate } : {}) })),
        },
        timeout(),
      );
      this.live(pc);
      if (!res.answer) throw new Error("no answer to the offer");
      await pc.setRemoteDescription(res.answer);
      this.live(pc);
      failed = res.failed;
    } catch (err) {
      if (pc !== this.pc || this.closed) throw new Stale();
      // take the offer back, and the transceivers it added, so the next exchange starts clean
      if (pc.signalingState === "have-local-offer") await pc.setLocalDescription({ type: "rollback" }).catch(() => {});
      this.live(pc);
      for (const kind of added) {
        this.senders[kind]?.stop();
        delete this.senders[kind];
      }
      throw err;
    }
    for (const kind of fresh) this.published.add(kind);
    // the SFU turned a track down: the session is made again rather than left without it
    if (failed > 0) throw new Error(`the call service refused ${failed} track(s)`);
  }

  setLocalAudio(track: MediaStreamTrack | null): void {
    this.audioTrack = track;
    const tr = this.senders.audio;
    if (tr) void tr.sender.replaceTrack(this.trackFor("audio")).catch(() => {});
    else if (track) this.publish(["audio"]);
  }

  /** Voice activity's gate: while shut the sender carries nothing, but the track stays live for the meter. */
  setAudioGate(open: boolean): void {
    if (this.audioGateOpen === open) return;
    this.audioGateOpen = open;
    const tr = this.senders.audio;
    if (tr && this.audioTrack) void tr.sender.replaceTrack(open ? this.audioTrack : null).catch(() => {});
  }

  setLocalVideo(track: MediaStreamTrack | null): void {
    this.videoTrack = track;
    const tr = this.senders.video;
    // turned off, the sender stays published and sends nothing; the server stops charging for it
    if (tr) void tr.sender.replaceTrack(track).catch(() => {});
    else if (track) this.publish(["video"]);
  }

  setLocalScreen(stream: MediaStream | null, bitrate = 5_000_000): void {
    this.screen = stream;
    this.screenBitrate = bitrate;
    const missing: PubKind[] = [];
    for (const kind of ["screen", "screen_audio"] as const) {
      const tr = this.senders[kind];
      const track = this.trackFor(kind);
      if (tr) {
        void tr.sender.replaceTrack(track).catch(() => {});
        if (kind === "screen" && track) capBitrate(tr.sender, bitrate);
      } else if (track) missing.push(kind);
    }
    if (missing.length) this.publish(missing);
  }

  /** The server paused video near the free allowance: stop asking for it for a while, and send what went with it. */
  private pauseVideo(message: string): void {
    this.videoPausedUntil = Date.now() + VIDEO_PAUSE_MS;
    this.events.onError?.("video_paused", message);
    this.publish(this.wantedKinds());
    this.scheduleSync();
  }

  // --- pulling -----------------------------------------------------------

  addPeer(userId: string): void {
    if (userId === this.meId || this.peers.has(userId)) return;
    this.peers.add(userId);
    this.events.onPeerState(userId, this.pc.connectionState);
    this.scheduleSync();
  }

  removePeer(userId: string): void {
    if (!this.peers.delete(userId)) return;
    // silent at once; the next exchange tells the SFU to stop sending their tracks
    this.present();
    this.scheduleSync();
  }

  peerIds(): string[] {
    return [...this.peers];
  }

  /** A listener says how much of this device's voice it loses, conceals and waits for; copies go out while that calls for them. */
  handleSignal(from: string, payload: SignalPayload): void {
    const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : null);
    const loss = num(payload?.voice_loss, 1);
    if (loss === null) return;
    const span = num(payload.voice_span, 60_000);
    this.copies.report(from, { loss, conceal: num(payload.voice_conceal, 1) ?? loss, delay: num(payload.voice_delay, 60_000) ?? 0, ...(span === null ? {} : { span }) }, Date.now());
  }

  /** Measures what each pulled voice loses, and tells its speaker when it is enough to matter. */
  private async checkLoss(): Promise<void> {
    if (this.closed || !this.sessionId) return;
    const pc = this.pc;
    const report = await pc.getStats().catch(() => null);
    if (!report || pc !== this.pc || this.closed) return;
    const now = Date.now();
    let mine: { ssrc: number; sent: number } | null = null;
    const lostBySsrc = new Map<number, number>();
    for (const r of report.values() as IterableIterator<RTCStats & { kind?: string; mid?: string; ssrc?: number; packetsSent?: number; packetsLost?: number }>) {
      if (r.type === "candidate-pair" && (r as RTCIceCandidatePairStats).nominated && (r as RTCIceCandidatePairStats).state === "succeeded") {
        const rtt = (r as RTCIceCandidatePairStats).currentRoundTripTime;
        if (typeof rtt === "number") this.copies.roundTrip(rtt * 1000);
      }
      if (r.type === "outbound-rtp" && r.kind === "audio" && r.mid !== undefined && r.mid === this.senders.audio?.mid && r.ssrc !== undefined) mine = { ssrc: r.ssrc, sent: r.packetsSent ?? 0 };
      if (r.type === "remote-inbound-rtp" && r.kind === "audio" && r.ssrc !== undefined && typeof r.packetsLost === "number") lostBySsrc.set(r.ssrc, r.packetsLost);
    }
    // what the SFU lost of this device's voice since the last check, from the receiver reports it sends every second
    const lost = mine ? lostBySsrc.get(mine.ssrc) : undefined;
    if (mine && lost !== undefined) {
      const was = this.voiceSent;
      this.voiceSent = { ssrc: mine.ssrc, sent: mine.sent, lost };
      if (was && was.ssrc === mine.ssrc && mine.sent - was.sent >= UPLINK_MIN_PACKETS) this.copies.uplink(Math.max(0, Math.min(1, (lost - was.lost) / (mine.sent - was.sent))), now);
    }
    for (const r of report.values() as IterableIterator<RTCStats>) {
      if (r.type !== "inbound-rtp" || (r as RTCInboundRtpStreamStats).kind !== "audio") continue;
      const s = r as RTCInboundRtpStreamStats & { mid?: string; concealedSamples?: number; totalSamplesReceived?: number; jitterBufferDelay?: number; jitterBufferEmittedCount?: number };
      const p = s.mid ? this.byMid.get(s.mid) : undefined;
      if (!p || p.kind !== "audio" || !s.mid) continue;
      const counts: VoiceCounts = {
        at: now,
        received: s.packetsReceived ?? 0,
        lost: Math.max(0, s.packetsLost ?? 0),
        concealed: s.concealedSamples ?? 0,
        samples: s.totalSamplesReceived ?? 0,
        jbDelay: s.jitterBufferDelay ?? 0,
        jbEmitted: s.jitterBufferEmittedCount ?? 0,
      };
      const seen = this.lossSeen.get(s.mid) ?? [];
      const last = seen[seen.length - 1];
      // counters that went back are a new stream: what came before says nothing about it
      const kept = last && counts.received >= last.received ? seen : [];
      this.lossSeen.set(s.mid, [...kept, counts].slice(-LOSS_CHECKS_KEPT));
      const told = this.lossTold.get(p.userId) ?? 0;
      if (kept.length === 0 || p.arrivedAt === undefined || now - p.arrivedAt < LOSS_GRACE_MS || now - told < LOSS_REPORT_MS) continue;
      const over = (from: VoiceCounts) => {
        const received = counts.received - from.received;
        // packets that never came; ones that came too late to play are jitter, and a copy would come later still
        const missed = Math.max(0, counts.lost - from.lost);
        return { from, total: received + missed, missed, loss: received + missed > 0 ? missed / (received + missed) : 0 };
      };
      const recent = over(kept[kept.length - 1]!);
      // since this speaker was last told, so reports do not overlap and each says what the stretch after the one before was like
      const span = over(kept.find((c) => c.at >= told) ?? kept[0]!);
      const tell =
        recent.total >= LOSS_HEAVY_MIN_PACKETS && recent.missed >= LOSS_HEAVY_MIN_MISSED && recent.loss >= LOSS_HEAVY
          ? recent
          : span.total >= LOSS_SPAN_MIN_PACKETS && span.missed >= LOSS_SPAN_MIN_MISSED && span.loss >= LOSS_ONE_COPY
            ? span
            : null;
      if (!tell) continue;
      this.lossTold.set(p.userId, now);
      const samples = counts.samples - tell.from.samples;
      const emitted = counts.jbEmitted - tell.from.jbEmitted;
      const conceal = samples > 0 ? Math.max(0, Math.min(1, (counts.concealed - tell.from.concealed) / samples)) : tell.loss;
      const wait = emitted > 0 ? ((counts.jbDelay - tell.from.jbDelay) / emitted) * 1000 : 0;
      const share = (v: number) => Math.round(v * 1000) / 1000;
      this.events.onSignal(p.userId, { voice_loss: share(tell.loss), voice_conceal: share(conceal), voice_delay: Math.round(wait + (this.copies.rtt() ?? 0)), voice_span: now - tell.from.at });
    }
    this.copies.update(now);
  }

  setRoster(states: VoiceState[]): void {
    this.roster = new Map(states.filter((s) => s.channel_id === this.channelId).map((s) => [s.user_id, s]));
    // a camera turned on or off shows at once: its track stays pulled either way
    this.present();
    this.scheduleSync();
  }

  setWatching(userId: string, on: boolean): void {
    if (on) this.watching.add(userId);
    else this.watching.delete(userId);
    this.playback.setWatching(userId, on);
    this.scheduleSync();
  }

  /**
   * What should be pulled now: everyone's voice and camera (a camera that is
   * off sends nothing and costs nothing, and turning it on shows without
   * another exchange), and the shares being watched.
   */
  private wanted(): Map<string, Want> {
    const out = new Map<string, Want>();
    const paused = this.videoPaused();
    for (const [userId, st] of this.roster) {
      if (userId === this.meId || !this.peers.has(userId)) continue;
      const add = (kind: PubKind) => {
        const tag = st.media?.[kind];
        if (tag) out.set(slot(userId, kind), { userId, kind, tag });
      };
      add("audio");
      if (!paused) add("video");
      if (st.streaming && this.watching.has(userId)) {
        if (!paused) add("screen");
        add("screen_audio");
      }
    }
    return out;
  }

  private scheduleSync(): void {
    if (this.syncQueued || this.closed) return;
    this.syncQueued = true;
    queueMicrotask(() => {
      this.syncQueued = false;
      void this.enqueue(() => this.syncNow());
    });
  }

  private async syncNow(): Promise<void> {
    if (!this.sessionId) return;
    const want = this.wanted();
    const drop: Pulled[] = [];
    for (const [key, p] of this.pulled) {
      const w = want.get(key);
      // a track published again has a new tag, and is pulled again
      if (!w || (w.tag !== p.tag && w.tag !== p.asked)) drop.push(p);
    }
    const add = [...want.entries()].filter(([key]) => !this.pulled.has(key) || drop.includes(this.pulled.get(key)!)).map(([, w]) => w);
    if (drop.length) await this.unsubscribe(drop);
    if (add.length) await this.subscribe(add);
  }

  private async subscribe(list: Want[]): Promise<void> {
    const session = this.sessionId!;
    const pc = this.pc;
    let res: Awaited<ReturnType<typeof voiceApi.sfuSubscribe>>;
    try {
      res = await voiceApi.sfuSubscribe({ session_id: session, tracks: list.map((w) => ({ user_id: w.userId, kind: w.kind })) }, timeout());
    } catch (err) {
      this.live(pc);
      if (err instanceof ApiError && (err.code === "sfu_session_gone" || err.code === "not_in_voice")) throw err;
      throw new SyncLater(err instanceof Error ? err.message : String(err));
    }
    this.live(pc);
    const asked = new Map(list.map((w) => [slot(w.userId, w.kind), w.tag]));
    let paused = false;
    let refused = false;
    for (const t of res.tracks) {
      if (t.error === "video_paused") paused = true;
      else if (t.error || !t.mid) refused = true;
      if (!t.mid || t.error) continue;
      const kind = t.kind as PubKind;
      const p: Pulled = { userId: t.user_id, kind, tag: t.tag ?? "", asked: asked.get(slot(t.user_id, kind)) ?? "", mid: t.mid, track: null };
      this.pulled.set(slot(p.userId, kind), p);
      this.byMid.set(p.mid, p);
    }
    if (res.offer) {
      await pc.setRemoteDescription(res.offer);
      this.live(pc);
      const answer = await pc.createAnswer();
      this.live(pc);
      await pc.setLocalDescription(answer);
      this.live(pc);
      await voiceApi.sfuRenegotiate({ session_id: session, description: description(pc.localDescription) }, timeout());
      this.live(pc);
    }
    if (paused && !this.videoPaused()) this.pauseVideo(VIDEO_PAUSED);
    // a track not there yet (its publisher still connecting) is asked for again shortly; what is no longer wanted by then is not
    if (refused) this.retryLater(false, PULL_RETRY_BASE_MS);
  }

  private async unsubscribe(list: Pulled[]): Promise<void> {
    const session = this.sessionId!;
    const pc = this.pc;
    for (const p of list) {
      if (this.pulled.get(slot(p.userId, p.kind)) === p) this.pulled.delete(slot(p.userId, p.kind));
      this.byMid.delete(p.mid);
      pc.getTransceivers().find((t) => t.mid === p.mid)?.stop();
    }
    this.present();
    const offer = await pc.createOffer();
    this.live(pc);
    await pc.setLocalDescription(offer);
    this.live(pc);
    const res = await voiceApi.sfuClose({ session_id: session, mids: list.map((p) => p.mid), offer: description(pc.localDescription) }, timeout());
    this.live(pc);
    if (!res.answer) throw new Error("no answer to closing tracks");
    await pc.setRemoteDescription(res.answer);
    this.live(pc);
  }

  private onTrack(e: RTCTrackEvent): void {
    const mid = e.transceiver.mid;
    const p = mid ? this.byMid.get(mid) : undefined;
    const cryptoId = `${mid ?? "-"}#${++this.receiverSeq}`;
    try {
      // Every receiver gets its transform at once, even one this call does not know: Chromium lets
      // frames skip a receiver that has none for good, and the mid may be handed out again later.
      this.crypto.protectReceiver(e.receiver, p ? media(p.kind) : e.track.kind === "video" ? "video" : "audio", cryptoId);
    } catch (err) {
      // a track that cannot be opened is not played: what arrives is sealed
      console.warn("voice: cannot decrypt a pulled track", err);
      return;
    }
    if (!p) return;
    p.track = e.track;
    p.cryptoId = cryptoId;
    p.arrivedAt = Date.now();
    p.seen = false;
    p.opened = false;
    p.checkAt = 0;
    p.checkEvery = undefined;
    this.present();
  }

  /** The worker saw a pulled track's first frame, or its first opened one: its sound can play. */
  private onFramesSeen(id: string, opened: boolean): void {
    for (const p of this.pulled.values()) {
      if (p.cryptoId !== id) continue;
      p.seen = true;
      if (opened && !p.opened) {
        p.opened = true;
        this.repulls.delete(slot(p.userId, p.kind));
        if (p.kind === "audio") this.playback.setHeld(p.userId, "voice", false);
        if (p.kind === "screen_audio") this.playback.setHeld(p.userId, "screen", false);
      }
      return;
    }
  }

  /** Whether a pulled track's sound is still waiting to be known as opened. */
  private held(userId: string, kind: PubKind): boolean {
    const p = this.pulled.get(slot(userId, kind));
    return !!p && !p.opened;
  }

  /**
   * Finds pulled tracks whose packets arrive but never reach the decryption
   * worker, and pulls them again. Their sound was held silent all along.
   */
  private async checkBypass(): Promise<void> {
    if (this.closed || !this.sessionId) return;
    const now = Date.now();
    const suspects = [...this.pulled.values()].filter(
      (p) => p.track && p.cryptoId && !p.seen && p.arrivedAt !== undefined && now - p.arrivedAt > BYPASS_GRACE_MS && (this.repulls.get(slot(p.userId, p.kind)) ?? 0) < MAX_REPULLS,
    );
    // stats are only gathered for a track that is due: one that never gets packets waits longer each time
    if (!suspects.some((p) => (p.checkAt ?? 0) <= now)) return;
    const pc = this.pc;
    const report = await pc.getStats().catch(() => null);
    if (!report || pc !== this.pc || this.closed) return;
    const packets = new Map<string, number>();
    report.forEach((r) => {
      const s = r as RTCInboundRtpStreamStats & { mid?: string };
      if (s.type === "inbound-rtp" && s.mid) packets.set(s.mid, (packets.get(s.mid) ?? 0) + (s.packetsReceived ?? 0));
    });
    const skipping = suspects.filter((p) => !p.seen && this.pulled.get(slot(p.userId, p.kind)) === p && (packets.get(p.mid) ?? 0) >= BYPASS_PACKETS);
    for (const p of suspects) {
      if (skipping.includes(p)) continue;
      p.checkEvery = Math.min(BYPASS_RECHECK_MAX_MS[media(p.kind)], (p.checkEvery ?? BYPASS_RECHECK_MS / 2) * 2);
      p.checkAt = now + p.checkEvery;
    }
    if (skipping.length === 0) return;
    const again: Pulled[] = [];
    for (const p of skipping) {
      const key = slot(p.userId, p.kind);
      const tries = this.repulls.get(key) ?? 0;
      if (tries >= MAX_REPULLS) continue;
      this.repulls.set(key, tries + 1);
      console.warn(`voice: a pulled ${p.kind} track played without decryption (${packets.get(p.mid)} packets); pulling it again`);
      again.push(p);
    }
    if (again.length === 0) return;
    void this.enqueue(async () => {
      const still = again.filter((p) => this.pulled.get(slot(p.userId, p.kind)) === p);
      if (still.length) await this.unsubscribe(still);
      this.scheduleSync();
    });
  }

  /** Reports what can be heard and seen of each person, where that changed. */
  private present(): void {
    if (this.closed) return;
    const users = new Set(this.shown.keys());
    for (const p of this.pulled.values()) users.add(p.userId);
    for (const userId of users) {
      const st = this.peers.has(userId) ? this.roster.get(userId) : undefined;
      const track = (kind: PubKind) => {
        const t = st ? this.pulled.get(slot(userId, kind))?.track : null;
        return t && t.readyState === "live" ? t : null;
      };
      const prev = this.shown.get(userId) ?? { audio: null, video: null, screen: null };
      const audio = track("audio");
      const video = st?.video ? track("video") : null;
      // a share shows once its picture is there; its sound comes with it
      const screen = st?.streaming ? track("screen") : null;
      const screenAudio = screen ? track("screen_audio") : null;
      const next: Shown = {
        audio: streamOf(prev.audio, audio ? [audio] : []),
        video: streamOf(prev.video, video ? [video] : []),
        screen: streamOf(prev.screen, screen ? (screenAudio ? [screen, screenAudio] : [screen]) : []),
      };
      if (next.audio !== prev.audio) {
        if (next.audio) this.playback.attachVoice(userId, next.audio, this.held(userId, "audio"));
        else this.playback.detachVoice(userId);
        this.events.onRemoteStream(userId, "audio", next.audio);
      }
      if (next.video !== prev.video) this.events.onRemoteStream(userId, "video", next.video);
      if (next.screen !== prev.screen) {
        if (next.screen?.getAudioTracks().length) this.playback.attachScreenAudio(userId, next.screen, this.held(userId, "screen_audio"));
        else this.playback.detachScreenAudio(userId);
        this.events.onRemoteStream(userId, "screen", next.screen);
      }
      if (next.audio || next.video || next.screen) this.shown.set(userId, next);
      else this.shown.delete(userId);
    }
  }

  // --- output ------------------------------------------------------------

  setVolume(userId: string, pct: number): void {
    this.playback.setVolume(userId, pct);
  }

  setStreamVolume(userId: string, pct: number): void {
    this.playback.setStreamVolume(userId, pct);
  }

  setStreamMuted(userId: string, on: boolean): void {
    this.playback.setStreamMuted(userId, on);
  }

  setLocalMute(userId: string, on: boolean): void {
    this.playback.setLocalMute(userId, on);
  }

  setOutputMuted(on: boolean): void {
    this.playback.setOutputMuted(on);
  }

  setMasterVolume(pct: number): void {
    this.playback.setMasterVolume(pct);
  }

  setOutputDevice(deviceId: string | null): Promise<void> {
    return this.playback.setOutputDevice(deviceId);
  }

  async stats(): Promise<{ rtt: number; loss: number }> {
    const report = await this.pc.getStats().catch(() => null);
    let rtt = 0;
    let lost = 0;
    let received = 0;
    report?.forEach((r) => {
      if (r.type === "candidate-pair" && (r as RTCIceCandidatePairStats).nominated && (r as RTCIceCandidatePairStats).currentRoundTripTime !== undefined) {
        rtt = (r as RTCIceCandidatePairStats).currentRoundTripTime! * 1000;
      }
      if (r.type === "inbound-rtp") {
        const x = r as RTCInboundRtpStreamStats;
        lost += x.packetsLost ?? 0;
        received += x.packetsReceived ?? 0;
      }
    });
    return { rtt, loss: received + lost > 0 ? lost / (received + lost) : 0 };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.generation++;
    clearInterval(this.keyTimer);
    clearInterval(this.bypassTimer);
    clearInterval(this.lossTimer);
    if (this.recoverTimer) clearTimeout(this.recoverTimer);
    if (this.retry) clearTimeout(this.retry.timer);
    this.retry = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.pc.close();
    this.pulled.clear();
    this.byMid.clear();
    this.shown.clear();
    this.playback.close();
    this.crypto.close();
  }
}
