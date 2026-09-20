import { api } from "./client";
import { expressions } from "./expressions";

/** A fetchImpl that answers one canned NDJSON stream. */
function streamFetch(lines: string[], status = 201): typeof fetch {
  const body = lines.join("\n") + "\n";
  return (async () =>
    new Response(body, { status, headers: { "Content-Type": "application/x-ndjson" } })) as unknown as typeof fetch;
}

describe("importTelegramStream", () => {
  const realFetch = api.fetchImpl;
  const realToken = api.getToken();
  afterEach(() => {
    api.fetchImpl = realFetch;
    api.setToken(realToken);
  });

  it("reports progress per line and resolves with the pack", async () => {
    api.setToken("tok");
    api.fetchImpl = streamFetch([
      JSON.stringify({ phase: "fetch", done: 1, total: 2 }),
      JSON.stringify({ phase: "fetch", done: 2, total: 2 }),
      JSON.stringify({ phase: "store", done: 1, total: 2, imported: 1, skipped: 0, failed: 0 }),
      JSON.stringify({ done: true, pack: { id: "9" }, imported: 2, skipped: 0, failed: 0, total: 2 }),
    ]);
    const seen: [number, number, string][] = [];
    const res = await expressions.importTelegramStream("https://t.me/addstickers/x", (done, total, phase) => {
      seen.push([done, total, phase]);
    });
    expect(res.imported).toBe(2);
    expect((res.pack as unknown as { id: string }).id).toBe("9");
    expect(seen).toEqual([
      [1, 2, "fetch"],
      [2, 2, "fetch"],
      [1, 2, "store"],
    ]);
  });

  it("throws the server envelope on a refused request", async () => {
    api.setToken("tok");
    api.fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { code: "invalid_pack_link", message: "bad link" } }), { status: 400 })) as unknown as typeof fetch;
    await expect(expressions.importTelegramStream("nope")).rejects.toMatchObject({ code: "invalid_pack_link" });
  });

  it("throws the stream's own error line", async () => {
    api.setToken("tok");
    api.fetchImpl = streamFetch([JSON.stringify({ error: { code: "telegram_unavailable", message: "down" } })]);
    await expect(expressions.importTelegramStream("https://t.me/addstickers/x")).rejects.toMatchObject({ code: "telegram_unavailable" });
  });

  it("sends the bearer token", async () => {
    api.setToken("tok");
    let auth = "";
    api.fetchImpl = (async (url: unknown, init: unknown) => {
      auth = ((init as { headers: Record<string, string> }).headers["Authorization"] ?? "");
      return new Response("", { status: 500 });
    }) as unknown as typeof fetch;
    await expect(expressions.importTelegramStream("https://t.me/addstickers/x")).rejects.toMatchObject({ status: 500 });
    expect(auth).toBe("Bearer tok");
  });
});
