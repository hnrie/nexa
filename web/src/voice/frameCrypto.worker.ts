/**
 * Seals outgoing call frames and opens incoming ones, off the main thread.
 * Frames arrive through RTCRtpScriptTransform (onrtctransform) or, in older
 * Chromium, as streams the page hands over. A frame this worker cannot seal
 * (no key yet) or open (another key, or altered) is dropped, never passed on
 * in the clear.
 */
import { MAX_FRAME_COUNTER, SALT_BYTES, clearBytes, frameIv, importFrameKey, openFrame, sealFrame, type FrameKind } from "./frameCrypto";

type Op = "encrypt" | "decrypt";

export type FrameCryptoMessage =
  | { type: "keys"; keys: { index: number; raw: Uint8Array }[]; send: number }
  | { type: "stream"; op: Op; kind: FrameKind; id?: string; readable: ReadableStream; writable: WritableStream };

export interface FrameCryptoStats {
  type: "stats";
  sealed: number;
  opened: number;
  dropped: number;
}

/**
 * The first frame through one receiver's transform, and the first one that
 * opened. A receiver whose packets never show up here is playing them
 * without opening them: sealed frames decoded as they are, which is loud noise.
 */
export interface FrameCryptoSeen {
  type: "seen";
  id: string;
  opened: boolean;
}

interface EncodedFrame {
  data: ArrayBuffer;
  type?: string;
}

interface TransformEvent {
  transformer: { readable: ReadableStream<EncodedFrame>; writable: WritableStream<EncodedFrame>; options: { op: Op; kind: FrameKind; id?: string } };
}

interface WorkerScope {
  onmessage: ((e: MessageEvent<FrameCryptoMessage>) => void) | null;
  onrtctransform: ((e: TransformEvent) => void) | null;
  postMessage(msg: FrameCryptoStats | FrameCryptoSeen): void;
}

const scope = self as unknown as WorkerScope;
const keys = new Map<number, CryptoKey>();
let sendIndex = -1;
let salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
let counter = 0;
const stats: FrameCryptoStats = { type: "stats", sealed: 0, opened: 0, dropped: 0 };
// keys are imported in order, so frames wait behind a key change instead of racing it
let keysReady: Promise<void> = Promise.resolve();

function transformer(op: Op, kind: FrameKind, id?: string): TransformStream<EncodedFrame, EncodedFrame> {
  // what this receiver has reported so far: any frame at all, and one that opened
  let reportedFrame = false;
  let reportedOpened = false;
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
        if (counter > MAX_FRAME_COUNTER) {
          salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
          counter = 0;
        }
        frame.data = (await sealFrame(key, sendIndex, frameIv(salt, counter++), data, clear)).buffer as ArrayBuffer;
        stats.sealed++;
      } else {
        const opened = await openFrame(keys, data, clear);
        if (id !== undefined && (!reportedFrame || (opened && !reportedOpened))) {
          reportedFrame = true;
          if (opened) reportedOpened = true;
          scope.postMessage({ type: "seen", id, opened: !!opened });
        }
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

function pipe(readable: ReadableStream<EncodedFrame>, writable: WritableStream<EncodedFrame>, op: Op, kind: FrameKind, id?: string): void {
  readable.pipeThrough(transformer(op, kind, id)).pipeTo(writable).catch(() => {
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
    pipe(msg.readable, msg.writable, msg.op, msg.kind, msg.id);
  }
};

scope.onrtctransform = (e) => {
  const { readable, writable, options } = e.transformer;
  pipe(readable, writable, options.op, options.kind, options.id);
};

setInterval(() => scope.postMessage(stats), 2000);
