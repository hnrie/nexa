import { beforeEach, describe, expect, it } from "vitest";
import { api } from "@/api/client";
import type { CaseMessage, MemberCase, NexaState } from "@/api/moderation";
import { caseStanding, formatSpan, mutedSentence, noticeTitle, SPAN } from "@/lib/moderation";
import { activeBan, activeMute, useNexa } from "./nexa";

const state = (over: Partial<NexaState> = {}): NexaState => ({ account_id: "1", mute: null, ban: null, pending: [], unread: 0, latest: 0, people: {}, ...over });

const kase = (id: string, over: Partial<MemberCase> = {}): MemberCase => ({
  id,
  number: Number(id),
  action: "mute",
  reason: "spam",
  details: { duration_ms: SPAN.HOUR },
  moderator_id: "9",
  created_at: 1000 * Number(id),
  expires_at: Date.now() + SPAN.HOUR,
  lifted_at: null,
  lifted_by: null,
  lift_reason: "",
  status: "open",
  in_effect: true,
  ended: false,
  unread: 0,
  acknowledged: false,
  last_activity_at: 1000 * Number(id),
  ...over,
});

const line = (id: string, kind: CaseMessage["kind"] = "staff"): CaseMessage => ({ id, case_id: "5", author_id: "9", kind, event: "", body: `line ${id}`, created_at: Number(id) });

let calls: string[] = [];
beforeEach(() => {
  calls = [];
  api.request = <T>(method: string, path: string): Promise<T> => {
    calls.push(`${method} ${path}`);
    return Promise.resolve({} as T);
  };
  useNexa.setState({ state: null, people: {}, feed: null, feedMore: false, feedLoading: false, threads: {}, deleted: null });
});

describe("the account's standing", () => {
  it("holds a mute or ban only until it runs out", () => {
    const now = Date.now();
    const st = state({ mute: { kind: "mute", case_id: "1", case_number: 1, reason: "r", moderator_id: "9", expires_at: now + 1000, created_at: now }, ban: { kind: "ban", case_id: "2", case_number: 2, reason: "r", moderator_id: "9", expires_at: null, created_at: now } });
    expect(activeMute(st, now)?.case_id).toBe("1");
    expect(activeMute(st, now + 1001)).toBeNull();
    // a permanent ban never runs out on its own
    expect(activeBan(st, now + 1e12)?.case_id).toBe("2");
    expect(activeMute(null)).toBeNull();
  });

  it("keeps a deletion notice past sign-out", () => {
    const c = kase("3", { action: "delete", expires_at: null, in_effect: false });
    useNexa.getState().onNotice(c, { "9": { id: "9", username: "mod", display_name: "Mod", avatar_id: null, flags: 1 } }, state({ pending: [c] }));
    useNexa.getState().reset();
    expect(useNexa.getState().state).toBeNull();
    expect(useNexa.getState().deleted?.case.id).toBe("3");
    expect(useNexa.getState().deleted?.people["9"]?.username).toBe("mod");
  });

  it("drops a dismissed notice at once and tells the server", async () => {
    const c = kase("4");
    useNexa.getState().setState(state({ pending: [c] }));
    await useNexa.getState().ack("4");
    expect(useNexa.getState().state?.pending).toEqual([]);
    expect(calls).toContain("POST /nexa/cases/4/ack");
  });
});

