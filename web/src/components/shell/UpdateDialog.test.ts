import { describe, expect, it } from "vitest";
import { offerOf } from "./UpdateDialog";

const mac = { version: "1.1.0", url: "https://chat.evilion.xyz/desktop/nexa-1.1.0-mac-arm64.dmg" };

describe("offerOf", () => {
  it("offers a Mac app too old to update itself the new version's disk image before anything else", () => {
    expect(offerOf("build-2", { status: "idle" }, true, mac)).toMatchObject({ kind: "replace", url: mac.url, version: "1.1.0" });
  });

  it("sends a .deb, which cannot update itself, to the download page", () => {
    const manual = { status: "manual" as const, version: "1.1.0", downloadUrl: "https://chat.evilion.xyz/download" };
    expect(offerOf(null, manual, true, null)).toMatchObject({ kind: "manual", url: manual.downloadUrl });
  });

  it("follows the app's own update while it downloads and once it is ready", () => {
    expect(offerOf(null, { status: "downloading", version: "1.1.0", progress: 0.5 }, true, null)).toMatchObject({ kind: "downloading", progress: 0.5 });
    expect(offerOf(null, { status: "ready", version: "1.1.0" }, true, null)).toMatchObject({ kind: "ready", progress: 1 });
  });

  it("offers a new build of the page when the app has nothing", () => {
    expect(offerOf("build-2", { status: "idle" }, true, null)).toEqual({ kind: "web", key: "web:build-2" });
    expect(offerOf(null, null, false, null)).toBeNull();
  });
});
