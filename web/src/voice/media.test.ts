// @vitest-environment jsdom
import { FakeAudioContext, setVisibility, trackListeners, useFakeAudio } from "@/test/fakeAudio";

type Media = typeof import("./media");

async function load(homeScreen: boolean): Promise<Media> {
  useFakeAudio(homeScreen);
  vi.resetModules();
  return import("./media");
}

const fake = (ac: AudioContext) => ac as unknown as FakeAudioContext;

describe("the call's audio context", () => {
  let untrack: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    untrack = trackListeners();
    setVisibility("visible");
  });
  afterEach(() => {
    untrack();
    vi.useRealTimers();
  });

  it("in a home-screen app, is let go when no call holds it, and taken back by the next use", async () => {
    const m = await load(true);
    const ac = fake(m.audioContext());
    expect(ac.state).toBe("running");
    const release = m.holdAudio();
    await vi.advanceTimersByTimeAsync(60_000);
    // a call carries on in the background
    setVisibility("hidden");
    expect(ac.state).toBe("running");
    setVisibility("visible");

    release();
    release();
    await vi.advanceTimersByTimeAsync(2000);
    expect(ac.state).toBe("suspended");
    expect(m.audioContext()).toBe(ac);
    expect(ac.state).toBe("running");
    // made in the tap that starts a call, and let go if no call follows
    await vi.advanceTimersByTimeAsync(9000);
    expect(ac.state).toBe("running");
    await vi.advanceTimersByTimeAsync(1000);
    expect(ac.state).toBe("suspended");
  });

  it("in a home-screen app, is let go at once in the background outside a call, or when a call ends there", async () => {
    const m = await load(true);
    const ac = fake(m.audioContext());
    setVisibility("hidden");
    expect(ac.state).toBe("suspended");

    setVisibility("visible");
    const release = m.holdAudio();
    m.audioContext();
    // after the stop under way has settled
    await vi.advanceTimersByTimeAsync(0);
    expect(ac.state).toBe("running");
    setVisibility("hidden");
    expect(ac.state).toBe("running");
    release();
    expect(ac.state).toBe("suspended");
  });

  it("elsewhere, stays up once started", async () => {
    const m = await load(false);
    const ac = fake(m.audioContext());
    m.holdAudio()();
    await vi.advanceTimersByTimeAsync(60_000);
    setVisibility("hidden");
    expect(ac.suspends).toBe(0);
    expect(ac.state).toBe("running");
  });

  it("wakes in a tap after the system interrupted it", async () => {
    const m = await load(false);
    const ac = fake(m.audioContext());
    ac.setState("interrupted");
    m.resumeAudio();
    expect(ac.state).toBe("running");
  });
});
