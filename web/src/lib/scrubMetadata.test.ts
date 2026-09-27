import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stage } from "./attachments";
import { scrubFile } from "./scrubMetadata";

// The server's scrubber is checked against the same files: each <name>.<ext>
// must come out as <name>.clean.<ext>, or as it was when there is none. They
// are made by internal/media/scrub_test.go (go test -update-scrub).
const DIR = resolve(__dirname, "../../../internal/media/testdata/scrub");
const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", mov: "video/quicktime", heic: "image/heic" };
const INPUTS = readdirSync(DIR)
  .filter((n) => !n.includes(".clean."))
  .sort();

// what the made-up camera wrote, none of which may be left
const SECRETS = ["SpyCam", "Phone X1", "EditPro", "SN-4815162342", "2026:09:01", "Hidden Lane", "Secret Place", "GPSLatitude", "+51.5074"];

function read(name: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(resolve(DIR, name)));
}

function cleanName(name: string): string {
  return name.replace(/(\.[^.]+)$/, ".clean$1");
}

/** The cleaned form of a fixture, or the fixture itself when it is to stay as it is. */
function expected(name: string): Uint8Array<ArrayBuffer> {
  return existsSync(resolve(DIR, cleanName(name))) ? read(cleanName(name)) : read(name);
}

function fileOf(bytes: Uint8Array<ArrayBuffer>, name: string): File {
  return new File([bytes], name, { type: TYPES[name.split(".").pop()!] ?? "", lastModified: 1_700_000_000_000 });
}

async function bytesOf(b: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await b.arrayBuffer());
}

function contains(b: Uint8Array, s: string): boolean {
  return Buffer.from(b).includes(s, 0, "latin1");
}

/** A JPEG's segments before its picture data: marker, then payload. */
function jpegSegments(b: Uint8Array): { marker: number; body: Uint8Array }[] {
  const out: { marker: number; body: Uint8Array }[] = [];
  for (let p = 2; ; ) {
    while (b[p] === 0xff && b[p + 1] === 0xff) p++;
    if (b[p] !== 0xff) throw new Error(`no marker at ${p}`);
    if (b[p + 1] === 0xda) return out;
    const n = (b[p + 2]! << 8) | b[p + 3]!;
    out.push({ marker: b[p + 1]!, body: b.subarray(p + 4, p + 2 + n) });
    p += 2 + n;
  }
}

