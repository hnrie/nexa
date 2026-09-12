import { attachmentUrl, channels } from "./channels";
import { ApiError, api } from "./client";
import { one, recordRequests, recordUploads } from "./testing";

beforeEach(() => {
  api.baseUrl = "";
  api.setToken(null);
});

describe("channels", () => {
  it("creates a DM from recipient ids", async () => {
    const calls = recordRequests();
    await channels.createDM(["42"]);
    expect(one(calls)).toMatchObject({
      method: "POST",
      path: "/users/@me/channels",
      body: { recipient_ids: ["42"] },
    });
  });

  it("includes a name when creating a group DM", async () => {
    const calls = recordRequests();
    await channels.createDM(["42", "43"], "book club");
    expect(one(calls).body).toEqual({ recipient_ids: ["42", "43"], name: "book club" });
  });

  it("lists DMs", async () => {
    const calls = recordRequests([]);
    await channels.listDMs();
    expect(one(calls)).toMatchObject({ method: "GET", path: "/users/@me/channels" });
  });

  it("reads one channel", async () => {
    const calls = recordRequests();
    await channels.get("7");
    expect(one(calls)).toMatchObject({ method: "GET", path: "/channels/7" });
  });

  it("patches a channel", async () => {
    const calls = recordRequests();
    await channels.patch("7", { name: "new name" });
    expect(one(calls)).toMatchObject({
      method: "PATCH",
      path: "/channels/7",
      body: { name: "new name" },
    });
  });

  it("PUTs a group icon with the file's content type", async () => {
    const uploads = recordUploads();
    await channels.uploadIcon("7", new Blob([], { type: "image/gif" }));
    const c = one(uploads);
    expect(c.path).toBe("/channels/7/icon");
    expect(c.opts?.method).toBe("PUT");
    expect(c.opts?.headers).toEqual({ "Content-Type": "image/gif" });
  });

  it("deletes a group icon", async () => {
    const calls = recordRequests();
    await channels.deleteIcon("7");
    expect(one(calls)).toMatchObject({ method: "DELETE", path: "/channels/7/icon" });
  });

  it("adds a recipient", async () => {
    const calls = recordRequests();
    await channels.addRecipient("7", "42");
    expect(one(calls)).toMatchObject({ method: "POST", path: "/channels/7/recipients/42" });
  });

  it("removes a recipient", async () => {
    const calls = recordRequests();
    await channels.removeRecipient("7", "42");
    expect(one(calls)).toMatchObject({ method: "DELETE", path: "/channels/7/recipients/42" });
  });

  it("announces typing", async () => {
    const calls = recordRequests();
    await channels.typing("7");
    expect(one(calls)).toMatchObject({ method: "POST", path: "/channels/7/typing" });
  });

  it("POSTs an attachment as an octet stream", async () => {
    const uploads = recordUploads();
    const data = new Uint8Array([1, 2, 3]);
    await channels.uploadAttachment("7", data);
    const c = one(uploads);
    expect(c.path).toBe("/channels/7/attachments");
    expect(c.body).toBe(data);
    expect(c.opts?.method ?? "POST").toBe("POST");
  });

  it("lists pins", async () => {
    const calls = recordRequests([]);
    await channels.pins("7");
    expect(one(calls)).toMatchObject({ method: "GET", path: "/channels/7/pins" });
  });

  it("pins and unpins a message", async () => {
    const pinCalls = recordRequests();
    await channels.pin("7", "99");
    expect(one(pinCalls)).toMatchObject({ method: "PUT", path: "/channels/7/pins/99" });

    const unpinCalls = recordRequests();
    await channels.unpin("7", "99");
    expect(one(unpinCalls)).toMatchObject({ method: "DELETE", path: "/channels/7/pins/99" });
  });
});

describe("attachments", () => {
  it("builds the media url for a blob", () => {
    expect(attachmentUrl("77")).toBe("/media/attachments/77");
    api.baseUrl = "https://chat.example";
    expect(attachmentUrl("77")).toBe("https://chat.example/media/attachments/77");
  });

  it("downloads bytes with the bearer token", async () => {
    api.setToken("tok");
    let seenUrl = "";
    let seenAuth: string | null = null;
    api.fetchImpl = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      seenUrl = String(input);
      seenAuth = (init?.headers as Record<string, string> | undefined)?.["Authorization"] ?? null;
      return Promise.resolve(new Response(new Uint8Array([7, 8, 9])));
    }) as unknown as typeof fetch;

    const buf = await channels.downloadAttachment("77");
    expect(seenUrl).toBe("/media/attachments/77");
    expect(seenAuth).toBe("Bearer tok");
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([7, 8, 9]));
  });

  it("throws an ApiError when the download fails", async () => {
    api.fetchImpl = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: "not_found", message: "Gone." } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      )) as unknown as typeof fetch;

    const err = (await channels.downloadAttachment("77").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("not_found");
  });
});
