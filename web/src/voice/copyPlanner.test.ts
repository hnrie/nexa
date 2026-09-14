import { describe, expect, it } from "vitest";
import { BACKOFF_MS, COOLDOWN_MS, CopyPlanner, JUDGE_MS, REPORT_TTL_MS, TRIAL_MS, UPLINK_LAG_MS } from "./copyPlanner";

/** Long enough after a change for a two-second report to cover only what came after it. */
const SETTLE_MS = 4_000;

/** A planner with a clock, and the depths it asked for. */
function planner() {
  const changes: number[] = [];
  const p = new CopyPlanner((d) => changes.push(d));
  let now = 1_000_000;
  return {
    p,
    changes,
    at: () => now,
    wait(ms: number) {
      now += ms;
      p.update(now);
    },
    report(loss: number, conceal: number, delay = 80, from = "bob") {
      p.report(from, { loss, conceal, delay }, now);
    },
  };
}

describe("copies of voice frames", () => {
  it("go out as listeners lose packets, one or two by how many", () => {
    const t = planner();
    t.p.update(t.at());
    expect(t.p.depth).toBe(0);
    t.report(0.01, 0.01);
    expect(t.p.depth).toBe(0);
    t.report(0.03, 0.03);
    expect(t.p.depth).toBe(1);
    t.report(0.12, 0.1, 80, "carol");
    expect(t.p.depth).toBe(2);
    expect(t.changes).toEqual([1, 2]);
  });

  it("stay once they helped, through a quieter stretch, and stop when no one reports losses any more", () => {
    const t = planner();
    t.report(0.1, 0.09);
    expect(t.p.depth).toBe(2);
    t.wait(SETTLE_MS);
    // the listener still loses packets, but hears nearly all of it now
    t.report(0.1, 0.01, 120);
    t.wait(TRIAL_MS - SETTLE_MS);
    expect(t.p.depth).toBe(2);
    // one report of fewer losses does not take a copy away while a lossier one is recent
    t.report(0.03, 0.01, 120);
    expect(t.p.depth).toBe(2);
    t.wait(REPORT_TTL_MS - 1_000);
    expect(t.p.depth).toBe(1);
    t.wait(1_001);
    expect(t.p.depth).toBe(0);
  });

  it("stop at once when a listener conceals far more with them, and wait before trying again", () => {
    const t = planner();
    t.report(0.1, 0.05);
    expect(t.p.depth).toBe(2);
    t.wait(SETTLE_MS);
    // the link was full: copies made it lose far more
    t.report(0.5, 0.3);
    expect(t.p.depth).toBe(0);
    // still losing, but nothing goes out while the link drains
    t.wait(COOLDOWN_MS / 2);
    t.report(0.1, 0.05);
    expect(t.p.depth).toBe(0);
    // then one copy may be tried, measured against how things are without
    t.wait(COOLDOWN_MS / 2 + SETTLE_MS);
    t.report(0.1, 0.05);
    expect(t.p.depth).toBe(1);
    expect(t.changes).toEqual([2, 0, 1]);
  });

  it("stop at once when audio waits far longer with them, and after the trial when it waits clearly longer", () => {
    const far = planner();
    far.report(0.04, 0.02, 90);
    expect(far.p.depth).toBe(1);
    far.wait(SETTLE_MS);
    // packets queueing on a full link
    far.report(0.3, 0.01, 90 + 400);
    expect(far.p.depth).toBe(0);

    const clear = planner();
    clear.report(0.06, 0.02, 90);
    clear.wait(SETTLE_MS);
    clear.report(0.1, 0.01, 90 + 200);
    expect(clear.p.depth).toBe(2);
    clear.wait(SETTLE_MS);
    clear.report(0.1, 0.01, 90 + 220);
    clear.wait(TRIAL_MS - 2 * SETTLE_MS);
    expect(clear.p.depth).toBe(0);
  });

  it("stop at once when a listener's link queues up and drops what does not fit, however much the copies cover", () => {
    const t = planner();
    t.report(0.05, 0.03, 90);
    expect(t.p.depth).toBe(2);
    t.wait(SETTLE_MS);
    t.report(0.37, 0.01, 90 + 320);
    expect(t.p.depth).toBe(0);
  });

  it("keep going while the losses that called for them are still growing", () => {
    const t = planner();
    // the first report caught the start of a lossy stretch
    t.report(0.107, 0.099, 66);
    expect(t.p.depth).toBe(2);
    t.wait(SETTLE_MS);
    t.report(0.29, 0.055, 110);
    t.wait(SETTLE_MS);
    t.report(0.31, 0.06, 115);
    t.wait(TRIAL_MS - 2 * SETTLE_MS);
    expect(t.p.depth).toBe(2);
  });

  it("keep going when audio waits longer on a path that changed but loses no more", () => {
    const t = planner();
    t.p.roundTrip(40);
    t.report(0.08, 0.12, 100);
    expect(t.p.depth).toBe(2);
    // onto mobile data: a longer round trip and a bigger jitter buffer, but the same losses, most of them covered now
    for (let i = 0; i < 3; i++) t.p.roundTrip(200);
    t.wait(SETTLE_MS);
    t.report(0.09, 0.01, 350);
    t.wait(SETTLE_MS);
    t.report(0.08, 0.02, 420);
    t.wait(TRIAL_MS - 2 * SETTLE_MS);
    expect(t.p.depth).toBe(2);
  });

  it("are not stopped by one noisy report on a jittery link", () => {
    const t = planner();
    t.report(0.08, 0.06, 250);
    expect(t.p.depth).toBe(2);
    t.wait(SETTLE_MS);
    // a stretch of jitter: the buffer grew and a little more was concealed, once
    t.report(0.08, 0.1, 250 + 180);
    expect(t.p.depth).toBe(2);
    t.wait(SETTLE_MS);
    t.report(0.08, 0.02, 260);
    t.wait(TRIAL_MS - 2 * SETTLE_MS);
    expect(t.p.depth).toBe(2);
  });

  it("that passed stop when this device's uplink starts losing far more and its round trip grows", () => {
    const t = planner();
    t.p.roundTrip(40);
    t.p.uplink(0.04, t.at());
    t.report(0.06, 0.05, 100);
    for (let i = 0; i < 8; i++) {
      t.wait(2_000);
      t.p.uplink(0.05, t.at());
      if (i % 2 === 1) t.report(0.06, 0.01, 110);
    }
    expect(t.p.depth).toBe(2);
    // the uplink loses more by itself: a worse spot for the radio, not a full link
    t.wait(2_000);
    t.p.uplink(0.3, t.at());
    t.wait(2_000);
    t.p.uplink(0.32, t.at());
    t.wait(10);
    expect(t.p.depth).toBe(2);
    // an upload fills it: more lost, and every reply slower
    for (let i = 0; i < 3; i++) t.p.roundTrip(300);
    t.wait(2_000);
    t.p.uplink(0.35, t.at());
    t.wait(10);
    expect(t.p.depth).toBe(0);
  });

  it("do not count one slow round trip", () => {
    const t = planner();
    t.p.roundTrip(40);
    t.report(0.04, 0.03);
    t.p.roundTrip(400);
    t.p.roundTrip(45);
    t.wait(TRIAL_MS);
    expect(t.p.depth).toBe(1);
  });

  it("are tried again later and later when they keep making things worse, and afresh after a long while", () => {
    const t = planner();
    const fail = () => {
      t.report(0.04, 0.02);
      expect(t.p.depth).toBe(1);
      t.wait(SETTLE_MS);
      t.report(0.4, 0.2);
      expect(t.p.depth).toBe(0);
    };
    fail();
    t.wait(BACKOFF_MS - SETTLE_MS - 1);
    t.report(0.04, 0.02);
    expect(t.p.depth).toBe(0);
    t.wait(SETTLE_MS + 1);
    fail();
    // failing again soon waits twice as long
    t.wait(BACKOFF_MS + SETTLE_MS);
    t.report(0.04, 0.02);
    expect(t.p.depth).toBe(0);
    t.wait(BACKOFF_MS);
    fail();
    // trouble much later is new trouble: the wait starts over
    t.wait(30 * 60_000);
    fail();
    t.wait(BACKOFF_MS + SETTLE_MS);
    t.report(0.04, 0.02);
    expect(t.p.depth).toBe(1);
  });

  it("that passed stop when the link starts queueing later", () => {
    const t = planner();
    t.p.roundTrip(40);
    t.report(0.06, 0.05, 100);
    t.wait(SETTLE_MS);
    t.report(0.06, 0.01, 130);
    t.wait(TRIAL_MS);
    t.report(0.06, 0.01, 130);
    expect(t.p.depth).toBe(2);
    // one slow report is not queueing
    t.wait(4_000);
    t.report(0.06, 0.01, 130 + 200);
    expect(t.p.depth).toBe(2);
    // an upload starts on the speaker's side, say: packets queue and some are dropped
    t.wait(4_000);
    t.report(0.2, 0.02, 130 + 250);
    expect(t.p.depth).toBe(2);
    t.wait(4_000);
    t.report(0.22, 0.02, 130 + 260);
    expect(t.p.depth).toBe(0);
  });

  it("go up during a trial when losses grow, still measured against before", () => {
    const t = planner();
    t.report(0.03, 0.03);
    expect(t.p.depth).toBe(1);
    t.wait(2_000);
    t.report(0.1, 0.02);
    expect(t.p.depth).toBe(2);
    // against the report from before any copies (3% concealed) this is not worse;
    // against the one taken with one copy (2%) it would be
    t.wait(SETTLE_MS);
    t.report(0.1, 0.055);
    t.wait(SETTLE_MS);
    t.report(0.1, 0.055);
    t.wait(TRIAL_MS - 2 * SETTLE_MS);
    expect(t.p.depth).toBe(2);
  });

  it("pass their trial only on reports, and are judged when reports come", () => {
    const t = planner();
    // a blip of losses turns copies on, then nobody reports anything for a while
    t.report(0.06, 0.04, 90);
    expect(t.p.depth).toBe(2);
    t.wait(TRIAL_MS + 5_000);
    expect(t.p.depth).toBe(2);
    // the link fills up: with copies on, far more is concealed than before them
    t.report(0.5, 0.2, 400);
    expect(t.p.depth).toBe(0);
  });

  it("are judged against reports taken after the last change settled", () => {
    const t = planner();
    t.report(0.1, 0.05);
    t.wait(SETTLE_MS);
    t.report(0.6, 0.4, 500);
    expect(t.p.depth).toBe(0);
    t.wait(COOLDOWN_MS);
    // the last report is from while two copies filled the link: nothing is tried on the strength of it
    expect(t.p.depth).toBe(0);
    // a report without copies comes: one copy is tried, and judged against that report, not the one before
    t.report(0.1, 0.05, 100);
    expect(t.p.depth).toBe(1);
    t.wait(SETTLE_MS);
    t.report(0.3, 0.25, 400);
    expect(t.p.depth).toBe(0);
  });

  it("stop when this device's own uplink loses far more once they go out", () => {
    const t = planner();
    t.p.uplink(0.26, t.at() - 2_000);
    t.p.uplink(0.28, t.at());
    t.report(0.27, 0.02, 280);
    expect(t.p.depth).toBe(2);
    // a link too narrow for the voice alone: listeners hear no worse yet, but the SFU loses far more of it
    t.wait(UPLINK_LAG_MS);
    t.p.uplink(0.6, t.at());
    t.wait(2_000);
    t.p.uplink(0.66, t.at());
    t.wait(10);
    expect(t.p.depth).toBe(0);
  });

  it("keep going when the uplink loses as much with them as before", () => {
    const t = planner();
    t.p.uplink(0.29, t.at() - 2_000);
    t.p.uplink(0.31, t.at());
    t.report(0.3, 0.1, 80);
    expect(t.p.depth).toBe(2);
    for (let i = 0; i < 6; i++) {
      t.wait(2_000);
      t.p.uplink(0.25 + 0.02 * i, t.at());
      if (i % 2 === 1) t.report(0.3, 0.03, 100);
    }
    expect(t.p.depth).toBe(2);
  });

  it("count only reports that began once the copies were going out", () => {
    const t = planner();
    t.report(0.1, 0.05, 90);
    expect(t.p.depth).toBe(2);
    // this report's stretch began before the copies: what it concealed says nothing about them
    t.wait(4_000);
    t.p.report("bob", { loss: 0.1, conceal: 0.3, delay: 90, span: 6_000 }, t.at());
    expect(t.p.depth).toBe(2);
    // this one began after them
    t.wait(4_000);
    t.p.report("bob", { loss: 0.1, conceal: 0.3, delay: 90, span: 4_000 }, t.at());
    expect(t.p.depth).toBe(0);
  });
});
