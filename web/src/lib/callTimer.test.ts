import { afterEach, describe, expect, it } from "vitest";
import type { VoiceState } from "@/api/types";
import { callSeconds, callSince } from "./callTimer";
import { serverNow, setServerNow } from "./serverClock";

function vs(user_id: string, joined_at: number, call_since?: number): VoiceState {
  return { user_id, channel_id: "c", session_id: "s", self_mute: false, self_deaf: false, video: false, streaming: false, server_mute: false, server_deaf: false, joined_at, call_since };
}

describe("callSince", () => {
  it("is null for a channel nobody is in", () => {
    expect(callSince({}, "c")).toBeNull();
    expect(callSince({ c: {} }, "c")).toBeNull();
  });

  it("takes the server's start of the call, not when the people still there joined", () => {
    expect(callSince({ c: { b: vs("b", 5000, 1000) } }, "c")).toBe(1000);
  });

  it("falls back to the earliest join on a server that does not say", () => {
    expect(callSince({ c: { a: vs("a", 3000), b: vs("b", 2000) } }, "c")).toBe(2000);
  });
});

describe("callSeconds", () => {
  it("counts whole seconds and never goes below zero", () => {
    expect(callSeconds(1000, 62_999)).toBe(61);
    expect(callSeconds(5000, 1000)).toBe(0);
  });
});

describe("serverClock", () => {
  afterEach(() => setServerNow(undefined));

  it("moves this device's time by how far its clock is off", () => {
    setServerNow(10_000, 50_000);
    expect(serverNow(60_000)).toBe(20_000);
  });

  it("trusts this device's clock when the server sent none", () => {
    setServerNow(undefined, 50_000);
    expect(serverNow(60_000)).toBe(60_000);
  });
});
