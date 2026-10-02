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
        { id: "pmine1234", name: "  My   sounds  ", base: "retro", files: { message: file("123"), mention: { blob: "x", key: "short" }, nonsense: file("9") } },
        // a built-in's name is not a custom pack's id, and nor is a duplicate
        { id: "nexa", name: "Sneaky", base: "nexa", files: {} },
        { id: "pmine1234", name: "Again", base: "soft", files: {} },
        { id: "pother567", name: "x".repeat(200), base: "made-up", files: [] },
      ],
    });
    expect(got.pack).toBe("pmine1234");
    expect(got.volume).toBe(100);
    expect(got.off).toEqual(["ring"]);
    expect(got.packs.map((p) => p.id)).toEqual(["pmine1234", "pother567"]);
    expect(got.packs[0]!.name).toBe("My sounds");
    expect(got.packs[0]!.base).toBe("retro");
    expect(Object.keys(got.packs[0]!.files)).toEqual(["message"]);
    expect(got.packs[1]!.name).toHaveLength(40);
    expect(got.packs[1]!.base).toBe("nexa");
  });

  it("fall back to Nexa's pack when the one chosen is gone", () => {
    expect(sanitizeSounds({ pack: "pgone12345", packs: [] }).pack).toBe("nexa");
    expect(sanitizeSounds({ pack: "retro" }).pack).toBe("retro");
  });

  it("play a custom pack's own recording, and its base for the rest", () => {
    const st: SoundSettings = { pack: "pmine1234", volume: 80, off: [], packs: [{ id: "pmine1234", name: "Mine", base: "soft", files: { message: file("55") } }] };
    expect(sourceOf(st, "message")).toEqual({ kind: "file", file: file("55"), fallback: "soft" });
    expect(sourceOf(st, "mention")).toEqual({ kind: "builtin", pack: "soft" });
    // a pack named to preview, not the one in use
    expect(sourceOf(st, "message", "retro")).toEqual({ kind: "builtin", pack: "retro" });
    expect(sourceOf(st, "message", "pnothere1")).toEqual({ kind: "builtin", pack: "nexa" });
    expect([...filesInUse(st)]).toEqual(["55"]);
  });

  it("make pack ids that cannot be mistaken for a built-in", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newPackId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(sanitizeSounds({ pack: id, packs: [{ id, name: "x", base: "nexa", files: {} }] }).pack).toBe(id);
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
