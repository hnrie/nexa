/**
 * The page's side of call frame encryption: one worker per call, the keys it
 * seals and opens with, and the senders and receivers routed through it.
 */
import { convForChannel } from "@/components/composer/send";
import { voiceFrameKey } from "@/crypto/conv";
import { ring } from "@/lib/keyring";
import type { FrameKind } from "./frameCrypto";
import { guestVoiceKeys } from "./guestKeys";
import type { FrameCryptoMessage, FrameCryptoSeen, FrameCryptoStats } from "./frameCrypto.worker";

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
  const epochs = ring.epochs(conv);
  if (epochs.length === 0) return null;
  return `${conv}:${epochs.join(",")}`;
}

export function voiceKeysFor(channelId: string): VoiceKeys | null {
  const guest = guestVoiceKeys(channelId);
  if (guest) return guest;
  const conv = convForChannel(channelId);
  const epochs = ring.epochs(conv);
  const newest = epochs[epochs.length - 1];
  if (newest === undefined) return null;
  const keys = epochs.map((epoch) => ({ index: epoch & 0xff, raw: voiceFrameKey(ring.get(conv, epoch)!, channelId) }));
  return { keys, send: newest & 0xff, version: `${conv}:${epochs.join(",")}` };
}

export class FrameCrypto {
  private worker: Worker;
  private latest: FrameCryptoStats = { type: "stats", sealed: 0, opened: 0, dropped: 0 };
  /** Told when a receiver's first frame goes through its transform, and when the first one opens. */
  onSeen: ((id: string, opened: boolean) => void) | null = null;

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
    this.worker.onmessage = (e: MessageEvent<FrameCryptoStats | FrameCryptoSeen>) => {
      if (e.data?.type === "stats") this.latest = e.data;
      else if (e.data?.type === "seen") this.onSeen?.(e.data.id, e.data.opened);
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

  /** `id` names this receiver in onSeen; it must be new for every receiver, since a mid can come round again. */
  protectReceiver(receiver: RTCRtpReceiver, kind: FrameKind, id?: string): void {
    this.protect(receiver, "decrypt", kind, id);
  }

  stats(): FrameCryptoStats {
    return this.latest;
  }

  close(): void {
    this.worker.terminate();
  }

  private protect(end: RTCRtpSender | RTCRtpReceiver, op: "encrypt" | "decrypt", kind: FrameKind, id?: string, voice = false): void {
    const extra = { ...(id === undefined ? {} : { id }), ...(voice ? { voice } : {}) };
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
