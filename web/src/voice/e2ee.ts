/**
 * The page's side of call frame encryption: one worker per call, the keys it
 * seals and opens with, and the senders and receivers routed through it.
 */
import { convForChannel } from "@/components/composer/send";
import { voiceFrameKey } from "@/crypto/conv";
import { ring } from "@/lib/keyring";
import type { FrameKind } from "./frameCrypto";
import { guestVoiceKeys } from "./guestKeys";
import type { FrameCryptoMessage, FrameCryptoSeen, FrameCryptoSize, FrameCryptoStats } from "./frameCrypto.worker";

interface LegacyEncoded {
  createEncodedStreams(): { readable: ReadableStream; writable: WritableStream };
}

export interface VoiceKeys {
  keys: { index: number; raw: Uint8Array }[];
  send: number;
  /** Changes whenever the set of keys does. */
  version: string;
}

/**
 * The call keys for a channel, one per epoch of its conversation that this
 * device holds; frames are sealed with the newest. Null when there is none.
 * A guest has no conversation keys, only the call keys its link brought.
 */
/**
 * The version `voiceKeysFor` would report, without deriving anything.
 *
 * The check for "nothing changed" runs every few seconds for a whole call, and
 * building the answer first meant an HKDF per epoch the conversation has ever
 * had, thrown away every time.
 */
export function voiceKeysVersion(channelId: string): string | null {
  const guest = guestVoiceKeys(channelId);
  if (guest) return guest.version;
  const conv = convForChannel(channelId);
  const epochs = callEpochs(conv);
  if (epochs.length === 0) return null;
  return `${conv}:${epochs.join(",")}`;
}

/**
 * How many of a conversation's newest epochs a call can open. A call only
 * ever seals with the newest, and a device a few rotations behind catches up
 * within seconds; a server's conversation has an epoch for every membership
 * change it ever had, and deriving and importing hundreds of keys held every
 * frame of the call behind the import.
 */
const CALL_EPOCHS = 8;

function callEpochs(conv: string): number[] {
  return ring.epochs(conv).slice(-CALL_EPOCHS);
}

export function voiceKeysFor(channelId: string): VoiceKeys | null {
  const guest = guestVoiceKeys(channelId);
  if (guest) return guest;
  const conv = convForChannel(channelId);
  const epochs = callEpochs(conv);
  const newest = epochs[epochs.length - 1];
  if (newest === undefined) return null;
  const keys = epochs.map((epoch) => ({ index: epoch, raw: voiceFrameKey(ring.get(conv, epoch)!, channelId) }));
  return { keys, send: newest, version: `${conv}:${epochs.join(",")}` };
}

export class FrameCrypto {
  private worker: Worker;
  private latest: FrameCryptoStats = { type: "stats", sealed: 0, opened: 0, dropped: 0 };
  /** Told when a receiver's first frame goes through its transform, and when the first one opens. */
  onSeen: ((id: string, opened: boolean) => void) | null = null;
  /** Told when a video receiver's picture goes over the size cap (nothing of it is decoded) or back within it. */
  onSize: ((id: string, over: boolean) => void) | null = null;

  /** Whether this browser can encrypt call frames at all. */
  static supported(): boolean {
    return FrameCrypto.scriptTransform() || FrameCrypto.legacy();
  }

  static scriptTransform(): boolean {
    return typeof RTCRtpScriptTransform === "function";
  }

  /** Older Chromium only has createEncodedStreams, which needs a flag on the connection. */
  static legacy(): boolean {
    return !FrameCrypto.scriptTransform() && typeof RTCRtpSender !== "undefined" && "createEncodedStreams" in RTCRtpSender.prototype;
  }

  constructor() {
    this.worker = new Worker(new URL("./frameCrypto.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<FrameCryptoStats | FrameCryptoSeen | FrameCryptoSize>) => {
      if (e.data?.type === "stats") this.latest = e.data;
      else if (e.data?.type === "seen") this.onSeen?.(e.data.id, e.data.opened);
      else if (e.data?.type === "size") this.onSize?.(e.data.id, e.data.over);
    };
  }

  setKeys(k: VoiceKeys): void {
    this.post({ type: "keys", keys: k.keys, send: k.send });
  }

  /** How many earlier frames each outgoing voice frame carries copies of, 0 to 2. */
  setRedundancy(depth: number): void {
    this.post({ type: "redundancy", depth });
  }

  /** `voice` marks the microphone's sender, whose frames carry copies for lossy links. */
  protectSender(sender: RTCRtpSender, kind: FrameKind, voice = false): void {
    this.protect(sender, "encrypt", kind, undefined, voice);
  }

  /**
   * `id` names this receiver in onSeen and onSize; it must be new for every
   * receiver, since a mid can come round again. `codec` is VP8's MIME type
   * when that is all its transceiver can negotiate.
   */
  protectReceiver(receiver: RTCRtpReceiver, kind: FrameKind, id?: string, codec?: string): void {
    this.protect(receiver, "decrypt", kind, id, false, codec);
  }

  /**
   * Holds a video receiver of a call without encryption (peer to peer) to the
   * size cap, the check every opened frame gets. Only where the browser has
   * RTCRtpScriptTransform: the older way needs a flag on the connection, set
   * when it is made. True when the check is in place.
   */
  inspectReceiver(receiver: RTCRtpReceiver, id: string, codec?: string): boolean {
    if (!FrameCrypto.scriptTransform()) return false;
    receiver.transform = new RTCRtpScriptTransform(this.worker, { op: "inspect", kind: "video", id, ...(codec ? { codec } : {}) });
    return true;
  }

  /**
   * Asks the sender of a video receiver for a keyframe now, rather than when
   * the browser would (seconds later): for a picture stuck behind a packet
   * that is not coming. Only where the browser's transform can ask (Chromium,
   * Firefox); elsewhere nothing happens and the browser's own request comes.
   */
  requestKeyFrame(id: string): void {
    this.post({ type: "keyframe", id });
  }

  stats(): FrameCryptoStats {
    return this.latest;
  }

  close(): void {
    this.worker.terminate();
  }

  private protect(end: RTCRtpSender | RTCRtpReceiver, op: "encrypt" | "decrypt", kind: FrameKind, id?: string, voice = false, codec?: string): void {
    const extra = { ...(id === undefined ? {} : { id }), ...(voice ? { voice } : {}), ...(codec ? { codec } : {}) };
    if (FrameCrypto.scriptTransform()) {
      end.transform = new RTCRtpScriptTransform(this.worker, { op, kind, ...extra });
      return;
    }
    const { readable, writable } = (end as unknown as LegacyEncoded).createEncodedStreams();
    this.worker.postMessage({ type: "stream", op, kind, ...extra, readable, writable } satisfies FrameCryptoMessage, [readable as unknown as Transferable, writable as unknown as Transferable]);
  }

  private post(msg: FrameCryptoMessage): void {
    this.worker.postMessage(msg);
  }
}
