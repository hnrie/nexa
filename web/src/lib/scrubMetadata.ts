/**
 * Photos and videos carry details nobody sees until they go looking: where a
 * picture was taken, the phone or camera that took it and its serial number,
 * when, what edited it, comments, XMP and IPTC. Attachments are encrypted on
 * this device, so this is the only place they can be taken out: every file
 * goes through scrubFile before it is staged (lib/attachments.ts).
 *
 * Nothing is re-encoded. Whole segments, chunks and boxes are left out or
 * blanked, and what a picture needs to be shown as it was stays: a JPEG's
 * orientation, colour profile and Adobe marker, and a PNG's colour chunks. A
 * file this does not recognise (HEIC among them), or cannot follow as far as
 * it has to, is sent exactly as it is.
 *
 * The rules are the server's (internal/media/scrub.go, for the files it keeps
 * readable), and both are checked against internal/media/testdata/scrub. Only
 * the parts of a file that say how it is laid out are read, a window at a
 * time, and the cleaned file is put together from slices of the original, so
 * a video of a gigabyte is never held in memory.
 */

type Bytes = Uint8Array<ArrayBuffer>;

/** How much of a file is read at a time while its structure is followed. */
const WINDOW = 256 * 1024;

/** Reads a file a window at a time. */
class Source {
  readonly size: number;
  private buf: Bytes = new Uint8Array(0);
  private base = 0;

  constructor(private readonly blob: Blob) {
    this.size = blob.size;
  }

  /** What has been read last, and where in the file it starts. */
  window(): { buf: Bytes; base: number } {
    return { buf: this.buf, base: this.base };
  }

  /** The n bytes at off when they have been read already, without waiting. */
  peek(off: number, n: number): Bytes | null {
    const i = off - this.base;
    return i >= 0 && n >= 0 && i + n <= this.buf.length ? this.buf.subarray(i, i + n) : null;
  }

  /** The n bytes at off, or null when the file ends before them. They stay valid after later reads. */
  async at(off: number, n: number): Promise<Bytes | null> {
    if (off < 0 || n < 0 || off + n > this.size) return null;
    const hit = this.peek(off, n);
    if (hit) return hit;
    const buf = new Uint8Array(await this.blob.slice(off, Math.min(this.size, off + Math.max(n, WINDOW))).arrayBuffer());
    if (buf.length < n) return null;
    this.buf = buf;
    this.base = off;
    return buf.subarray(0, n);
  }
}

/**
 * How many pieces a cleaned file may be made of. A real photo or video comes
 * to a handful; only a file built to cost memory, with metadata between every
 * other chunk, gets near it, and it is left as it is.
 */
const MAX_PARTS = 1 << 16;

/** A stretch of a cleaned file: bytes [off, off + n) of the original, new bytes, or zeros. */
type Part = { off: number; n: number } | { lit: Bytes } | { zeros: number };

/** A cleaned file, in order. */
class Plan {
  readonly parts: Part[] = [];

  keep(off: number, n: number): void {
    if (n <= 0) return;
    const last = this.parts[this.parts.length - 1];
    if (last && "off" in last && last.off + last.n === off) last.n += n;
    else this.parts.push({ off, n });
  }

  add(lit: Bytes): void {
    if (lit.length) this.parts.push({ lit });
  }

  zeros(n: number): void {
    if (n > 0) this.parts.push({ zeros: n });
  }

  /** The cleaned file, made of slices of the original. */
  blobParts(file: Blob): BlobPart[] {
    const out: BlobPart[] = [];
    for (const p of this.parts) {
      if ("lit" in p) out.push(p.lit);
      else if ("zeros" in p) {
        const zero = new Uint8Array(Math.min(p.zeros, 1 << 20));
        for (let left = p.zeros; left > 0; left -= zero.length) out.push(left >= zero.length ? zero : zero.subarray(0, left));
      } else out.push(file.slice(p.off, p.off + p.n));
    }
    return out;
  }
}

/**
 * The file without the hidden details a photo or a video carries, with the
 * same name and type; the very same file when there is nothing to take out,
 * or it is not one this knows. It never fails: a file it cannot read goes as
 * it came.
 */
export async function scrubFile(file: File): Promise<File> {
  try {
    const plan = await planScrub(new Source(file));
    return plan ? new File(plan.blobParts(file), file.name, { type: file.type, lastModified: file.lastModified }) : file;
  } catch {
    return file;
  }
}

