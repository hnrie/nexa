/**
 * Seals outgoing call frames and opens incoming ones, off the main thread.
 * Frames arrive through RTCRtpScriptTransform (onrtctransform) or, in older
 * Chromium, as streams the page hands over. A frame this worker cannot seal
 * (no key yet) or open (another key, or altered) is dropped, never passed on
 * in the clear.
 *
 * Every received video frame, once opened, is also held to the size cap
 * (frameSize.ts) before the browser decodes it. Peer to peer, where nothing is
 * sealed, video receivers come through here for that check alone ("inspect").
 */
import { MAX_FRAME_COUNTER, SALT_BYTES, clearBytes, frameIv, importFrameKey, openFrame, sealFrame, type FrameKind } from "./frameCrypto";
import { SizeGuard } from "./frameSize";
import { CopyHistory, Mender, unwrapCopies, wrapCopies, type Mended } from "./redundancy";

type Op = "encrypt" | "decrypt" | "inspect";

/** How a receiver's transform is set up: `codec` is VP8's MIME type when that is the only codec its transceiver negotiates. */
interface StreamOptions {
  op: Op;
  kind: FrameKind;
  id?: string;
  voice?: boolean;
  codec?: string;
}

export type FrameCryptoMessage =
  | { type: "keys"; keys: { index: number; raw: Uint8Array }[]; send: number }
  | { type: "redundancy"; depth: number }
  | ({ type: "stream"; readable: ReadableStream; writable: WritableStream } & StreamOptions);

export interface FrameCryptoStats {
  type: "stats";
  sealed: number;
  opened: number;
  dropped: number;
  /** Voice frames that went missing and were played from the copies a later frame carried. */
  recovered?: number;
  /** Video frames kept from the decoder for a picture over the size cap. */
  oversize?: number;
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

/**
 * A receiver's picture went over the size cap (its frames are dropped from
 * then on) or came back within it. Told a moment after it changes, so a
 * stream flipping back and forth cannot flood the page.
 */
export interface FrameCryptoSize {
  type: "size";
  id: string;
  over: boolean;
}

interface FrameMetadata {
  rtpTimestamp?: number;
  synchronizationSource?: number;
  mimeType?: string;
}

interface EncodedFrame {
  data: ArrayBuffer;
  type?: string;
  getMetadata?(): FrameMetadata;
}

interface TransformEvent {
  transformer: { readable: ReadableStream<EncodedFrame>; writable: WritableStream<EncodedFrame>; options: StreamOptions };
}

interface WorkerScope {
  onmessage: ((e: MessageEvent<FrameCryptoMessage>) => void) | null;
  onrtctransform: ((e: TransformEvent) => void) | null;
  postMessage(msg: FrameCryptoStats | FrameCryptoSeen | FrameCryptoSize): void;
}

const scope = self as unknown as WorkerScope;
const keys = new Map<number, CryptoKey>();
let sendIndex = -1;
let salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
let counter = 0;
const stats: FrameCryptoStats = { type: "stats", sealed: 0, opened: 0, dropped: 0, recovered: 0, oversize: 0 };
/** How many earlier frames each outgoing voice frame carries copies of (0 to 2); the page sets it from how lossy the call is. */
let redundancy = 0;
// keys are imported in order, so frames wait behind a key change instead of racing it
let keysReady: Promise<void> = Promise.resolve();
/**
 * How long a voice frame held for lost frames' copies waits for the next frame
 * before going on without: long enough for the frame after two lost ones.
 */
const HOLD_MS = 80;
/** How long a receiver's size verdict has to settle before the page is told. */
const SIZE_REPORT_MS = 300;

/** The codec a received frame is in, as the browser reports it; undefined where it does not. */
function mimeOf(frame: EncodedFrame): string | undefined {
  try {
    const m = frame.getMetadata?.().mimeType;
    return typeof m === "string" && m ? m : undefined;
  } catch {
    return undefined;
  }
}

function passOn(controller: TransformStreamDefaultController<EncodedFrame>, frames: Mended<EncodedFrame>[]): void {
  for (const { frame, data } of frames) {
    frame.data = (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data.buffer : data.slice().buffer) as ArrayBuffer;
    controller.enqueue(frame);
  }
}

function transformer({ op, kind, id, voice = false, codec }: StreamOptions): TransformStream<EncodedFrame, EncodedFrame> {
  // what this receiver has reported so far: any frame at all, and one that opened
  let reportedFrame = false;
  let reportedOpened = false;
  // received video is held to the size cap; through the SFU only VP8 is ever sent, peer to peer another codec is let be
  const guard = kind === "video" && op !== "encrypt" ? new SizeGuard(op === "inspect" ? "pass" : "drop") : null;
  let toldOver = false;
  let sizeTimer: ReturnType<typeof setTimeout> | undefined;
  const tellSize = () => {
    if (id === undefined || sizeTimer !== undefined) return;
    sizeTimer = setTimeout(() => {
      sizeTimer = undefined;
      if (!guard || guard.blocked === toldOver) return;
      toldOver = guard.blocked;
      scope.postMessage({ type: "size", id, over: toldOver });
    }, SIZE_REPORT_MS);
  };
  /** Whether an opened video frame may go on to the decoder. */
  const admit = (frame: EncodedFrame, data: Uint8Array): boolean => {
    if (!guard) return true;
    const was = guard.blocked;
    const verdict = guard.check(data, mimeOf(frame) ?? codec);
    if (guard.blocked !== was) tellSize();
    if (verdict === "pass") return true;
    stats.oversize = (stats.oversize ?? 0) + 1;
    return false;
  };
  // a voice sender remembers its last frames even while it sends no copies, so turning them on needs no warm-up
  const history = voice && op === "encrypt" ? new CopyHistory(2) : null;
  const mender = kind === "audio" && op === "decrypt" ? new Mender<EncodedFrame>() : null;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  return new TransformStream({
    async transform(frame, controller) {
      // a frame that cannot even be read is dropped: an error here would end the stream, and the track with it
      try {
        if (op === "inspect") {
          if (admit(frame, new Uint8Array(frame.data))) controller.enqueue(frame);
          return;
        }
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
          if (!admit(frame, opened)) return;
          frame.data = opened.buffer as ArrayBuffer;
        }
        controller.enqueue(frame);
      } catch {
        stats.dropped++;
      }
    },
    flush() {
      clearTimeout(holdTimer);
      clearTimeout(sizeTimer);
    },
  });
}

function pipe(readable: ReadableStream<EncodedFrame>, writable: WritableStream<EncodedFrame>, options: StreamOptions): void {
  readable.pipeThrough(transformer(options)).pipeTo(writable).catch(() => {
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
    const { readable, writable, op, kind, id, voice, codec } = msg;
    pipe(readable, writable, { op, kind, id, voice, codec });
  }
};

scope.onrtctransform = (e) => {
  const { readable, writable, options } = e.transformer;
  pipe(readable, writable, options);
};

setInterval(() => scope.postMessage(stats), 2000);
