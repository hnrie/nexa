/**
 * The words the app shows outside the page come from the page, which means
 * they arrive as whatever the other side sent. English has to survive that.
 */
import { describe, expect, it } from "vitest";
import { nativeStrings, setNativeStrings, stringsDiffer } from "../src/main/strings";

describe("native strings", () => {
  it("starts in English", () => {
    expect(nativeStrings().open).toBe("Open Nexa");
    expect(nativeStrings().offlineRetry).toBe("Try now");
  });

  it("takes what the page sent and keeps English for the rest", () => {
    const s = setNativeStrings({ open: "Nexa öffnen", quit: "Nexa beenden" });
    expect(s.open).toBe("Nexa öffnen");
    expect(s.quit).toBe("Nexa beenden");
    expect(s.view).toBe("View");
  });

  it("ignores anything that is not a usable label", () => {
    const s = setNativeStrings({ open: "   ", mute: 7, deafen: "x".repeat(200), view: " Ansicht " });
    expect(s.open).toBe("Open Nexa");
    expect(s.mute).toBe("Mute");
    expect(s.deafen).toBe("Deafen");
    expect(s.view).toBe("Ansicht");
  });

  it("falls back whole when nothing usable arrives", () => {
    for (const junk of [null, undefined, "hello", 3, []]) {
      expect(setNativeStrings(junk).open).toBe("Open Nexa");
    }
  });

  it("knows when a set is the same, so the menus are not rebuilt for nothing", () => {
    const a = setNativeStrings({ open: "Abrir Nexa" });
    const b = setNativeStrings({ open: "Abrir Nexa" });
    expect(stringsDiffer(a, b)).toBe(false);
    expect(stringsDiffer(b, setNativeStrings({ open: "Ouvrir Nexa" }))).toBe(true);
  });
});
