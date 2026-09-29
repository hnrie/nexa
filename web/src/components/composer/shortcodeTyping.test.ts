// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadEmoji } from "@/components/pickers/emojiIndex";
import { closeShortcode, inCode, typedColon } from "./shortcodeTyping";

beforeAll(async () => {
  // without the list of drawn pictures every emoji counts as drawn
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
  await loadEmoji();
});
afterAll(() => vi.unstubAllGlobals());

const at = (text: string) => closeShortcode(text, text.length, 0);

describe("closeShortcode", () => {
  it("turns a :name: into its emoji as its closing colon goes in, and puts the caret after it", () => {
    expect(at("so sad :sob:")).toEqual({ value: "so sad \u{1F62D}", caret: "so sad \u{1F62D}".length });
    const mid = closeShortcode(":joy: then more", 5, 0);
    expect(mid).toEqual({ value: "\u{1F602} then more", caret: 2 });
  });

  it("uses the skin tone the picker uses", () => {
    expect(closeShortcode(":wave:", 6, 3)?.value).toBe("\u{1F44B}\u{1F3FD}");
  });

  it("reads a :name: where the message's markdown would, and nowhere else", () => {
    expect(at("hello:sob:")?.value).toBe("hello\u{1F62D}");
    // names are lower case, as the markdown has them
    expect(at(":SOB:")).toBeNull();
    expect(at("at 12:30:")).toBeNull();
    expect(at(":not_an_emoji_at_all:")).toBeNull();
  });

  it("leaves code alone", () => {
    expect(at("`:sob:")).toBeNull();
    expect(at("```\n:sob:")).toBeNull();
    expect(at("```\ncode\n```\n:sob:")?.value).toBe("```\ncode\n```\n\u{1F62D}");
  });

  it("leaves a name the server has a custom emoji of its own for, which sending makes that emoji", () => {
    expect(closeShortcode(":sob:", 5, 0, (name) => name === "sob")).toBeNull();
  });
});

describe("inCode", () => {
  it("counts fences and backticks before the caret", () => {
    expect(inCode("plain")).toBe(false);
    expect(inCode("a `code")).toBe(true);
    expect(inCode("a `code` done")).toBe(false);
    expect(inCode("```js\nlet x")).toBe(true);
  });
});

describe("typedColon", () => {
  it("is a colon typed, not pasted or composed", () => {
    expect(typedColon(new InputEvent("input", { inputType: "insertText", data: ":" }))).toBe(true);
    expect(typedColon(new InputEvent("input", { inputType: "insertFromPaste", data: ":" }))).toBe(false);
    expect(typedColon(new InputEvent("input", { inputType: "insertText", data: "a" }))).toBe(false);
    expect(typedColon(new InputEvent("input", { inputType: "insertText", data: ":", isComposing: true }))).toBe(false);
  });
});
