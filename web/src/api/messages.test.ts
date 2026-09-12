import { messages } from "./messages";
import { one, recordRequests } from "./testing";
import { MSG_FLAG_PINNED, MSG_FLAG_SUPPRESS_EMBEDS } from "./types";
import type { SendMessageRequest } from "./types";

const send: SendMessageRequest = {
  ciphertext: { v: 1, conv: "5", epoch: 2, iv: "aXY=", ct: "Y3Q=" },
  key_conv_id: "5",
  key_epoch: 2,
  mentions: [],
  nonce: "n-1",
};

describe("message flags", () => {
  it("matches the server's bit values", () => {
    expect(MSG_FLAG_PINNED).toBe(1);
    expect(MSG_FLAG_SUPPRESS_EMBEDS).toBe(4);
  });
});

describe("messages", () => {
  it("builds the history query and drops undefined bounds", async () => {
    const calls = recordRequests([]);
    await messages.list("7", { before: "99", limit: 50 });
    const c = one(calls);
    expect(c.method).toBe("GET");
    expect(c.path).toBe("/channels/7/messages");
    expect(c.opts?.query).toEqual({
      before: "99",
      after: undefined,
      around: undefined,
      limit: 50,
    });
  });

  it("reads one message", async () => {
    const calls = recordRequests();
    await messages.get("7", "99");
    expect(one(calls)).toMatchObject({ method: "GET", path: "/channels/7/messages/99" });
  });

  it("sends a message", async () => {
    const calls = recordRequests();
    await messages.send("7", send);
    expect(one(calls)).toMatchObject({
      method: "POST",
      path: "/channels/7/messages",
      body: send,
    });
  });

  it("edits a message", async () => {
    const calls = recordRequests();
    await messages.edit("7", "99", { ciphertext: send.ciphertext });
    expect(one(calls)).toMatchObject({
      method: "PATCH",
      path: "/channels/7/messages/99",
      body: { ciphertext: send.ciphertext },
    });
  });

  it("deletes a message", async () => {
    const calls = recordRequests();
    await messages.remove("7", "99");
    expect(one(calls)).toMatchObject({ method: "DELETE", path: "/channels/7/messages/99" });
  });

  it("acks a message", async () => {
    const calls = recordRequests();
    await messages.ack("7", "99");
    expect(one(calls)).toMatchObject({ method: "POST", path: "/channels/7/messages/99/ack" });
  });

  it("percent-encodes the emoji when reacting", async () => {
    const calls = recordRequests();
    await messages.react("7", "99", "🔥");
    expect(one(calls)).toMatchObject({
      method: "PUT",
      path: "/channels/7/messages/99/reactions/%F0%9F%94%A5/@me",
    });
  });

  it("percent-encodes a custom emoji name containing a slash", async () => {
    const calls = recordRequests();
    await messages.unreact("7", "99", "a/b:12");
    expect(one(calls)).toMatchObject({
      method: "DELETE",
      path: "/channels/7/messages/99/reactions/a%2Fb%3A12/@me",
    });
  });

  it("lists reactors with an optional limit", async () => {
    const calls = recordRequests([]);
    await messages.reactors("7", "99", "🔥", 25);
    const c = one(calls);
    expect(c.method).toBe("GET");
    expect(c.path).toBe("/channels/7/messages/99/reactions/%F0%9F%94%A5");
    expect(c.opts?.query).toEqual({ limit: 25 });
  });

  it("omits the reactor limit when not given", async () => {
    const calls = recordRequests([]);
    await messages.reactors("7", "99", "🔥");
    expect(one(calls).opts?.query).toEqual({ limit: undefined });
  });
});
