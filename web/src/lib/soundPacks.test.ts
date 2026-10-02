import { DEFAULT_SOUNDS, encodeWav, filesInUse, newPackId, sanitizeSounds, sourceOf, type SoundSettings } from "./soundPacks";

const file = (blob: string) => ({ blob, key: "a".repeat(44), name: "doorbell.mp3", ms: 900, size: 2048 });

describe("sound packs", () => {
  it("keep only what a pack can be, whatever another device saved", () => {
    expect(sanitizeSounds(undefined)).toEqual(DEFAULT_SOUNDS);
    const got = sanitizeSounds({
      pack: "pmine1234",
      volume: 250,
      off: ["ring", "ring", "bogus", 4],
      packs: [
        // saved when the app had packs of its own to base one on, which is left behind
        { id: "pmine1234", name: "  My   sounds  ", base: "retro", files: { message: file("123"), mention: { blob: "x", key: "short" }, nonsense: file("9") } },
        // Nexa's own pack is not a custom pack's id, and nor is a duplicate
        { id: "nexa", name: "Sneaky", files: {} },
        { id: "pmine1234", name: "Again", files: {} },
        { id: "pother567", name: "x".repeat(200), files: [] },
      ],
    });
    expect(got.pack).toBe("pmine1234");
    expect(got.volume).toBe(100);
    expect(got.off).toEqual(["ring"]);
    expect(got.packs.map((p) => p.id)).toEqual(["pmine1234", "pother567"]);
    expect(got.packs[0]).toEqual({ id: "pmine1234", name: "My sounds", files: { message: file("123") } });
    expect(got.packs[1]!.name).toHaveLength(40);
  });

  it("go back to Nexa's own sounds when the pack chosen is gone", () => {
    expect(sanitizeSounds({ pack: "pgone12345", packs: [] }).pack).toBe("nexa");
    // the Chime, Retro and Soft packs the app once had are gone too
    expect(sanitizeSounds({ pack: "retro" }).pack).toBe("nexa");
  });

  it("play a custom pack's own recording, and Nexa's for the rest", () => {
    const st: SoundSettings = { pack: "pmine1234", volume: 80, off: [], packs: [{ id: "pmine1234", name: "Mine", files: { message: file("55") } }] };
    expect(sourceOf(st, "message")).toEqual({ kind: "file", file: file("55") });
    expect(sourceOf(st, "mention")).toEqual({ kind: "nexa" });
    // a pack named to preview, not the one in use
    expect(sourceOf(st, "message", "nexa")).toEqual({ kind: "nexa" });
    expect(sourceOf(st, "message", "pnothere1")).toEqual({ kind: "nexa" });
    expect([...filesInUse(st)]).toEqual(["55"]);
  });

  it("make pack ids that cannot be mistaken for Nexa's own", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newPackId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(sanitizeSounds({ pack: id, packs: [{ id, name: "x", files: {} }] }).pack).toBe(id);
  });

  it("write a WAV any browser can play", async () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 32_000);
    const bytes = new Uint8Array(await wav.arrayBuffer());
    const text = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
    const view = new DataView(bytes.buffer);
    expect(wav.type).toBe("audio/wav");
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 12)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(32_000);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(46, true)).toBe(0x7fff);
    expect(view.getInt16(48, true)).toBe(-0x8000);
  });
});