/** Whether b holds s (a string of byte values) at i. */
function has(b: Uint8Array, i: number, s: string): boolean {
  if (b.length < i + s.length) return false;
  for (let k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) return false;
  return true;
}

function text(b: Uint8Array, i: number, n: number): string {
  return String.fromCharCode(...b.subarray(i, i + n));
}

function view(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function concat(parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** How to write src without its metadata, or null to leave it as it is. The format is told by the first bytes alone. */
async function planScrub(src: Source): Promise<Plan | null> {
  const h = await src.at(0, Math.min(src.size, 12));
  if (!h) return null;
  if (h.length >= 3 && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return planJPEG(src);
  if (has(h, 0, "\x89PNG\r\n\x1a\n")) return planPNG(src);
  if (has(h, 0, "RIFF") && has(h, 8, "WEBP")) return planWebP(src);
  if (has(h, 0, "GIF87a") || has(h, 0, "GIF89a")) return planGIF(src);
  if (has(h, 4, "ftyp")) return planMP4(src);
  return null;
}

/** How far into a JPEG its picture data is looked for: what comes before it is a handful of segments of at most 64 KB each. */
const JPEG_HEAD_MAX = 16 << 20;

/**
 * Leaves out the segments before a JPEG's picture data that describe it
 * rather than draw it: Exif and XMP (APP1), IPTC (APP13), comments, and every
 * other application segment but the three a picture is drawn with (JFIF, an
 * ICC colour profile, Adobe's colour transform). An orientation other than
 * upright comes back as an Exif segment holding nothing else, so the photo
 * still shows the right way up. Everything from the picture data on is kept
 * as it is.
 */
async function planJPEG(src: Source): Promise<Plan | null> {
  const kept: { b: Uint8Array; app0: boolean }[] = [];
  let orient = 0;
  let order = "";
  let exifSeen = false;
  let pos = 2;
  for (;;) {
    let m = await src.at(pos, 2);
    if (!m || m[0] !== 0xff) return null;
    while (m[1] === 0xff) {
      // fill bytes before a marker
      if (++pos > JPEG_HEAD_MAX) return null;
      m = src.peek(pos, 2) ?? (await src.at(pos, 2));
      if (!m) return null;
    }
    const marker = m[1]!;
    if (marker === 0xda) break; // start of scan: the picture data
    if (marker === 0x00 || marker === 0xd8 || marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      // no length
      if (kept.push({ b: m, app0: false }) > MAX_PARTS) return null;
      pos += 2;
      continue;
    }
    const l = await src.at(pos + 2, 2);
    if (!l) return null;
    const n = ((l[0]! << 8) | l[1]!) + 2;
    const seg = n < 4 ? null : await src.at(pos, n);
    if (!seg) return null;
    const body = seg.subarray(4);
    let keep = true;
    if (marker === 0xe0) keep = has(body, 0, "JFIF\0");
    else if (marker === 0xe1) {
      keep = false;
      if (!exifSeen && has(body, 0, "Exif\0\0")) {
        // browsers turn a photo by the first Exif segment
        exifSeen = true;
        [orient, order] = exifOrientation(body.subarray(6));
      }
    } else if (marker === 0xe2) keep = has(body, 0, "ICC_PROFILE\0");
    else if (marker === 0xee) keep = has(body, 0, "Adobe");
    else if ((marker >= 0xe3 && marker <= 0xef) || marker === 0xfe) keep = false;
    if (keep) kept.push({ b: seg, app0: marker === 0xe0 });
    if ((pos += n) > JPEG_HEAD_MAX || kept.length > MAX_PARTS) return null;
  }
  const head: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];
  let i = 0;
  for (; i < kept.length && kept[i]!.app0; i++) head.push(kept[i]!.b);
  if (orient > 1) head.push(exifOrientationOnly(orient, order));
  for (; i < kept.length; i++) head.push(kept[i]!.b);
  const out = concat(head);
  if (out.length === pos) {
    const was = await src.at(0, pos);
    if (was && equal(out, was)) return null;
  }
  const plan = new Plan();
  plan.add(out);
  plan.keep(pos, src.size - pos);
  return plan;
}

/**
 * The orientation in Exif's TIFF data, read the way browsers do (a single
 * SHORT in the first directory), with the byte order the data is written in,
 * "II" or "MM". It is 0 when there is none.
 */
function exifOrientation(t: Uint8Array): [number, string] {
  if (t.length < 8) return [0, ""];
  const order = text(t, 0, 2);
  if (order !== "II" && order !== "MM") return [0, ""];
  const le = order === "II";
  const v = view(t);
  if (v.getUint16(2, le) !== 42) return [0, ""];
  const ifd = v.getUint32(4, le);
  if (ifd < 8 || ifd > t.length - 2) return [0, ""];
  for (let i = 0, n = v.getUint16(ifd, le); i < n; i++) {
    const e = ifd + 2 + 12 * i;
    if (e + 12 > t.length) break;
    if (v.getUint16(e, le) !== 0x0112) continue;
    if (v.getUint16(e + 2, le) !== 3 || v.getUint32(e + 4, le) !== 1) break;
    const o = v.getUint16(e + 8, le);
    if (o >= 1 && o <= 8) return [o, order];
    break;
  }
  return [0, ""];
}

/**
 * An Exif segment that says nothing but which way up a photo goes: a TIFF
 * header in the byte order the original used, then a first directory with
 * that one entry and no directory after it.
 */
function exifOrientationOnly(o: number, order: string): Bytes {
  const seg = new Uint8Array(36);
  seg.set([0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0]); // APP1, length, "Exif\0\0"
  const le = order === "II";
  seg[10] = seg[11] = le ? 0x49 : 0x4d;
  const t = new DataView(seg.buffer, 10);
  t.setUint16(2, 42, le);
  t.setUint32(4, 8, le); // the first directory, right after the header
  t.setUint16(8, 1, le); // one entry
  t.setUint16(10, 0x0112, le); // Orientation
  t.setUint16(12, 3, le); // SHORT
  t.setUint32(14, 1, le); // one of them
  t.setUint16(18, o, le); // then two bytes of padding and no next directory
  return seg;
}

/**
 * The ancillary PNG chunks a picture is drawn with: transparency, colour,
 * size and the frames of an animation. Every other ancillary chunk (text,
 * time, Exif and whatever else a program added) is left out; critical chunks
 * all stay, known or not.
 */
const PNG_KEPT = new Set(["tRNS", "cHRM", "gAMA", "iCCP", "sBIT", "sRGB", "cICP", "mDCv", "cLLi", "bKGD", "hIST", "pHYs", "sPLT", "acTL", "fcTL", "fdAT"]);

/** Keeps a PNG's critical chunks and the ones in PNG_KEPT, each with the checksum it came with, and nothing after the end. */
async function planPNG(src: Source): Promise<Plan | null> {
  const plan = new Plan();
  plan.keep(0, 8);
  let changed = false;
  for (let pos = 8; ; ) {
    const c = src.peek(pos, 8) ?? (await src.at(pos, 8));
    if (!c) return null;
    const n = view(c).getUint32(0);
    const type = text(c, 4, 4);
    if (n > 0x7fffffff || n > src.size - pos - 12 || !/^[A-Za-z]{4}$/.test(type)) return null;
    if ((c[4]! & 0x20) === 0 || PNG_KEPT.has(type)) {
      plan.keep(pos, n + 12);
      if (plan.parts.length > MAX_PARTS) return null;
    } else changed = true;
    pos += n + 12;
    if (type === "IEND") {
      // what follows the end is not drawn; a cropped screenshot can carry
      // the rest of the uncropped one there
      changed ||= pos < src.size;
      break;
    }
  }
  return changed ? plan : null;
}

/** Leaves out a WebP's EXIF and XMP chunks and clears the flags that said they were there. Everything else, an animation's frames included, is kept as it was. */
async function planWebP(src: Source): Promise<Plan | null> {
  const h = (await src.at(0, 12))!;
  const end = 8 + view(h).getUint32(4, true);
  if (end < 12 || end > src.size) return null;
  const kept: { off: number; n: number }[] = [];
  let size = 4;
  let vp8x = -1;
  let changed = end < src.size; // bytes after the RIFF's end, which nothing reads
  for (let pos = 12; pos < end; ) {
    const c = src.peek(pos, 8) ?? (await src.at(pos, 8));
    if (!c || end - pos < 8) return null;
    const n = view(c).getUint32(4, true);
    const next = pos + 8 + n + (n & 1);
    if (next > end) return null;
    const id = text(c, 0, 4);
    if (id === "EXIF" || id === "XMP ") changed = true;
    else {
      if (id === "VP8X" && vp8x < 0) {
        if (n < 10) return null;
        vp8x = pos;
      }
      if (kept.push({ off: pos, n: next - pos }) > MAX_PARTS) return null;
      size += next - pos;
    }
    pos = next;
  }
  let x: Bytes | null = null;
  if (vp8x >= 0) {
    x = (await src.at(vp8x, 9))!.slice();
    if (x[8]! & 0x0c) {
      // EXIF (0x08) and XMP (0x04)
      x[8] = x[8]! & ~0x0c;
      changed = true;
    }
  }
  if (!changed) return null;
  const riff = new Uint8Array(12);
  riff.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]); // "RIFF", size, "WEBP"
  view(riff).setUint32(4, size, true);
  const plan = new Plan();
  plan.add(riff);
  for (const c of kept) {
    if (c.off === vp8x && x) {
      plan.add(x);
      plan.keep(c.off + 9, c.n - 9);
    } else plan.keep(c.off, c.n);
  }
  return plan;
}