describe("scrubFile", () => {
  afterEach(() => vi.restoreAllMocks());

  it("cleans every shared fixture to the very bytes the server does", async () => {
    expect(INPUTS.length).toBeGreaterThanOrEqual(12);
    for (const name of INPUTS) {
      const input = read(name);
      const f = fileOf(input, name);
      const out = await scrubFile(f);
      if (!existsSync(resolve(DIR, cleanName(name)))) {
        // nothing to take out: the very same file goes
        expect(out, name).toBe(f);
        continue;
      }
      expect(out, name).not.toBe(f);
      expect(out.name, name).toBe(name);
      expect(out.type, name).toBe(f.type);
      expect(Buffer.from(await bytesOf(out)).equals(Buffer.from(read(cleanName(name)))), name).toBe(true);
      for (const s of SECRETS) expect(contains(await bytesOf(out), s), `${name}: ${s}`).toBe(false);
      // cleaning again changes nothing
      expect(await scrubFile(out), name).toBe(out);
    }
  });

  it("keeps a photo's orientation, and only that, in an Exif of its own", async () => {
    for (const [name, orientation, order] of [
      ["jpeg-exif-be.jpg", 6, "MM"],
      ["jpeg-exif-le.jpg", 8, "II"],
    ] as const) {
      const out = await bytesOf(await scrubFile(fileOf(read(name), name)));
      const segs = jpegSegments(out);
      const apps = segs.filter((s) => (s.marker >= 0xe0 && s.marker <= 0xef) || s.marker === 0xfe);
      // JFIF, then the orientation, then the colour profile (and Adobe's marker)
      expect(apps.map((s) => s.marker).slice(0, 3)).toEqual([0xe0, 0xe1, 0xe2]);
      const exif = apps[1]!.body;
      expect(exif.length).toBe(32);
      const le = order === "II";
      const t = new DataView(exif.buffer, exif.byteOffset + 6, 26);
      expect(String.fromCharCode(exif[6]!, exif[7]!)).toBe(order);
      expect([t.getUint16(2, le), t.getUint32(4, le), t.getUint16(8, le)]).toEqual([42, 8, 1]);
      // Orientation, SHORT, one, the value; then no next directory
      expect([t.getUint16(10, le), t.getUint16(12, le), t.getUint32(14, le), t.getUint16(18, le), t.getUint32(22, le)]).toEqual([0x0112, 3, 1, orientation, 0]);
    }
    // upright needs no Exif at all
    const upright = await bytesOf(await scrubFile(fileOf(read("jpeg-upright.jpg"), "x.jpg")));
    expect(jpegSegments(upright).some((s) => s.marker === 0xe1)).toBe(false);
  });

  it("leaves a video's every byte in place but its metadata", async () => {
    for (const name of ["mp4-meta.mp4", "mov-meta.mov"]) {
      const input = read(name);
      const out = await bytesOf(await scrubFile(fileOf(input, name)));
      expect(out.length).toBe(input.length);
      expect(contains(out, "FRAME-DATA")).toBe(true);
      expect(contains(input, "SpyCam") && !contains(out, "SpyCam")).toBe(true);
    }
  });

  it("sends what it does not know, or cannot follow, as it is", async () => {
    const heic = read("heic-exif.heic");
    const avif = Buffer.from(heic.slice());
    avif.write("avif", 8, "latin1");
    // Canon's raw photos are made of a movie's boxes, with a brand of their own
    const cr3 = Buffer.from(read("mp4-meta.mp4"));
    cr3.write("crx ", 8, "latin1");
    const cases: Record<string, Uint8Array<ArrayBuffer>> = {
      "notes.txt": new TextEncoder().encode("SpyCam notes"),
      "empty.bin": new Uint8Array(0),
      "photo.heic": heic,
      "photo.avif": new Uint8Array(avif),
      "photo.cr3": new Uint8Array(cr3),
      "clip.webm": new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]),
      "start.jpg": new Uint8Array([0xff, 0xd8, 0xff]),
      "random.bin": new Uint8Array(4096).map((_, i) => (i * 131 + 7) & 0xff),
    };
    // a PNG built to cost memory: something to take out between every chunk
    const png = read("png-text.clean.png");
    const pair = Buffer.from("\0\0\0\0tEXt\0\0\0\0\0\0\0\x04gAMA\0\0\xb1\x8f\0\0\0\0", "latin1");
    cases["costly.png"] = new Uint8Array(Buffer.concat([png.subarray(0, 33), Buffer.concat(Array(65537).fill(pair)), png.subarray(33)]));
    for (const [name, bytes] of Object.entries(cases)) {
      const f = fileOf(bytes, name);
      expect(await scrubFile(f), name).toBe(f);
    }
  });

  it("never turns a file cut short into anything but itself or its cleaned form", async () => {
    for (const name of INPUTS) {
      const input = read(name);
      const clean = expected(name);
      const sos = name.endsWith(".jpg") ? Buffer.from(input).indexOf(Buffer.from([0xff, 0xda])) : -1;
      for (let n = 0; n < input.length; n++) {
        const f = fileOf(input.slice(0, n), name);
        const out = await scrubFile(f);
        if (out === f) continue;
        // a JPEG's head must be all there before it is touched
        expect(sos >= 0 && n < sos + 2, `${name} cut at ${n}`).toBe(false);
        const got = Buffer.from(await bytesOf(out));
        const cut = Buffer.from(clean.subarray(0, Math.max(0, clean.length - (input.length - n))));
        expect(got.equals(cut) || got.equals(Buffer.from(clean)), `${name} cut at ${n}`).toBe(true);
      }
    }
  });

  it("reads only the head of a big file, and builds the result from slices of it", async () => {
    const tail = new Uint8Array(48 << 20).fill(0x5a);
    const photo = read("jpeg-exif-be.jpg");
    const video = read("mp4-meta.mp4");
    // a video whose media data runs on for 48 MB after its boxes
    const bigVideo = new Uint8Array(video.length + 8);
    bigVideo.set(video);
    bigVideo.set([0, 0, 0, 0, 0x66, 0x72, 0x65, 0x65], video.length); // a last free box, to the end of the file
    for (const [name, head, cleanHead] of [
      ["big.jpg", photo, read("jpeg-exif-be.clean.jpg")],
      ["big.mp4", bigVideo, null],
    ] as const) {
      const f = new File([head, tail], name, { type: TYPES[name.split(".").pop()!]! });
      const reads = vi.spyOn(Blob.prototype, "arrayBuffer");
      const whole = [vi.spyOn(Blob.prototype, "text"), vi.spyOn(Blob.prototype, "stream")];
      const out = await scrubFile(f);
      const sizes = reads.mock.contexts.map((b) => (b as Blob).size);
      vi.restoreAllMocks();
      expect(Math.max(...sizes), name).toBeLessThanOrEqual(256 * 1024);
      expect(sizes.reduce((a, b) => a + b, 0), name).toBeLessThan(2 << 20);
      for (const w of whole) expect(w).not.toHaveBeenCalled();
      expect(out, name).not.toBe(f);
      if (cleanHead) expect(out.size).toBe(f.size - (photo.length - cleanHead.length));
      else expect(out.size).toBe(f.size);
      const end = await bytesOf(out.slice(out.size - 16));
      expect(end.every((b) => b === 0x5a), name).toBe(true);
      const start = await bytesOf(out.slice(0, 64));
      expect(contains(start, "SpyCam"), name).toBe(false);
    }
  });

  it("is what gets staged: the tray holds the cleaned file under its own name", async () => {
    const f = fileOf(read("jpeg-exif-be.jpg"), "IMG_0042.jpg");
    const st = await stage(f);
    expect(st.name).toBe("IMG_0042.jpg");
    expect(st.file.name).toBe("IMG_0042.jpg");
    expect(st.file.type).toBe("image/jpeg");
    expect(Buffer.from(await bytesOf(st.file)).equals(Buffer.from(read("jpeg-exif-be.clean.jpg")))).toBe(true);
    if (st.preview) URL.revokeObjectURL(st.preview);
  });
});
