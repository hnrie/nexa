import { createServer } from "node:http";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { getVersion: () => "1.2.8" } }));
import { downloadMacArchive } from "../src/main/update/mac";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
async function fixture(bytes: string) {
  const server = createServer((_req, res) => { res.write(bytes); res.end(); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no local server");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "nexa-update-test-"));
  cleanups.push(() => { server.close(); fs.rmSync(work, { recursive: true, force: true }); });
  return { url: `http://127.0.0.1:${address.port}/archive.zip`, dest: path.join(work, "archive.zip") };
}
describe("signed Mac archive size", () => {
  it("streams a valid chunked response and hashes exactly its signed bytes", async () => {
    const { url, dest } = await fixture("abcd");
    expect(await downloadMacArchive(url, dest, 4, () => undefined)).toBe(createHash("sha512").update("abcd").digest("base64"));
    expect(fs.readFileSync(dest, "utf8")).toBe("abcd");
  });
  it.each([["abcde", "exceeds"], ["abc", "incomplete"]])("refuses %s and deletes the partial file", async (bytes, reason) => {
    const { url, dest } = await fixture(bytes);
    await expect(downloadMacArchive(url, dest, 4, () => undefined)).rejects.toThrow(reason);
    expect(fs.existsSync(dest)).toBe(false);
  });
  it("rejects absent and unreasonable signed sizes before downloading", async () => {
    for (const size of [0, -1, NaN, Infinity, 3 * 1024 ** 3])
      await expect(downloadMacArchive("http://127.0.0.1:1/", "/unused", size, () => undefined)).rejects.toThrow("invalid signed update size");
  });
});
