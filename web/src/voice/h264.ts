/**
 * H.264 frames in calls. A phone shares its screen with its hardware H.264
 * encoder, which every phone has (a VP8 encoder in hardware is rarer, and VP8
 * in software cannot keep up with a phone's screen), so the frame encryption
 * and the size cap both have to read H.264.
 *
 * A frame is Annex B: NAL units, each after a start code (00 00 01, or
 * 00 00 00 01). WebRTC's packetizer splits a frame at its start codes and
 * reads each NAL unit's header; the receiver's depacketizer reads the SPS and
 * PPS, and from each slice the PPS it names, and turns every start code into
 * the 4-byte one. So when a frame is sealed (frameCrypto.ts) these stay
 * readable: every NAL unit's header, the parameter sets and the other NAL
 * units that carry no picture (SEI, delimiters), and the start of each slice
 * header up to its PPS id. The picture itself, the rest of every slice, is
 * sealed, as Discord's DAVE protocol does it.
 *
 * Nothing here throws on any input.
 */

/** One NAL unit: where its start code starts, and where its own bytes (from the header on) start and end. */
export interface Nalu {
  start: number;
  payload: number;
  end: number;
}

/**
 * The NAL units of an Annex B frame, found exactly as WebRTC's
 * H264::FindNaluIndices finds them: a start code is 00 00 01, and a zero
 * before it makes it the 4-byte one (that zero is not the earlier unit's).
 */
export function naluIndices(data: Uint8Array): Nalu[] {
  const out: Nalu[] = [];
  if (data.length < 3) return out;
  const last = data.length - 3;
  for (let i = 0; i < last; ) {
    const third = data[i + 2]!;
    if (third > 1) {
      i += 3;
    } else if (third === 1) {
      if (data[i + 1] === 0 && data[i] === 0) {
        const start = i > 0 && data[i - 1] === 0 ? i - 1 : i;
        const prev = out[out.length - 1];
        if (prev) prev.end = start;
        out.push({ start, payload: i + 3, end: data.length });
      }
      i += 3;
    } else {
      i++;
    }
  }
  return out;
}

/** Whether a frame is Annex B H.264: it opens with a start code. A VP8 frame never does. */
export function isAnnexB(data: Uint8Array): boolean {
  return (data.length >= 4 && data[0] === 0 && data[1] === 0 && (data[2] === 1 || (data[2] === 0 && data[3] === 1)));
}

export const NALU_SLICE = 1;
export const NALU_IDR = 5;
export const NALU_SPS = 7;

/**
 * Reads the bits of a NAL unit's RBSP: the bytes after its header, with each
 * emulation prevention byte (the 03 in 00 00 03) skipped. Nothing past the
 * byte holding the last bit read is ever looked at, so on a sealed frame the
 * readable part decides alone how much of it a reading takes (`pos`).
 */
class Bits {
  private byte: number;
  private bit = 0;
  private zeros = 0;
  private last: number;

  constructor(private readonly data: Uint8Array, from: number, private readonly end: number) {
    this.byte = from;
    this.last = from - 1;
  }

  /** Where the reading has come to: just past the byte holding the last bit read. */
  get pos(): number {
    return this.last + 1;
  }

  /** One bit, or -1 past the end. */
  read(): number {
    if (this.bit === 0) {
      if (this.zeros >= 2 && this.byte < this.end && this.data[this.byte] === 3) {
        this.byte++;
        this.zeros = 0;
      }
      if (this.byte >= this.end) return -1;
    }
    const b = this.data[this.byte]!;
    const v = (b >> (7 - this.bit)) & 1;
    this.last = this.byte;
    if (++this.bit === 8) {
      this.bit = 0;
      this.zeros = b === 0 ? this.zeros + 1 : 0;
      this.byte++;
    }
    return v;
  }

  /** `n` bits (at most 32), or -1 past the end. */
  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const b = this.read();
      if (b < 0) return -1;
      v = v * 2 + b;
    }
    return v;
  }

  /** An unsigned Exp-Golomb number, or -1 past the end or when it is longer than 32 bits. */
  ue(): number {
    let zeros = 0;
    for (;;) {
      const b = this.read();
      if (b < 0) return -1;
      if (b === 1) break;
      if (++zeros > 31) return -1;
    }
    const rest = this.bits(zeros);
    return rest < 0 ? -1 : 2 ** zeros - 1 + rest;
  }

  /** A signed Exp-Golomb number, or NaN past the end. */
  se(): number {
    const k = this.ue();
    if (k < 0) return NaN;
    return k % 2 === 1 ? (k + 1) / 2 : -(k / 2);
  }
}

