import { describe, expect, it } from "vitest";
import { nameStyleAnimated, nameStyleClass, readNameStyle, withEffect, type NameStyle } from "./nameStyle";

const gradient: NameStyle = { font: "comic", effect: "gradient", colors: [0xff0000, 0x0000ff] };

describe("name style motion", () => {
  it("preserves legacy motion when the profile has no explicit choice", () => {
    expect(nameStyleAnimated(gradient)).toBe(false);
    expect(nameStyleAnimated(withEffect(gradient, "aurora"))).toBe(true);
  });
  it("reads both explicit choices and keeps them when changing effects", () => {
    for (const animated of [false, true]) {
      const style = readNameStyle({ ...gradient, animated })!;
      expect(style.animated).toBe(animated);
      expect(withEffect(style, "holo").animated).toBe(animated);
      expect(nameStyleClass(style, false).includes("ns-animated")).toBe(animated);
    }
  });
  it("ignores malformed choices and leaves role colours in control", () => {
    expect(readNameStyle({ ...gradient, animated: "true" })).toEqual(gradient);
    expect(nameStyleClass({ ...gradient, animated: true }, true)).toBe("ns-font");
    expect(nameStyleClass({ ...withEffect(gradient, "flame"), animated: false }, false)).not.toContain("ns-animated");
  });
});
