import { describe, expect, it } from "vitest";
import { compareVersions, parseManifest } from "../src/main/update/manifest";

const MAC = `version: 1.2.0
files:
  - url: Evilion-Chat-1.2.0-mac-x64.zip
    sha512: aGVsbG8=
    size: 1234
  - url: Evilion-Chat-1.2.0-mac-arm64.zip
    sha512: d29ybGQ=
    size: 5678
    blockMapSize: 99
path: Evilion-Chat-1.2.0-mac-x64.zip
sha512: aGVsbG8=
releaseDate: '2026-09-14T01:02:03.000Z'
`;

describe("update manifests", () => {
  it("reads electron-builder's latest-mac.yml", () => {
    const m = parseManifest(MAC);
    expect(m.version).toBe("1.2.0");
    expect(m.releaseDate).toBe("2026-09-14T01:02:03.000Z");
    expect(m.files).toEqual([
      { url: "Evilion-Chat-1.2.0-mac-x64.zip", sha512: "aGVsbG8=", size: 1234 },
      { url: "Evilion-Chat-1.2.0-mac-arm64.zip", sha512: "d29ybGQ=", size: 5678 },
    ]);
  });

  it("compares versions", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
    expect(compareVersions("v1.0.1", "1.0.0")).toBe(1);
  });
});