/**
 * How many of a slice's bytes, from its NAL header on, stay readable: the
 * header, then the slice header as far as its PPS id (first_mb_in_slice,
 * slice_type, pic_parameter_set_id), which the receiver's depacketizer reads
 * to find the parameter sets a keyframe needs. Null when the slice is too
 * short to hold them.
 */
export function sliceClearBytes(data: Uint8Array, nalu: Nalu): number | null {
  if (nalu.end - nalu.payload < 2) return null;
  const bits = new Bits(data, nalu.payload + 1, nalu.end);
  if (bits.ue() < 0 || bits.ue() < 0 || bits.ue() < 0) return null;
  return bits.pos - nalu.payload;
}

/**
 * How many of a NAL unit's bytes stay readable when its frame is sealed: all
 * of one that carries no picture, the header of one that does, and with a
 * slice also the start of its header (sliceClearBytes). Null for a slice too
 * short to read, which no encoder makes.
 */
export function naluClearBytes(data: Uint8Array, nalu: Nalu): number | null {
  const size = nalu.end - nalu.payload;
  if (size <= 0) return 0;
  const type = data[nalu.payload]! & 0x1f;
  if (type === NALU_SLICE || type === NALU_IDR) return sliceClearBytes(data, nalu);
  // data partitions, auxiliary and extension slices carry pictures too; no encoder in a call makes them
  if ((type >= 2 && type <= 4) || (type >= 19 && type <= 21)) return 1;
  return size;
}

/** Profiles whose SPS carries the chroma format, bit depths and scaling lists. */
const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);

function skipScalingList(bits: Bits, size: number): boolean {
  let last = 8;
  let next = 8;
  for (let j = 0; j < size; j++) {
    if (next !== 0) {
      const delta = bits.se();
      if (Number.isNaN(delta)) return false;
      next = (last + delta + 256) % 256;
    }
    last = next === 0 ? last : next;
  }
  return true;
}

/**
 * The picture an SPS sets up, as a decoder allocates it: whole macroblocks,
 * before any cropping (an SPS could otherwise crop a huge picture down to a
 * small one and slip past the cap). Null for an SPS that cannot be read.
 */
export function spsSize(data: Uint8Array, nalu: Nalu): { width: number; height: number } | null {
  const bits = new Bits(data, nalu.payload + 1, nalu.end);
  const profile = bits.bits(8);
  if (profile < 0 || bits.bits(16) < 0 || bits.ue() < 0) return null;
  if (HIGH_PROFILES.has(profile)) {
    const chroma = bits.ue();
    if (chroma < 0 || chroma > 3) return null;
    if (chroma === 3 && bits.read() < 0) return null;
    if (bits.ue() < 0 || bits.ue() < 0 || bits.read() < 0) return null;
    const lists = bits.read();
    if (lists < 0) return null;
    if (lists === 1) {
      for (let i = 0; i < (chroma === 3 ? 12 : 8); i++) {
        const present = bits.read();
        if (present < 0) return null;
        if (present === 1 && !skipScalingList(bits, i < 6 ? 16 : 64)) return null;
      }
    }
  }
  if (bits.ue() < 0) return null;
  const pocType = bits.ue();
  if (pocType < 0 || pocType > 2) return null;
  if (pocType === 0) {
    if (bits.ue() < 0) return null;
  } else if (pocType === 1) {
    if (bits.read() < 0 || Number.isNaN(bits.se()) || Number.isNaN(bits.se())) return null;
    const cycle = bits.ue();
    if (cycle < 0 || cycle > 255) return null;
    for (let i = 0; i < cycle; i++) if (Number.isNaN(bits.se())) return null;
  }
  if (bits.ue() < 0 || bits.read() < 0) return null;
  const widthMbs = bits.ue();
  const heightUnits = bits.ue();
  const frameMbsOnly = bits.read();
  if (widthMbs < 0 || heightUnits < 0 || frameMbsOnly < 0) return null;
  return { width: (widthMbs + 1) * 16, height: (2 - frameMbsOnly) * (heightUnits + 1) * 16 };
}