/** Leaves out a GIF's comments and its XMP. The frames, the loop count and every other extension stay as they were. */
async function planGIF(src: Source): Promise<Plan | null> {
  const h = await src.at(0, 13);
  if (!h) return null;
  let pos = 13;
  if (h[10]! & 0x80) pos += 3 << ((h[10]! & 7) + 1); // global colour table
  const plan = new Plan();
  plan.keep(0, pos);
  let changed = false;
  for (;;) {
    const b = src.peek(pos, 1) ?? (await src.at(pos, 1));
    if (!b) return null;
    if (b[0] === 0x3b) {
      // the trailer; whatever follows is not part of the picture
      plan.keep(pos, 1);
      return !changed && pos + 1 === src.size ? null : plan;
    } else if (b[0] === 0x2c) {
      // a frame
      const d = await src.at(pos, 10);
      if (!d) return null;
      let p = pos + 10;
      if (d[9]! & 0x80) p += 3 << ((d[9]! & 7) + 1); // local colour table
      p = await gifSkipBlocks(src, p + 1); // past the LZW code size
      if (p < 0) return null;
      plan.keep(pos, p - pos);
      if (plan.parts.length > MAX_PARTS) return null;
      pos = p;
    } else if (b[0] === 0x21) {
      // an extension
      const e = await src.at(pos, 2);
      if (!e) return null;
      const p = await gifSkipBlocks(src, pos + 2);
      if (p < 0) return null;
      let drop = e[1] === 0xfe; // a comment
      if (e[1] === 0xff) {
        const a = await src.at(pos + 2, 12);
        drop = !!a && a[0] === 11 && has(a, 1, "XMP DataXMP");
      }
      if (drop) changed = true;
      else {
        plan.keep(pos, p - pos);
        if (plan.parts.length > MAX_PARTS) return null;
      }
      pos = p;
    } else return null;
  }
}

