import { request } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { Originals } from "../src/main/originals";

const instances: Originals[] = [];
afterEach(() => { for (const originals of instances.splice(0)) originals.dispose(); vi.useRealTimers(); });
function fixture() {
  const launch = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
  const originals = new Originals(launch);
  instances.push(originals);
  return { launch, originals };
}

it("hands the original bytes to the default browser at a private loopback URL", async () => {
  const { originals, launch } = fixture();
  const bytes = new Uint8Array([137, 80, 78, 71]);
  await originals.open(bytes, "image/png", "original.png");
  const url = launch.mock.calls[0]![0];
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{64}\/original.png$/);
  const response = await fetch(url);
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...bytes]);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  expect((await fetch(url, { method: "HEAD" })).status).toBe(200);
  expect((await fetch(url, { method: "POST" })).status).toBe(404);
  expect((await fetch(new URL("/", url))).status).toBe(404);
  expect((await fetch(url.replace(/\/[a-f0-9]{64}\//, `/${"0".repeat(64)}/`))).status).toBe(404);
  const status = await new Promise<number>((resolve, reject) => {
    request(url, { headers: { Host: "attacker.test" } }, (res) => { res.resume(); resolve(res.statusCode!); }).on("error", reject).end();
  });
  expect(status).toBe(404);
});

it("rejects active content and malformed inputs, and bounds retained originals", async () => {
  const { originals, launch } = fixture();
  for (const type of ["text/html", "image/svg+xml", "image/png\r\nX-Foo: bar", "application/octet-stream"]) {
    await expect(originals.open(new Uint8Array([1]), type, "x")).rejects.toThrow("invalid original");
  }
  await expect(originals.open("data", "image/png", "x")).rejects.toThrow();
  await expect(originals.open(new Uint8Array(), "image/png", "x")).rejects.toThrow();
  expect(launch).not.toHaveBeenCalled();
  for (let i = 0; i < 8; i++) await originals.open(new Uint8Array([1]), "image/png", "x");
  const first = launch.mock.calls[0]![0];
  await originals.open(new Uint8Array([2]), "image/png", "x");
  expect((await fetch(first)).status).toBe(404);
  expect((await fetch(launch.mock.calls[8]![0])).status).toBe(200);
});

it("expires the original after ten minutes and cleans up when the browser fails to open", async () => {
  const { originals, launch } = fixture();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await originals.open(new Uint8Array([1]), "image/png", "x.png");
  const url = launch.mock.calls[0]![0];
  vi.advanceTimersByTime(10 * 60_000);
  vi.useRealTimers();
  expect((await fetch(url)).status).toBe(404);
  launch.mockRejectedValueOnce(new Error("no browser"));
  await expect(originals.open(new Uint8Array([1]), "image/png", "x.png")).rejects.toThrow("no browser");
  expect((await fetch(launch.mock.calls[1]![0])).status).toBe(404);
});
