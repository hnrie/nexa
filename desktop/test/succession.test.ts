/**
 * Finding the older copy to take over from (src/main/succession.ts): which
 * lines of `ps` are other copies of the app, and which version a copy is.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, dialog: {} }));

const { plistVersion, runningCopies } = await import("../src/main/succession");

// `ps -axww -o pid=,comm=`: each process's program, without its arguments
const PS = [
  "  101 /Applications/Nexa.app/Contents/MacOS/Nexa",
  "  102 /Applications/Nexa.app/Contents/Frameworks/Nexa Helper (Renderer).app/Contents/MacOS/Nexa Helper (Renderer)",
  "  103 /Applications/Nexa.app/Contents/Frameworks/Nexa Helper (GPU).app/Contents/MacOS/Nexa Helper (GPU)",
  "  104 /Volumes/Nexa 1.1.0-arm64/Nexa.app/Contents/MacOS/Nexa",
  "  105 /Users/tester/My Apps/Nexa.app/Contents/MacOS/Nexa",
  "  106 /Applications/Nexa Beta.app/Contents/MacOS/Nexa Beta",
  "  107 /usr/bin/grep",
  "  108 /Applications/Other.app/Contents/MacOS/Other",
].join("\n");

describe("runningCopies", () => {
  it("finds the app's main processes, with their bundles, and leaves out this one, its helpers and other apps", () => {
    expect(runningCopies(PS, "Nexa", 104)).toEqual([
      { pid: 101, bundle: "/Applications/Nexa.app" },
      { pid: 105, bundle: "/Users/tester/My Apps/Nexa.app" },
    ]);
  });

  it("finds nothing when no other copy runs", () => {
    expect(runningCopies("  104 /Volumes/Nexa/Nexa.app/Contents/MacOS/Nexa\n", "Nexa", 104)).toEqual([]);
    expect(runningCopies("", "Nexa", 1)).toEqual([]);
  });
});

describe("plistVersion", () => {
  it("reads the version electron-builder writes, and nothing from a plist without one", () => {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>xyz.evilion.chat</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.5</string>
</dict>
</plist>`;
    expect(plistVersion(plist)).toBe("1.0.5");
    expect(plistVersion("<plist><dict></dict></plist>")).toBeNull();
  });
});
