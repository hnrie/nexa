import { useMessages, type DecryptedMessage } from "./messages";

function msg(id: string, channel = "c1"): DecryptedMessage {
  return {
    id,
    channel_id: channel,
    author_id: "u1",
    type: "default",
    ciphertext: null,
    key_conv_id: null,
    key_epoch: null,
    reply_to_id: null,
    mentions: [],
    mention_roles: [],
    mention_everyone: false,
    attachments: [],
    reactions: [],
    flags: 0,
    edited_at: null,
    created_at: Number(id),
  };
}

describe("messages store", () => {
  beforeEach(() => useMessages.getState().clearAll());

  it("keeps ids ascending and deduplicated across inserts", () => {
    const s = useMessages.getState();
    s.insert("c1", [msg("30"), msg("10")]);
    s.insert("c1", [msg("20")]);
    s.insert("c1", [msg("40")]);
    s.insert("c1", [msg("20"), msg("9")]);
    expect(useMessages.getState().channels["c1"]?.ids).toEqual(["9", "10", "20", "30", "40"]);
    s.insert("c1", [msg("100"), msg("99")]);
    expect(useMessages.getState().channels["c1"]?.ids).toEqual(["9", "10", "20", "30", "40", "99", "100"]);
  });

  it("compares ids numerically, not lexically", () => {
    const s = useMessages.getState();
    s.insert("c1", [msg("9"), msg("10")]);
    expect(useMessages.getState().channels["c1"]?.ids).toEqual(["9", "10"]);
  });

  it("removes messages and updates in place", () => {
    const s = useMessages.getState();
    s.insert("c1", [msg("1"), msg("2"), msg("3")]);
    s.remove("c1", "2");
    expect(useMessages.getState().channels["c1"]?.ids).toEqual(["1", "3"]);
    s.update("c1", { ...msg("3"), edited_at: 5 });
    expect(useMessages.getState().channels["c1"]?.byId["3"]?.edited_at).toBe(5);
    s.update("c1", msg("404"));
    expect(useMessages.getState().channels["c1"]?.ids).toEqual(["1", "3"]);
  });

  it("keeps this viewer's reactions when a message is edited", () => {
    const s = useMessages.getState();
    s.insert("c1", [msg("1")]);
    s.setReaction("c1", "1", "👍", "me", true, true);
    s.update("c1", { ...msg("1"), edited_at: 5, reactions: [{ emoji: "👍", count: 1, me: false }] });
    const m = useMessages.getState().channels["c1"]?.byId["1"];
    expect(m?.edited_at).toBe(5);
    expect(m?.reactions).toEqual([{ emoji: "👍", count: 1, me: true }]);
  });

  it("toggles reaction summaries", () => {
    const s = useMessages.getState();
    s.insert("c1", [msg("1")]);
    s.setReaction("c1", "1", "👍", "u2", true, false);
    s.setReaction("c1", "1", "👍", "me", true, true);
    let r = useMessages.getState().channels["c1"]?.byId["1"]?.reactions;
    expect(r).toEqual([{ emoji: "👍", count: 2, me: true }]);
    s.setReaction("c1", "1", "👍", "me", false, true);
    r = useMessages.getState().channels["c1"]?.byId["1"]?.reactions;
    expect(r).toEqual([{ emoji: "👍", count: 1, me: false }]);
    s.setReaction("c1", "1", "👍", "u2", false, false);
    expect(useMessages.getState().channels["c1"]?.byId["1"]?.reactions).toEqual([]);
  });

  it("tracks pending messages and resolves them by nonce", () => {
    const s = useMessages.getState();
    s.addPending({ tmpId: "t1", nonce: "n1", channelId: "c1", authorId: "me", payload: { t: "hi" }, createdAt: 1, status: "sending" });
    s.addPending({ tmpId: "t2", nonce: "n2", channelId: "c1", authorId: "me", payload: { t: "yo" }, createdAt: 2, status: "sending" });
    s.failPending("c1", "t2");
    expect(useMessages.getState().channels["c1"]?.pending.map((p) => p.status)).toEqual(["sending", "failed"]);
    s.resolvePendingByNonce("c1", "n1");
    expect(useMessages.getState().channels["c1"]?.pending.map((p) => p.tmpId)).toEqual(["t2"]);
    s.removePending("c1", "t2");
    expect(useMessages.getState().channels["c1"]?.pending).toEqual([]);
  });
});