/** Where the data sub-blocks starting at p end, past their empty terminator, or -1 when the file ends first. */
async function gifSkipBlocks(src: Source, p: number): Promise<number> {
  for (;;) {
    if (!(src.peek(p, 1) ?? (await src.at(p, 1)))) return -1;
    // a frame is thousands of blocks: they are followed through what is read in
    const { buf, base } = src.window();
    let i = p - base;
    while (i < buf.length) {
      const n = buf[i]!;
      if (n === 0) return base + i + 1;
      i += 1 + n;
    }
    p = base + i;
  }
}

/** The extended type of an MP4 box that holds XMP. */
const XMP_UUID = "\xbe\x7a\xcf\xcb\x97\xa9\x42\xe8\x9c\x71\x99\x94\x91\xe3\xaf\xac";

/**
 * ftyp brands of files made of the same boxes as MP4 that are not video:
 * pictures (HEIF, HEIC, AVIF, Canon's raw CR3), whose boxes hold the picture
 * itself, and sound, whose tags are what a listener wants.
 */
const NOT_VIDEO_BRANDS = new Set([
  "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs",
  "mif1", "mif2", "msf1", "miaf", "MiHA", "MiHB", "MiHE", "MiPr",
  "avif", "avis", "avio", "avci", "avcs", "jpeg", "jpgs", "crx ",
  "M4A ", "M4B ", "M4P ", "F4A ", "F4B ",
]);

/** Writes lit, or n zero bytes, at off. */
interface Mp4Edit {
  off: number;
  n: number;
  lit?: Bytes;
}

