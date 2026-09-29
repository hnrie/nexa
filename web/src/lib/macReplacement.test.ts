// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { DesktopRelease } from "@/api/desktop";
import { compareVersions, inOldMacApp, replacementIn } from "./macReplacement";

const ORIGIN = "https://chat.evilion.xyz";
const file = (name: string, arch: "x64" | "arm64", kind: "installer" | "zip" = "installer") => ({ os: "mac" as const, arch, kind, name, size: 1, sha256: "" });
const release = (version: string, files: DesktopRelease["files"]): DesktopRelease => ({ version, released_at: 0, files });

afterEach(() => {
  delete (window as Window & { evilionDesktop?: unknown }).evilionDesktop;
});

describe("compareVersions", () => {
  it("orders versions, with a pre-release below its release", () => {
    expect(compareVersions("1.0.5", "1.1.0")).toBe(-1);
    expect(compareVersions("1.1.0", "1.1.0")).toBe(0);
    expect(compareVersions("1.1.1", "1.1.0")).toBe(1);
    expect(compareVersions("1.1.0-beta", "1.1.0")).toBe(-1);
  });
});

describe("the old Mac app", () => {
  it("is a Mac copy before 1.1.0, and nothing else", () => {
    const w = window as Window & { evilionDesktop?: unknown };
    expect(inOldMacApp()).toBe(false);
    w.evilionDesktop = { platform: "darwin", version: "1.0.5" };
    expect(inOldMacApp()).toBe(true);
    w.evilionDesktop = { platform: "darwin", version: "1.1.0" };
    expect(inOldMacApp()).toBe(false);
    w.evilionDesktop = { platform: "win32", version: "1.0.5" };
    expect(inOldMacApp()).toBe(false);
  });

  it("is offered the disk image for its own chip from 1.1.0 on, and nothing from an older release", () => {
    const files = [file("nexa-1.1.0-mac-x64.dmg", "x64"), file("nexa-1.1.0-mac-arm64.dmg", "arm64"), file("nexa-1.1.0-mac-arm64.zip", "arm64", "zip")];
    expect(replacementIn(release("1.1.0", files), "arm64", ORIGIN)).toEqual({ version: "1.1.0", url: `${ORIGIN}/desktop/nexa-1.1.0-mac-arm64.dmg` });
    expect(replacementIn(release("1.1.0", files), "x64", ORIGIN)?.url).toBe(`${ORIGIN}/desktop/nexa-1.1.0-mac-x64.dmg`);
    // a Mac that will not say which chip it has gets Apple Silicon, as on the download page
    expect(replacementIn(release("1.1.0", files), null, ORIGIN)?.url).toBe(`${ORIGIN}/desktop/nexa-1.1.0-mac-arm64.dmg`);
    expect(replacementIn(release("1.0.6", files), "arm64", ORIGIN)).toBeNull();
    expect(replacementIn(release("1.1.0", []), "arm64", ORIGIN)).toBeNull();
    expect(replacementIn(null, "arm64", ORIGIN)).toBeNull();
  });
});
