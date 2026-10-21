import { describe, expect, it } from "vitest";
import type { DesktopFile, DesktopRelease } from "@/api/desktop";
import { REQUIRED_DESKTOP, requiredUpdate } from "./requiredDesktop";

const file: DesktopFile = { os: "windows", arch: "x64", kind: "installer", name: "nexa-Setup-1.2.6-win-x64.exe", size: 1, sha256: "" };
const rel = (version: string): DesktopRelease => ({ version, released_at: 0, files: [file] });

describe("requiredUpdate", () => {
  it("holds a copy older than the required version once a release reaches it", () => {
    expect(requiredUpdate("1.2.5", rel(REQUIRED_DESKTOP), file, "https://nexa.test")).toEqual({
      running: "1.2.5",
      version: REQUIRED_DESKTOP,
      url: "https://nexa.test/desktop/nexa-Setup-1.2.6-win-x64.exe",
    });
    expect(requiredUpdate("1.0.0", rel("9.0.0"), null, "https://nexa.test")?.url).toBeNull();
  });

  it("lets a new enough copy, a browser, and a copy with nothing to update to go on", () => {
    expect(requiredUpdate(REQUIRED_DESKTOP, rel("9.0.0"), file, "https://nexa.test")).toBeNull();
    expect(requiredUpdate(null, rel("9.0.0"), file, "https://nexa.test")).toBeNull();
    expect(requiredUpdate("1.2.5", rel("1.2.5"), file, "https://nexa.test")).toBeNull();
    expect(requiredUpdate("1.2.5", null, null, "https://nexa.test")).toBeNull();
  });
});
