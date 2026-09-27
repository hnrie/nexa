/**
 * Keeps received pictures over the cap (videoCap.ts) away from the browser's
 * decoder. The frame worker runs every received video frame past a SizeGuard
 * once it is opened, before the frame goes on to be decoded: a modified
 * client could otherwise send a keyframe that claims 16383x16383 and make
 * every browser in the call allocate gigabytes for it.
 *
 * Calls carry VP8 and nothing else (preferVp8 in videoCap.ts, for sending and
 * receiving alike), so VP8's keyframe header is the one read here: a 3-byte
 * frame tag whose lowest bit is 0 on a keyframe, the start code 9d 01 2a, then
 * the width and the height, 14 bits each (the top two bits of each are a
 * scaling hint decoders leave alone). Inter frames declare no size: they are
 * decoded at the size of the keyframe before them. So once a keyframe is over
 * the cap, everything after it is dropped as well, until a keyframe within
 * the cap starts the picture again.
 *
 * Nothing here throws on any input.
 */
import { fitsCap, type PictureSize } from "./videoCap";

export const VP8 = "video/vp8";

/**
 * What a VP8 frame says about itself: an inter frame (or an empty one), which
 * carries no size; a keyframe and the size it declares; or a keyframe whose
 * header is broken, which no decoder can start from.
 */
export type Vp8Header = { key: false } | { key: true; size: PictureSize | null };

export function vp8Header(data: Uint8Array): Vp8Header {
  if (data.length === 0 || (data[0]! & 1) === 1) return { key: false };
  if (data.length < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) return { key: true, size: null };
  const width = (data[6]! | (data[7]! << 8)) & 0x3fff;
  const height = (data[8]! | (data[9]! << 8)) & 0x3fff;
  return { key: true, size: width > 0 && height > 0 ? { width, height } : null };
}

export type Verdict = "pass" | "drop";

/**
 * One received video stream's check, frame by frame.
 *
 * `foreign` is what becomes of a frame that is not VP8 (the browser says so,
 * or it cannot be VP8 when nothing says): through the SFU nothing else is
 * ever sent, since the encryption only knows VP8's header, so such frames are
 * dropped; peer to peer they go on to be decoded, as a browser that could not
 * be held to VP8 may well be sent something else by an honest one.
 */
export class SizeGuard {
  /** Whether the stream's picture is over the cap: nothing of it is decoded until a keyframe within the cap arrives. */
  blocked = false;
  /** The size the last keyframe declared. */
  size: PictureSize | null = null;

  constructor(private readonly foreign: Verdict = "drop") {}

  /**
   * Whether a frame may be decoded. `codec` is its MIME type as the browser
   * reports it, or VP8 when nothing else was negotiated; undefined when
   * neither is known.
   */
  check(data: Uint8Array, codec?: string): Verdict {
    try {
      return this.decide(data, codec);
    } catch {
      return this.blocked ? "drop" : "pass";
    }
  }

  private decide(data: Uint8Array, codec?: string): Verdict {
    const known = codec === undefined ? undefined : codec.toLowerCase();
    if (known !== undefined && known !== VP8) return this.blocked ? "drop" : this.foreign;
    const head = vp8Header(data);
    if (!head.key) return this.blocked ? "drop" : "pass";
    if (!head.size) {
      // Known to be VP8, a keyframe with a broken header is refused by any
      // decoder anyway. Not known, it may be another codec altogether.
      if (known === undefined && !this.blocked) return this.foreign;
      return "drop";
    }
    this.size = head.size;
    this.blocked = !fitsCap(head.size.width, head.size.height);
    return this.blocked ? "drop" : "pass";
  }
}
