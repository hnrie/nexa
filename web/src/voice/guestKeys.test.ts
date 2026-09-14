import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "@/crypto/bytes";
import { voiceFrameKey } from "@/crypto/conv";
import { clearGuestKeys, guestVoiceKeys, hasGuestKeys, openRelayedKeys, sealKeysForGuest, setGuestKey } from "./guestKeys";

const channel = "100";
const guest = "200";
const roots = new Map([
  [3, randomBytes(32)],
  [4, randomBytes(32)],
  [5, randomBytes(32)],
]);
const rootOf = (e: number) => roots.get(e);

afterEach(clearGuestKeys);

describe("guest call keys", () => {
  it("seal with the newest key held, indexed like the conversation's", () => {
    expect(guestVoiceKeys(channel)).toBeNull();
    setGuestKey(channel, 3, voiceFrameKey(roots.get(3)!, channel));
    expect(hasGuestKeys(channel)).toBe(true);
    const k = guestVoiceKeys(channel)!;
    expect(k.send).toBe(3);
    expect(k.keys).toEqual([{ index: 3, raw: voiceFrameKey(roots.get(3)!, channel) }]);
  });

  it("take newer keys from someone in the call, sealed under the link's", async () => {
    setGuestKey(channel, 3, voiceFrameKey(roots.get(3)!, channel));
    const sealed = await sealKeysForGuest(channel, guest, 3, [3, 4, 5], rootOf);
    expect(sealed?.keys.map((k) => k.epoch)).toEqual([4, 5]);
    // nothing in it is a key in the clear
    expect(JSON.stringify(sealed)).not.toContain(btoa(String.fromCharCode(...voiceFrameKey(roots.get(4)!, channel))));
    expect(await openRelayedKeys(channel, guest, sealed)).toBe(2);
    const k = guestVoiceKeys(channel)!;
    expect(k.send).toBe(5);
    expect(k.keys.find((x) => x.index === 5)?.raw).toEqual(voiceFrameKey(roots.get(5)!, channel));
    // the same relay again adds nothing
    expect(await openRelayedKeys(channel, guest, sealed)).toBe(0);
  });

  it("refuse keys sealed for another guest, under another link, or altered", async () => {
    setGuestKey(channel, 3, voiceFrameKey(roots.get(3)!, channel));
    const forOther = await sealKeysForGuest(channel, "999", 3, [4], rootOf);
    expect(await openRelayedKeys(channel, guest, forOther)).toBe(0);
    const otherBase = await sealKeysForGuest(channel, guest, 4, [5], rootOf);
    expect(await openRelayedKeys(channel, guest, otherBase)).toBe(0);
    const altered = (await sealKeysForGuest(channel, guest, 3, [4], rootOf))!;
    altered.keys[0]!.ct = altered.keys[0]!.ct.replace(/^./, (c) => (c === "A" ? "B" : "A"));
    expect(await openRelayedKeys(channel, guest, altered)).toBe(0);
    expect(await openRelayedKeys(channel, guest, { base: 3, keys: "nope" })).toBe(0);
    expect(guestVoiceKeys(channel)!.keys).toHaveLength(1);
  });

  it("have nothing to relay without the link's epoch or anything newer", async () => {
    expect(await sealKeysForGuest(channel, guest, 2, [3, 4], rootOf)).toBeNull();
    expect(await sealKeysForGuest(channel, guest, 5, [3, 4, 5], rootOf)).toBeNull();
  });
});
