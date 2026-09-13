// @vitest-environment jsdom
import { installAudioUnlock } from "./sounds";

class FakeContext {
  static made: FakeContext[] = [];
  state = "suspended";
  onstatechange: (() => void) | null = null;
  started = 0;
  destination = {};
  constructor() {
    FakeContext.made.push(this);
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  createBuffer() {
    return {};
  }
  createBufferSource() {
    return { buffer: null, connect: () => undefined, start: () => void this.started++ };
  }
  setState(s: string) {
    this.state = s;
    this.onstatechange?.();
  }
}

describe("installAudioUnlock", () => {
  it("starts audio from a tap, and again after the system suspends it", () => {
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeContext;
    installAudioUnlock();
    // nothing is made until someone touches the page
    expect(FakeContext.made).toHaveLength(0);
    window.dispatchEvent(new Event("touchend"));
    expect(FakeContext.made).toHaveLength(1);
    const ac = FakeContext.made[0]!;
    expect(ac.started).toBe(1);

    // once running, taps are left alone
    ac.setState("running");
    window.dispatchEvent(new Event("pointerdown"));
    expect(ac.started).toBe(1);

    // a phone call interrupts it: the next key press wakes the same context
    ac.setState("interrupted");
    window.dispatchEvent(new Event("keydown"));
    expect(ac.started).toBe(2);
    expect(FakeContext.made).toHaveLength(1);
    ac.setState("running");
    window.dispatchEvent(new Event("keydown"));
    expect(ac.started).toBe(2);
  });
});
