import { emojiShortcode, ensureShortcodes, mightHaveShortcode, onShortcodesReady, shortcodesReady } from "./shortcodes";

describe("whether a message could hold a :shortcode:", () => {
  it("says yes for a name between colons", () => {
    expect(mightHaveShortcode("that was :joy: honestly")).toBe(true);
    expect(mightHaveShortcode(":+1:")).toBe(true);
    expect(mightHaveShortcode(":woman_technologist:")).toBe(true);
  });

  it("says no for the colons every link, time and reply has", () => {
    // these used to fetch both name tables for the first page of almost any channel
    expect(mightHaveShortcode("https://example.com:8080/path")).toBe(false);
    expect(mightHaveShortcode("see you at 12:30")).toBe(false);
    expect(mightHaveShortcode("re: the plan")).toBe(false);
    expect(mightHaveShortcode("note: one: two")).toBe(false);
    expect(mightHaveShortcode("no colons at all")).toBe(false);
  });
});

describe("the name an emoji goes by", () => {
  beforeAll(async () => {
    if (shortcodesReady()) return;
    const ready = new Promise<void>((resolve) => onShortcodesReady(resolve));
    ensureShortcodes();
    await ready;
  });

  it("is the one that types it", () => {
    expect(emojiShortcode("\u{1F600}")).toBe("grinning");
    expect(emojiShortcode("\u{1F602}")).toBe("joy");
  });

  it("does not care whether the variation selector is there", () => {
    expect(emojiShortcode("\u2764\uFE0F")).toBe("heart");
    expect(emojiShortcode("\u2764")).toBe("heart");
  });

  it("names a skin tone, and the name brings the same emoji back", () => {
    const name = emojiShortcode("\u{1F44B}\u{1F3FD}");
    expect(name).toBe("wave_tone3");
  });

  it("has nothing for what is not an emoji", () => {
    expect(emojiShortcode("abc")).toBeUndefined();
  });
});
