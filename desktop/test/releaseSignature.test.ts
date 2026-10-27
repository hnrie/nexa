import { generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = await vi.hoisted(async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  return generateKeyPairSync("ed25519");
});
vi.mock("../src/main/update/releaseKey", () => ({ RELEASE_PUBLIC_KEY: fixture.publicKey.export({ type: "spki", format: "pem" }).toString() }));
vi.mock("electron", () => ({ net: { fetch: vi.fn() } }));
import { net } from "electron";
import { fetchRelease, signedReleaseBytes, verifyRelease } from "../src/main/update/releaseSignature";
import { SignedReleaseProvider } from "../src/main/update/provider";
import type { AppUpdater } from "electron-updater/out/AppUpdater";
import type { ProviderRuntimeOptions } from "electron-updater/out/providers/Provider";

const body = Buffer.from("version: 1.2.8\nfiles:\n  - url: nexa-1.2.8-win-x64.exe\n    sha512: abc\n    size: 1\n");
const good = sign(null, signedReleaseBytes("signed-latest.yml", body), fixture.privateKey).toString("base64");

beforeEach(() => vi.mocked(net.fetch).mockReset());
describe("authenticated release bytes", () => {
  it("accepts only the pinned key, exact bytes and exact platform feed", () => {
    expect(() => verifyRelease("signed-latest.yml", body, good)).not.toThrow();
    expect(() => verifyRelease("signed-latest-linux.yml", body, good)).toThrow();
    expect(() => verifyRelease("signed-latest.yml", Buffer.concat([body, Buffer.from("\n")]), good)).toThrow();
    const other = generateKeyPairSync("ed25519");
    const signature = sign(null, signedReleaseBytes("signed-latest.yml", body), other.privateKey).toString("base64");
    expect(() => verifyRelease("signed-latest.yml", body, signature)).toThrow();
    for (const missing of ["", "!".repeat(88), "a".repeat(88)]) expect(() => verifyRelease("signed-latest.yml", body, missing)).toThrow();
    expect(() => verifyRelease("../signed-latest.yml", body, good)).toThrow();
  });
  it("fetches, verifies and parses the same bytes through the real updater provider", async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response(body)).mockResolvedValueOnce(new Response(good));
    const provider = new SignedReleaseProvider({ provider: "custom", url: "https://nexa.test/desktop/" }, {} as AppUpdater, { platform: "win32", isUseMultipleRangeRequest: true } as ProviderRuntimeOptions);
    expect((await provider.getLatestVersion()).version).toBe("1.2.8");
    expect(vi.mocked(net.fetch).mock.calls.map(([url]) => url)).toEqual(["https://nexa.test/desktop/signed-latest.yml", "https://nexa.test/desktop/signed-latest.yml.sig"]);
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response(body)).mockResolvedValueOnce(new Response(""));
    await expect(provider.getLatestVersion()).rejects.toThrow("signature");
  });
  it("refuses missing signatures, modified bytes and oversized responses", async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response(body)).mockResolvedValueOnce(new Response("", { status: 404 }));
    await expect(fetchRelease("https://nexa.test/", "signed-latest.yml")).rejects.toThrow("signature");
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response("version: 9.9.9")).mockResolvedValueOnce(new Response(good));
    await expect(fetchRelease("https://nexa.test/", "signed-latest.yml")).rejects.toThrow("signature");
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response(new Uint8Array((1 << 20) + 1)));
    await expect(fetchRelease("https://nexa.test/", "signed-latest.yml")).rejects.toThrow("too large");
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response(body)).mockResolvedValueOnce(new Response("x".repeat(129)));
    await expect(fetchRelease("https://nexa.test/", "signed-latest.yml")).rejects.toThrow("too large");
  });
  it("allows an absent release feed but never an unsigned published one", async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response("", { status: 404 }));
    expect(await fetchRelease("https://nexa.test/", "signed-latest.yml")).toBeNull();
  });
});
