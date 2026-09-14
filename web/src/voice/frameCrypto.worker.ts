/**
 * Seals outgoing call frames and opens incoming ones, off the main thread.
 * Frames arrive through RTCRtpScriptTransform (onrtctransform) or, in older
 * Chromium, as streams the page hands over. A frame this worker cannot seal
 * (no key yet) or open (another key, or altered) is dropped, never passed on
 * in the clear.
 */
import { MAX_FRAME_COUNTER, SALT_BYTES, clearBytes, frameIv, importFrameKey, openFrame, sealFrame, type FrameKind } from "./frameCrypto";
import { CopyHistory, Mender, unwrapCopies, wrapCopies, type Mended } from "./redundancy";

type Op = "encrypt" | "decrypt";

export type FrameCryptoMessage =
  | { type: "keys"; keys: { index: number; raw: Uint8Array }[]; send: number }
  | { type: "redundancy"; depth: number }
  | { type: "stream"; op: Op; kind: FrameKind; id?: string; voice?: boolean; readable: ReadableStream; writable: WritableStream };

export interface FrameCryptoStats {
  type: "stats";
  sealed: number;
  opened: number;
  dropped: number;
  /** Voice frames that went missing and were played from the copies a later frame carried. */
  recovered?: number;
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

interface FrameMetadata {
  rtpTimestamp?: number;
  synchronizationSource?: number;
}

interface EncodedFrame {
  data: ArrayBuffer;
  type?: string;
  getMetadata?(): FrameMetadata;
}

interface TransformEvent {
  transformer: { readable: ReadableStream<EncodedFrame>; writable: WritableStream<EncodedFrame>; options: { op: Op; kind: FrameKind; id?: string; voice?: boolean } };
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
const stats: FrameCryptoStats = { type: "stats", sealed: 0, opened: 0, dropped: 0, recovered: 0 };
/** How many earlier frames each outgoing voice frame carries copies of (0 to 2); the page sets it from how lossy the call is. */
let redundancy = 0;
// keys are imported in order, so frames wait behind a key change instead of racing it
let keysReady: Promise<void> = Promise.resolve();
/**
 * How long a voice frame held for lost frames' copies waits for the next frame
 * before going on without: long enough for the frame after two lost ones.
 */
const HOLD_MS = 80;

function passOn(controller: TransformStreamDefaultController<EncodedFrame>, frames: Mended<EncodedFrame>[]): void {
  for (const { frame, data } of frames) {
    frame.data = (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data.buffer : data.slice().buffer) as ArrayBuffer;
    controller.enqueue(frame);
  }
}

function transformer(op: Op, kind: FrameKind, id?: string, voice = false): TransformStream<EncodedFrame, EncodedFrame> {
  // what this receiver has reported so far: any frame at all, and one that opened
  let reportedFrame = false;
  let reportedOpened = false;
  // a voice sender remembers its last frames even while it sends no copies, so turning them on needs no warm-up
  const history = voice && op === "encrypt" ? new CopyHistory(2) : null;
  const mender = kind === "audio" && op === "decrypt" ? new Mender<EncodedFrame>() : null;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
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
        let plain: Uint8Array = data;
        const ts = history ? frame.getMetadata?.().rtpTimestamp : undefined;
        if (history && ts !== undefined) {
          const copies = history.take(ts, data);
          if (redundancy > 0) plain = wrapCopies(data, copies.slice(0, redundancy)) ?? data;
        }
        frame.data = (await sealFrame(key, sendIndex, frameIv(salt, counter++), plain, clear)).buffer as ArrayBuffer;
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
        stats.opened++;
        if (mender) {
          const { primary, copies } = unwrapCopies(opened);
          const meta = frame.getMetadata?.();
          const before = mender.recovered;
          clearTimeout(holdTimer);
          passOn(controller, meta?.rtpTimestamp === undefined ? [...mender.flush(), { frame, data: primary }] : mender.push(frame, meta.synchronizationSource ?? 0, meta.rtpTimestamp, primary, copies, performance.now()));
          stats.recovered = (stats.recovered ?? 0) + mender.recovered - before;
          if (mender.holding) {
            holdTimer = setTimeout(() => {
              try {
                passOn(controller, mender.flush());
              } catch {
                /* the track ended */
              }
            }, HOLD_MS);
          }
          return;
        }
        frame.data = opened.buffer as ArrayBuffer;
      }
      controller.enqueue(frame);
    },
    flush() {
      clearTimeout(holdTimer);
    },
  });
}

function pipe(readable: ReadableStream<EncodedFrame>, writable: WritableStream<EncodedFrame>, op: Op, kind: FrameKind, id?: string, voice?: boolean): void {
  readable.pipeThrough(transformer(op, kind, id, voice)).pipeTo(writable).catch(() => {
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
  } else if (msg.type === "redundancy") {
    redundancy = Math.max(0, Math.min(2, msg.depth | 0));
  } else if (msg.type === "stream") {
    pipe(msg.readable, msg.writable, msg.op, msg.kind, msg.id, msg.voice);
  }
};

scope.onrtctransform = (e) => {
  const { readable, writable, options } = e.transformer;
  pipe(readable, writable, options.op, options.kind, options.id, options.voice);
};

setInterval(() => scope.postMessage(stats), 2000);
