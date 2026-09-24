import { beforeEach, describe, expect, it, vi } from "vitest";
import { messages as messagesApi } from "@/api/messages";
import { uploadStaged, type Staged } from "@/lib/attachments";
import { useAuth } from "@/stores/auth";
import { useKeys } from "@/stores/keys";
import { useMessages } from "@/stores/messages";
import { discardPending, retryPending, sendMessage, sendWithFiles } from "./send";

vi.mock("@/crypto/message", () => ({ encryptMessage: vi.fn(async () => "sealed") }));
vi.mock("@/lib/keyring", () => ({ channelKeyFor: vi.fn(() => new Uint8Array(32)) }));
vi.mock("@/lib/decrypt", () => ({ decryptForStore: vi.fn(async (m: { id: string }) => ({ ...m, payload: null })) }));
vi.mock("@/lib/attachments", async (orig) => ({ ...(await orig<typeof import("@/lib/attachments")>()), uploadStaged: vi.fn() }));

const sent: string[] = [];
let failNext = false;

function file(id: string): Staged {
  return { id, file: new File(["x"], `${id}.png`, { type: "image/png" }), name: `${id}.png`, spoiler: false, preview: null, progress: 0, error: null };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  sent.length = 0;
  failNext = false;
  useAuth.setState({ me: { id: "1" } as never });
  useKeys.setState({ ensureConvKey: async () => ({ epoch: 1 }) } as never);
  // a clean slate: clearAll keeps unsent messages on purpose
  useMessages.setState({ channels: {} });
  vi.spyOn(messagesApi, "send").mockImplementation(async (channelId, body) => {
    if (failNext) {
      failNext = false;
      throw new Error("offline");
    }
    sent.push(`${channelId}:${body.nonce}`);
    return { id: String(100 + sent.length), channel_id: channelId, author_id: "1", nonce: body.nonce } as never;
  });
});

const pendingTexts = (channelId: string) => (useMessages.getState().channels[channelId]?.pending ?? []).map((p) => p.payload.t);

describe("sending in order", () => {
  it("shows a message at once and sends it after the ones before it, even while they wait for a link preview", async () => {
    const preview = deferred<unknown[]>();
    const first = sendMessage("9", "see https://example.com", { embeds: preview.promise });
    const second = sendMessage("9", "and this");
    // both are in the list straight away, in the order they were written
    expect(pendingTexts("9")).toEqual(["see https://example.com", "and this"]);
    await new Promise((r) => setTimeout(r, 20));
    // the second waits for the first, which waits for its preview
    expect(sent).toEqual([]);
    preview.resolve([{ url: "https://example.com", title: "Example" }]);
    await Promise.all([first, second]);
    expect(sent.length).toBe(2);
    const nonces = (vi.mocked(messagesApi.send).mock.calls as unknown as [string, { nonce: string }][]).map((c) => c[1].nonce);
    expect(sent).toEqual(nonces.map((n) => `9:${n}`));
  });

  it("does not let a failed message hold up the next", async () => {
    failNext = true;
    const first = sendMessage("9", "one");
    const second = sendMessage("9", "two");
    await expect(first).rejects.toThrow();
    await second;
    expect(sent.length).toBe(1);
    // the failed one stays in the list to be retried
    expect(useMessages.getState().channels["9"]?.pending.map((p) => [p.payload.t, p.status])).toEqual([["one", "failed"]]);
  });
});

describe("sending with files", () => {
  const blob = (id: string) => ({ meta: { blob_id: id, name: `${id}.png`, type: "image/png", size: 1, key: "k" }, blob_id: id, size: 1 });
  const pending = (channelId: string) => useMessages.getState().channels[channelId]?.pending ?? [];

  it("shows the message at once with its upload, keeps other messages going, and sends it once the files are up", async () => {
    const up = deferred<ReturnType<typeof blob>>();
    vi.mocked(uploadStaged).mockImplementation(async () => up.promise);
    const done = sendWithFiles("9", "caption", [file("a")]);
    await new Promise((r) => setTimeout(r, 0));
    const p = pending("9")[0]!;
    expect(p.payload.t).toBe("caption");
    expect(p.status).toBe("sending");
    expect(p.upload?.files.map((f) => f.name)).toEqual(["a.png"]);
    expect(p.upload?.done).toBe(false);
    // a message sent meanwhile goes out without waiting for the upload
    await sendMessage("9", "quick one");
    expect(sent.length).toBe(1);
    up.resolve(blob("b1"));
    await done;
    expect(sent.length).toBe(2);
    const body = vi.mocked(messagesApi.send).mock.calls[1]![1] as { attachments?: { blob_id: string }[] };
    expect(body.attachments?.map((a) => a.blob_id)).toEqual(["b1"]);
    expect(pending("9")).toEqual([]);
  });

  it("keeps the card, full, while the message itself waits its turn", async () => {
    vi.mocked(uploadStaged).mockResolvedValue(blob("b1"));
    const slow = deferred<void>();
    // a message ahead of it that has not gone yet
    const first = sendMessage("9", "ahead", { embeds: slow.promise.then(() => []) });
    const done = sendWithFiles("9", "", [file("a")]);
    await new Promise((r) => setTimeout(r, 10));
    const p = pending("9").find((x) => x.upload)!;
    expect(p.upload?.done).toBe(true);
    expect(p.upload?.loaded).toBe(p.upload?.total);
    expect(p.payload.att?.map((a) => a.blob_id)).toEqual(["b1"]);
    slow.resolve();
    await Promise.all([first, done]);
    expect(sent.length).toBe(2);
  });

  it("stops the upload and takes the message away when it is cancelled", async () => {
    vi.mocked(uploadStaged).mockImplementation(
      (_ch, _f, _progress, _send, signal) =>
        new Promise((_res, rej) => {
          signal?.addEventListener("abort", () => rej(new Error("aborted")));
        }),
    );
    const done = sendWithFiles("9", "never mind", [file("a")]);
    await new Promise((r) => setTimeout(r, 0));
    const tmp = pending("9")[0]!.tmpId;
    discardPending("9", tmp);
    await done;
    expect(pending("9")).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("leaves a message whose files could not go up in the list, failed, and a retry sends them again", async () => {
    vi.mocked(uploadStaged).mockRejectedValueOnce(new Error("Upload failed")).mockResolvedValue(blob("b2"));
    await sendWithFiles("9", "caption", [file("a")]);
    const failed = pending("9")[0]!;
    expect(failed.status).toBe("failed");
    expect(failed.upload?.error).toBe("Upload failed");
    expect(sent).toEqual([]);
    await retryPending("9", failed.tmpId);
    expect(vi.mocked(uploadStaged)).toHaveBeenCalledTimes(2);
    expect(sent.length).toBe(1);
    expect(pending("9")).toEqual([]);
  });

  it("keeps every conversation's unsent messages through a reconnect", async () => {
    vi.mocked(uploadStaged).mockImplementation(() => new Promise(() => undefined));
    void sendWithFiles("9", "big file", [file("a")]);
    await new Promise((r) => setTimeout(r, 0));
    useMessages.getState().clearAll("other");
    expect(pending("9").map((p) => p.payload.t)).toEqual(["big file"]);
  });
});
