/**
 * Seals outgoing call frames and opens incoming ones, off the main thread.
 * Frames arrive through RTCRtpScriptTransform (onrtctransform) or, in older
 * Chromium, as streams the page hands over. A frame this worker cannot seal
 * (no key yet) or open (another key, or altered) is dropped, never passed on
 * in the clear.
 */
import { clearBytes, frameIv, importFrameKey, openFrame, sealFrame, type FrameKind } from "./frameCrypto";

type Op = "encrypt" | "decrypt";

export type FrameCryptoMessage =
  | { type: "keys"; keys: { index: number; raw: Uint8Array }[]; send: number }
  | { type: "stream"; op: Op; kind: FrameKind; readable: ReadableStream; writable: WritableStream };

export interface FrameCryptoStats {
  type: "stats";
  sealed: number;
  opened: number;
  dropped: number;
}

interface EncodedFrame {
  data: ArrayBuffer;
  type?: string;
}

interface TransformEvent {
  transformer: { readable: ReadableStream<EncodedFrame>; writable: WritableStream<EncodedFrame>; options: { op: Op; kind: FrameKind } };
}

interface WorkerScope {
  onmessage: ((e: MessageEvent<FrameCryptoMessage>) => void) | null;
  onrtctransform: ((e: TransformEvent) => void) | null;
  postMessage(msg: FrameCryptoStats): void;
}

const scope = self as unknown as WorkerScope;
const keys = new Map<number, CryptoKey>();
let sendIndex = -1;
const salt = crypto.getRandomValues(new Uint8Array(4));
let counter = 0n;
const stats: FrameCryptoStats = { type: "stats", sealed: 0, opened: 0, dropped: 0 };
// keys are imported in order, so frames wait behind a key change instead of racing it
let keysReady: Promise<void> = Promise.resolve();

function transformer(op: Op, kind: FrameKind): TransformStream<EncodedFrame, EncodedFrame> {
  return new TransformStream({
    async transform(frame, controller) {
      await keysReady;
      const data = new Uint8Array(frame.data);
      const clear = clearBytes(kind, kind === "video" && frame.type === "key");
      if (op === "encrypt") {
        const key = keys.get(sendIndex);
        if (!key) {
          stats.dropped++;
          return;
        }
        frame.data = (await sealFrame(key, sendIndex, frameIv(salt, counter++), data, clear)).buffer as ArrayBuffer;
        stats.sealed++;
      } else {
        const opened = await openFrame(keys, data, clear);
        if (!opened) {
          stats.dropped++;
          return;
        }
        frame.data = opened.buffer as ArrayBuffer;
        stats.opened++;
      }
      controller.enqueue(frame);
    },
  });
}

function pipe(readable: ReadableStream<EncodedFrame>, writable: WritableStream<EncodedFrame>, op: Op, kind: FrameKind): void {
  readable.pipeThrough(transformer(op, kind)).pipeTo(writable).catch(() => {
    /* the track ended */
  });
}

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "keys") {
    keysReady = keysReady.then(async () => {
      const next = new Map<number, CryptoKey>();
      for (const k of msg.keys) next.set(k.index & 0xff, await importFrameKey(k.raw));
      keys.clear();
      for (const [index, key] of next) keys.set(index, key);
      sendIndex = msg.send & 0xff;
    });
  } else if (msg.type === "stream") {
    pipe(msg.readable, msg.writable, msg.op, msg.kind);
  }
};

scope.onrtctransform = (e) => {
  const { readable, writable, options } = e.transformer;
  pipe(readable, writable, options.op, options.kind);
};

setInterval(() => scope.postMessage(stats), 2000);