/**
 * Blanks an MP4's or a QuickTime movie's metadata where it lies: udta and
 * meta boxes in the movie and in each track, a meta box at the top, and XMP
 * boxes become free boxes of the same size with nothing in them, and the
 * times the movie, its tracks and their media were made are zeroed. No byte
 * moves, so the offsets the movie's index holds stay right.
 */
async function planMP4(src: Source): Promise<Plan | null> {
  const n = view((await src.at(0, 8))!).getUint32(0);
  if (n < 16 || n > 4096) return null;
  const ftyp = await src.at(0, n);
  if (!ftyp) return null;
  // 12 is the minor version
  for (let i = 8; i + 4 <= n; i += 4) if (i !== 12 && NOT_VIDEO_BRANDS.has(text(ftyp, i, 4))) return null;
  const w = { edits: [] as Mp4Edit[], moov: false };
  if (!(await walkBoxes(src, w, 0, src.size, "")) || !w.moov || !w.edits.length || w.edits.length > MAX_PARTS) return null;
  const plan = new Plan();
  let at = 0;
  for (const e of w.edits) {
    plan.keep(at, e.off - at);
    if (e.lit) plan.add(e.lit);
    else plan.zeros(e.n);
    at = e.off + e.n;
  }
  plan.keep(at, src.size - at);
  return plan;
}

/** Goes through the boxes in [start, end): the file itself when `inside` is "", or the contents of a box of that type. */
async function walkBoxes(src: Source, w: { edits: Mp4Edit[]; moov: boolean }, start: number, end: number, inside: string): Promise<boolean> {
  for (let pos = start; pos < end; ) {
    const h = end - pos < 8 ? null : await src.at(pos, 8);
    if (!h) {
      // a few zero bytes may pad out the end
      const rest = await src.at(pos, end - pos);
      return !!rest && end - pos < 8 && rest.every((b) => b === 0);
    }
    let size = view(h).getUint32(0);
    let hdr = 8;
    const type = text(h, 4, 4);
    if (size === 1) {
      // the size follows, in 64 bits
      const l = end - pos < 16 ? null : await src.at(pos + 8, 8);
      if (!l) return false;
      const big = view(l).getBigUint64(0);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) return false;
      size = Number(big);
      hdr = 16;
    } else if (size === 0) {
      // the last box, to the end of the file
      if (inside !== "") return false;
      size = end - pos;
    }
    if (size < hdr || size > end - pos || w.edits.length > MAX_PARTS) return false;
    if (inside === "" && type === "moov") {
      w.moov = true;
      if (!(await walkBoxes(src, w, pos + hdr, pos + size, "moov"))) return false;
    } else if ((inside === "moov" && type === "trak") || (inside === "trak" && type === "mdia")) {
      if (!(await walkBoxes(src, w, pos + hdr, pos + size, type))) return false;
    } else if (((inside === "moov" || inside === "trak") && (type === "udta" || type === "meta")) || (inside === "" && type === "meta")) {
      await blank(src, w, pos, size, hdr);
    } else if (inside !== "mdia" && type === "uuid") {
      const u = await src.at(pos + hdr, 16);
      if (u && size - hdr >= 16 && text(u, 0, 16) === XMP_UUID) await blank(src, w, pos, size, hdr);
    } else if ((inside === "moov" && type === "mvhd") || (inside === "trak" && type === "tkhd") || (inside === "mdia" && type === "mdhd")) {
      await clearTimes(src, w, pos, size, hdr);
    }
    pos += size;
  }
  return true;
}

/** Turns the box at pos into a free box of the same size, zeroed. */
async function blank(src: Source, w: { edits: Mp4Edit[] }, pos: number, size: number, hdr: number): Promise<void> {
  const h = (await src.at(pos, hdr))!.slice();
  h.set([0x66, 0x72, 0x65, 0x65], 4); // "free"
  w.edits.push({ off: pos, n: hdr, lit: h }, { off: pos + hdr, n: size - hdr });
}

/** Zeroes the creation and modification times of a movie, track or media header, which say when a video was recorded. */
async function clearTimes(src: Source, w: { edits: Mp4Edit[] }, pos: number, size: number, hdr: number): Promise<void> {
  const v = await src.at(pos + hdr, 1);
  if (!v || v[0]! > 1) return;
  const n = v[0] === 1 ? 16 : 8; // version 0: two 32-bit times; version 1: two 64-bit ones
  if (size - hdr < 4 + n) return;
  const t = await src.at(pos + hdr + 4, n);
  if (t && t.some((b) => b !== 0)) w.edits.push({ off: pos + hdr + 4, n });
}
