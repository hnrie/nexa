// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { encodeInviteKey, parseInviteFragment, shownInvite } from "./inviteLink";

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

describe("shownInvite", () => {
  it("reads an invite to this instance without its key, and leaves every other address alone", () => {
    const origin = window.location.origin;
    const host = window.location.host;
    expect(shownInvite(`${origin}/invite/LK3Zv5qH#k=0.Pam7abHfXosNdN9IkK6BEA89-isbcIuhTJB2kkoqs3g`)).toBe(`${host}/invite/LK3Zv5qH`);
    expect(shownInvite(`${origin}/invite/LK3Zv5qH`)).toBeNull();
    expect(shownInvite(`https://elsewhere.example/invite/LK3Zv5qH#k=0.abc`)).toBeNull();
    expect(shownInvite(`${origin}/channels/1/2#k=0.abc`)).toBeNull();
    expect(shownInvite("not a link")).toBeNull();
  });
});