describe("the Nexa conversation", () => {
  it("shows a notice once, and a lift as its own item after it", () => {
    useNexa.setState({ feed: [] });
    const c = kase("5");
    useNexa.getState().onNotice(c, {}, state());
    useNexa.getState().onNotice(c, {}, state());
    expect(useNexa.getState().feed?.map((i) => i.kind)).toEqual(["notice"]);
    const lifted = { ...c, lifted_at: 9_000_000, in_effect: false };
    useNexa.getState().onCase(lifted, [], {}, state());
    const feed = useNexa.getState().feed!;
    expect(feed.map((i) => i.kind)).toEqual(["notice", "lift"]);
    // the notice itself shows the new state too
    expect(feed[0]!.kind === "notice" && feed[0]!.case.lifted_at).toBe(9_000_000);
  });

  it("puts announcements in order and takes a retracted one out", () => {
    useNexa.setState({ feed: [], state: state() });
    const a = (id: string, at: number) => ({ id, title: "", body: id, author_id: "9", created_at: at });
    useNexa.getState().onAnnouncement(a("b", 20), {});
    useNexa.getState().onAnnouncement(a("a", 10), {});
    expect(useNexa.getState().feed!.map((i) => (i.kind === "announcement" ? i.announcement.id : ""))).toEqual(["a", "b"]);
    expect(useNexa.getState().state?.unread).toBe(2);
    useNexa.getState().onAnnouncementGone("a");
    expect(useNexa.getState().feed!.length).toBe(1);
  });

  it("adds new thread lines once each, in order, to an open thread", () => {
    const c = kase("5");
    useNexa.setState({ threads: { "5": { case: c, messages: [line("10")] } } });
    useNexa.getState().onCase(c, [line("30"), line("20"), line("10")], {}, state());
    expect(useNexa.getState().threads["5"]!.messages.map((m) => m.id)).toEqual(["10", "20", "30"]);
  });

  it("marks a thread read up to its newest line", () => {
    const c = kase("5", { unread: 2 });
    useNexa.setState({ threads: { "5": { case: c, messages: [line("10"), line("11")] } } });
    useNexa.getState().markThreadRead("5");
    expect(useNexa.getState().threads["5"]!.case.unread).toBe(0);
    expect(calls).toContain("POST /nexa/cases/5/read");
  });
});

describe("how moderation reads", () => {
  it("names durations by the largest whole unit", () => {
    expect(formatSpan(SPAN.HOUR)).toBe("1 hour");
    expect(formatSpan(3 * SPAN.DAY)).toBe("3 days");
    expect(formatSpan(2 * SPAN.WEEK)).toBe("2 weeks");
    expect(formatSpan(90 * SPAN.MINUTE)).toBe("90 minutes");
    expect(formatSpan(30 * SPAN.DAY)).toBe("30 days");
  });

  it("titles each notice for the member", () => {
    expect(noticeTitle("avatar_remove", { avatar: true, banner: true })).toBe("Your profile picture and banner were removed");
    expect(noticeTitle("avatar_remove", { banner: true })).toBe("Your profile banner was removed");
    expect(noticeTitle("ban", {})).toBe("Your account was banned");
  });

  it("says where a mute or ban stands", () => {
    const now = Date.now();
    expect(caseStanding(kase("1", { lifted_at: now }))?.label).toBe("Lifted");
    expect(caseStanding(kase("1", { action: "ban", expires_at: null }))?.label).toBe("Permanent");
    expect(caseStanding(kase("1", { in_effect: false, ended: true, expires_at: now - 1 }))?.label).toBe("Ended");
    expect(caseStanding(kase("1", { action: "field_reset" }))).toBeNull();
  });

  it("explains a refusal in the reader's words", () => {
    expect(mutedSentence(null)).toBe("You can't do that while you're muted.");
    expect(mutedSentence({ expires_at: Date.now() + 2 * SPAN.HOUR })).toMatch(/^You can't do that while you're muted\. The mute ends in 2 hours\.$/);
  });
});

describe("signing out while Nexa is loading", () => {
  it("does not write a feed or a thread that arrives after the reset into the next account's store", async () => {
    let answer: (v: unknown) => void = () => undefined;
    api.request = <T>(): Promise<T> => new Promise<T>((r) => (answer = r as (v: unknown) => void));
    useNexa.getState().reset();
    const feed = useNexa.getState().loadFeed();
    useNexa.getState().reset();
    answer({ items: [{ kind: "case", case: kase("7"), at: 7 }], has_more: false, people: {} });
    await feed;
    expect(useNexa.getState().feed).toBeNull();
    const thread = useNexa.getState().loadThread("7");
    useNexa.getState().reset();
    answer({ case: kase("7"), messages: [line("1")], people: {} });
    await thread;
    expect(useNexa.getState().threads).toEqual({});
  });
});
