/**
 * The page's side of call frame encryption: one worker per call, the keys it
 * seals and opens with, and the senders and receivers routed through it.
 */
import { convForChannel } from "@/components/composer/send";
import { voiceFrameKey } from "@/crypto/conv";
import { ring } from "@/lib/keyring";
import type { FrameKind } from "./frameCrypto";
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
 */
export function voiceKeysFor(channelId: string): VoiceKeys | null {
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

  protectSender(sender: RTCRtpSender, kind: FrameKind): void {
    this.protect(sender, "encrypt", kind);
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

  private protect(end: RTCRtpSender | RTCRtpReceiver, op: "encrypt" | "decrypt", kind: FrameKind, id?: string): void {
    if (FrameCrypto.scriptTransform()) {
      end.transform = new RTCRtpScriptTransform(this.worker, id === undefined ? { op, kind } : { op, kind, id });
      return;
    }
    const { readable, writable } = (end as unknown as LegacyEncoded).createEncodedStreams();
    this.worker.postMessage({ type: "stream", op, kind, ...(id === undefined ? {} : { id }), readable, writable } satisfies FrameCryptoMessage, [readable as unknown as Transferable, writable as unknown as Transferable]);
  }

  private post(msg: FrameCryptoMessage): void {
    this.worker.postMessage(msg);
  }
}
