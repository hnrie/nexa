import { describe, expect, it } from "vitest";
import { encodeInviteKey, parseInviteFragment } from "./inviteLink";

describe("invite link key fragment", () => {
  it("round-trips a root key", () => {
    const root = new Uint8Array(32).map((_, i) => (i * 37) % 256);
    const frag = encodeInviteKey({ epoch: 3, root });
    expect(frag.startsWith("k=3.")).toBe(true);
    expect(frag.split(".")[1]).not.toMatch(/[+/=]/);
    const parsed = parseInviteFragment("#" + frag);
    expect(parsed?.epoch).toBe(3);
    expect(Array.from(parsed!.root)).toEqual(Array.from(root));
  });
  it("rejects malformed fragments", () => {
    expect(parseInviteFragment("")).toBeNull();
    expect(parseInviteFragment("#k=1.abc")).toBeNull();
    expect(parseInviteFragment("#k=x." + "A".repeat(43))).toBeNull();
  });
});
