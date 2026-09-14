// @vitest-environment jsdom
import { FakeAudioContext, useFakeAudio } from "@/test/fakeAudio";
import { AudioKeeper } from "./audioKeeper";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function keeper(): { k: AudioKeeper; ac: FakeAudioContext } {
  const ac = new FakeAudioContext();
  return { k: new AudioKeeper(ac as unknown as AudioContext), ac };
}

describe("AudioKeeper", () => {
  afterEach(() => vi.useRealTimers());

  it("resumes a context the system interrupted, not only a suspended one", async () => {
    useFakeAudio();
    const { k, ac } = keeper();
    ac.setState("interrupted");
    expect(await k.want()).toBe(true);
    expect(ac.resumes).toBe(1);
    expect(ac.state).toBe("running");
  });

  it("says what the browser said when the device will not start", async () => {
    useFakeAudio();
    const { k, ac } = keeper();
    ac.onResume = "refuse";
    expect(await k.want()).toBe(false);
    expect(k.refused).toBe(true);
    expect(k.problem).toBe("InvalidStateError: Failed to start the audio device");
  });

  it("gives up waiting for a context the browser keeps for a tap, and still runs it once tapped", async () => {
    vi.useFakeTimers();
    useFakeAudio();
    const { k, ac } = keeper();
    ac.onResume = "wait";
    const late = k.started(1500);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await late).toBe(false);
    const again = k.started(1500);
    ac.setState("running");
    expect(await again).toBe(true);
  });

  it("starts again when wanted while a stop is still under way", async () => {
    useFakeAudio();
    const { k, ac } = keeper();
    await k.want();
    ac.resumes = 0;
    ac.slowSuspend = true;
    k.release();
    expect(ac.suspends).toBe(1);
    // asked for now, the resume must wait for the stop, or the stop could land after it
    const wanted = k.want();
    expect(ac.resumes).toBe(0);
    ac.finishSuspend();
    expect(await wanted).toBe(true);
    expect(ac.state).toBe("running");
    expect(k.released).toBe(false);
  });

  it("stops a released context again when something else starts it", async () => {
    useFakeAudio();
    const { k, ac } = keeper();
    await k.want();
    k.release();
    await flush();
    expect(ac.state).toBe("suspended");
    // the system bringing it back after an interruption, or a tap
    ac.setState("running");
    expect(ac.suspends).toBe(2);
    expect(ac.state).toBe("suspended");
    expect(await k.started(100)).toBe(true);
    expect(ac.state).toBe("running");
  });

  it("releases when idle only in a home-screen app, and only if still idle then", async () => {
    vi.useFakeTimers();
    useFakeAudio(false);
    const { k, ac } = keeper();
    await k.want();
    k.releaseLater(() => true, 2000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(ac.suspends).toBe(0);

    useFakeAudio(true);
    let idle = false;
    k.releaseLater(() => idle, 2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(ac.suspends).toBe(0);
    idle = true;
    k.releaseLater(() => idle, 2000);
    // wanting it again calls off a release on the way
    await vi.advanceTimersByTimeAsync(1000);
    await k.want();
    await vi.advanceTimersByTimeAsync(5000);
    expect(ac.suspends).toBe(0);
    k.releaseLater(() => idle, 2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(ac.suspends).toBe(1);
    expect(k.released).toBe(true);
  });
});
