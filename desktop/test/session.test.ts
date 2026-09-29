import { afterEach, describe, expect, it, vi } from "vitest";
import { OP, encodeFrame } from "../src/main/rpc/frame";
import { RpcSession, type AppConnection } from "../src/main/rpc/session";
import type { RpcActivity } from "../src/shared/bridge";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const sent: unknown[] = [];
  const updates: (RpcActivity | null)[] = [];
  const conn: AppConnection = { id: "c1", transport: "ipc", send: (j) => sent.push(j), sendFrame: (f) => sent.push(f.json), close: () => {} };
  const session = new RpcSession(conn, "123456789012345678", {
    discordEndpoints: async () => [],
    readyUser: () => ({ id: "1" }),
    onActivity: (_id, _cid, a) => updates.push(a),
    onRelayChange: () => {},
    log: () => {},
  });
  const set = (details: string) => {
    const json = { cmd: "SET_ACTIVITY", nonce: details, args: { pid: 1, activity: { details } } };
    session.handle({ op: OP.FRAME, json, raw: encodeFrame(OP.FRAME, json) });
  };
  return { session, sent, updates, set };
}

describe("RpcSession", () => {
  it("takes five updates in twenty seconds and holds the latest of the rest", () => {
    vi.useFakeTimers();
    const { sent, updates, set } = setup();
    for (let i = 1; i <= 8; i++) set(`n${i}`);
    // every command is still answered at once
    expect(sent).toHaveLength(8);
    expect(updates.map((u) => u?.details)).toEqual(["n1", "n2", "n3", "n4", "n5"]);
    vi.advanceTimersByTime(20_000);
    expect(updates.map((u) => u?.details)).toEqual(["n1", "n2", "n3", "n4", "n5", "n8"]);
  });

  it("clears the activity when the program goes", () => {
    const { session, updates, set } = setup();
    set("playing");
    session.end();
    expect(updates.at(-1)).toBeNull();
  });
});
