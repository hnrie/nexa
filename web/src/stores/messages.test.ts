import type { MockInstance } from "vitest";
import { messages as messagesApi, type HistoryQuery } from "@/api/messages";
import { users as usersApi } from "@/api/users";
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

  it("counts poll votes as they come and go, taking the number of voters from the server", () => {
    const s = useMessages.getState();
    const tally = { answer_counts: [{ id: 1, count: 0, me_voted: false }, { id: 2, count: 0, me_voted: false }], total_voters: 0, expires_at: null, is_finalized: false };
    s.insert("c1", [{ ...msg("1"), webhook_id: "7", poll_results: tally }, msg("2")]);
    const poll = () => useMessages.getState().channels["c1"]?.byId["1"]?.poll_results;
    // someone else votes
    s.setPollVote("c1", "1", 2, true, false, 1);
    expect(poll()?.answer_counts.map((a) => a.count)).toEqual([0, 1]);
    expect(poll()?.total_voters).toBe(1);
    // this account votes: the answer to the vote first, then its echo, counted once
    s.setPollResults("c1", "1", { ...tally, answer_counts: [{ id: 1, count: 1, me_voted: true }, { id: 2, count: 1, me_voted: false }], total_voters: 2 });
    s.setPollVote("c1", "1", 1, true, true, 2);
    expect(poll()?.answer_counts).toEqual([{ id: 1, count: 1, me_voted: true }, { id: 2, count: 1, me_voted: false }]);
    expect(poll()?.total_voters).toBe(2);
    // the other voter takes theirs back; an older server sends no total
    s.setPollVote("c1", "1", 2, false, false);
    expect(poll()?.answer_counts.map((a) => a.count)).toEqual([1, 0]);
    expect(poll()?.total_voters).toBe(2);
    // a message with no poll is left alone
    s.setPollVote("c1", "2", 1, true, false, 1);
    expect(useMessages.getState().channels["c1"]?.byId["2"]?.poll_results).toBeUndefined();
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

describe("messages store loading", () => {
  // A channel of messages 1..300, served the way the server pages them.
  let history: DecryptedMessage[] = [];
  let list: MockInstance<typeof messagesApi.list>;
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => msg(String(from + i)));
  const idsOf = (from: number, to: number) => range(from, to).map((m) => m.id);
  const ids = () => useMessages.getState().channels["c1"]?.ids ?? [];
  const chan = () => useMessages.getState().channels["c1"]!;

  function serve(q: HistoryQuery = {}): DecryptedMessage[] {
    const limit = q.limit ?? 50;
    const half = Math.floor(limit / 2);
    if (q.around) {
      const at = Number(q.around);
      return [...history.filter((m) => Number(m.id) < at).slice(-half), ...history.filter((m) => Number(m.id) >= at).slice(0, limit - half)];
    }
    if (q.after) return history.filter((m) => Number(m.id) > Number(q.after)).slice(0, limit);
    if (q.before) return history.filter((m) => Number(m.id) < Number(q.before)).slice(-limit);
    return history.slice(-limit);
  }

  beforeEach(() => {
    useMessages.getState().clearAll();
    history = range(1, 300);
    vi.spyOn(usersApi, "get").mockRejectedValue(new Error("offline"));
    list = vi.spyOn(messagesApi, "list").mockImplementation(async (_c, q) => serve(q));
  });
  afterEach(() => vi.restoreAllMocks());

  it("counts a failed first load instead of throwing, and clears the count on success", async () => {
    list.mockRejectedValueOnce(new Error("offline"));
    await useMessages.getState().loadInitial("c1");
    expect(chan()).toMatchObject({ loaded: false, loading: false, failed: 1 });
    await useMessages.getState().loadInitial("c1");
    expect(chan()).toMatchObject({ loaded: true, loading: false, failed: 0, hasOlder: true, hasNewer: false });
    expect(ids()).toEqual(idsOf(251, 300));
  });

  it("keeps the reactions already shown when an edited copy arrives", () => {
    const s = useMessages.getState();
    s.insert("c1", [{ ...msg("1"), reactions: [{ emoji: "👍", count: 2, me: true }] }]);
    s.update("c1", { ...msg("1"), edited_at: 9, reactions: [{ emoji: "👍", count: 2, me: false }] });
    expect(chan().byId["1"]).toMatchObject({ edited_at: 9, reactions: [{ emoji: "👍", count: 2, me: true }] });
  });

  it("replaces the list with a jump far back, and loads newer pages up to the present", async () => {
    const s = useMessages.getState();
    await s.loadInitial("c1");
    await s.loadAround("c1", "100");
    expect(ids()).toEqual(idsOf(75, 124));
    expect(chan()).toMatchObject({ hasNewer: true, hasOlder: true, loading: false });
    // a live message past the gap waits for the newer pages
    s.insert("c1", [msg("301")]);
    expect(ids()).not.toContain("301");
    history.push(msg("301"));
    for (let i = 0; i < 5 && chan().hasNewer; i++) await s.loadNewer("c1");
    expect(chan().hasNewer).toBe(false);
    expect(ids()).toEqual(idsOf(75, 301));
  });

  it("joins a jump that overlaps what is loaded", async () => {
    const s = useMessages.getState();
    await s.loadInitial("c1");
    await s.loadAround("c1", "260");
    expect(ids()).toEqual(idsOf(235, 300));
    expect(chan().hasNewer).toBe(false);
  });

  it("goes back to the present keeping unsent messages, and ignores a load started before", async () => {
    const s = useMessages.getState();
    await s.loadInitial("c1");
    await s.loadAround("c1", "100");
    s.addPending({ tmpId: "t1", nonce: "n1", channelId: "c1", authorId: "me", payload: { t: "hi" }, createdAt: 1, status: "sending" });
    const stale = s.loadNewer("c1");
    s.returnToPresent("c1");
    await stale;
    expect(chan()).toMatchObject({ ids: [], loaded: false, loading: false, hasNewer: false });
    expect(chan().pending).toHaveLength(1);
    await s.loadInitial("c1");
    expect(ids()).toEqual(idsOf(251, 300));
  });

  it("brings loaded messages in line with the server after a reconnect", async () => {
    const s = useMessages.getState();
    await s.loadInitial("c1");
    await s.loadOlder("c1");
    const kept = chan().byId["290"];
    history = history
      .filter((m) => m.id !== "280" && m.id !== "220")
      .map((m) => (m.id === "270" ? { ...m, reactions: [{ emoji: "🎉", count: 1, me: false }] } : m));
    history.push(msg("301"));
    await s.syncGap("c1");
    expect(ids()).toEqual(idsOf(201, 301).filter((id) => id !== "280" && id !== "220"));
    expect(chan().byId["270"]?.reactions).toEqual([{ emoji: "🎉", count: 1, me: false }]);
    // unchanged messages keep their object, so their rows do not render again
    expect(chan().byId["290"]).toBe(kept);
  });
});
