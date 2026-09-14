/**
 * An AudioContext for jsdom tests, with the parts of starting and stopping
 * that differ between browsers under the test's control.
 */

type State = "suspended" | "running" | "interrupted" | "closed";

export class FakeAudioContext extends EventTarget {
  static made: FakeAudioContext[] = [];
  /** How resume() goes for contexts made from now on. */
  static startsAs: "run" | "wait" | "refuse" = "run";
  state: State = "suspended";
  destination = {};
  currentTime = 0;
  sampleRate = 48000;
  /** How resume() goes: "run" starts it, "wait" pends as without a tap (until something else starts it), "refuse" rejects. */
  onResume: "run" | "wait" | "refuse" = FakeAudioContext.startsAs;
  /** suspend() settles only when finishSuspend() is called, as a real one does some time later. */
  slowSuspend = false;
  resumes = 0;
  suspends = 0;
  /** Buffer sources started, the silent one a tap plays included. */
  sources = 0;
  /** Buffer sources started looping. */
  loops = 0;
  /** Oscillators started. */
  tones = 0;
  decoded = 0;
  stopped = 0;
  private waiting: (() => void)[] = [];
  private suspending: (() => void)[] = [];

  constructor() {
    super();
    FakeAudioContext.made.push(this);
  }

  static reset(): void {
    FakeAudioContext.made = [];
    FakeAudioContext.startsAs = "run";
  }

  resume(): Promise<void> {
    this.resumes++;
    if (this.state === "closed") return Promise.reject(new DOMException("Cannot resume a closed AudioContext.", "InvalidStateError"));
    if (this.state === "running") return Promise.resolve();
    if (this.onResume === "refuse") return Promise.reject(new DOMException("Failed to start the audio device", "InvalidStateError"));
    if (this.onResume === "wait") return new Promise((resolve) => this.waiting.push(resolve));
    this.setState("running");
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspends++;
    if (!this.slowSuspend) {
      this.setState("suspended");
      return Promise.resolve();
    }
    return new Promise((resolve) => this.suspending.push(resolve));
  }

  finishSuspend(): void {
    this.setState("suspended");
    for (const resolve of this.suspending.splice(0)) resolve();
  }

  close(): Promise<void> {
    this.setState("closed");
    return Promise.resolve();
  }

  /** What the system (or a tap elsewhere) does to the context. */
  setState(s: State): void {
    if (this.state === s) return;
    this.state = s;
    if (s === "running") for (const resolve of this.waiting.splice(0)) resolve();
    this.dispatchEvent(new Event("statechange"));
  }

  createBuffer() {
    return { duration: 0 };
  }

  createBufferSource() {
    const src = {
      buffer: null as { duration: number } | null,
      loop: false,
      connect: (n: unknown) => n,
      start: () => {
        this.sources++;
        if (src.loop) this.loops++;
      },
      stop: () => void this.stopped++,
    };
    return src;
  }

  createGain() {
    return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n: unknown) => n };
  }

  createOscillator() {
    return { type: "sine", frequency: { setValueAtTime() {} }, connect: (n: unknown) => n, start: () => void this.tones++, stop() {} };
  }

  decodeAudioData(): Promise<{ duration: number }> {
    this.decoded++;
    return Promise.resolve({ duration: 1 });
  }
}

/** Installs the fake as window.AudioContext; `homeScreen` makes the page an iPhone home-screen app. */
export function useFakeAudio(homeScreen = false): void {
  FakeAudioContext.reset();
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  Object.defineProperty(navigator, "standalone", { value: homeScreen ? true : undefined, configurable: true });
}

export function setVisibility(v: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

/**
 * Records the listeners a test's modules add to window and document, and
 * takes them off again, so a module loaded fresh for the next test is not
 * answered by the last one's.
 */
export function trackListeners(): () => void {
  const added: [EventTarget, string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined][] = [];
  const spies = [window, document].map((target) => {
    const add = target.addEventListener.bind(target);
    return vi.spyOn(target, "addEventListener").mockImplementation((type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | AddEventListenerOptions) => {
      if (!fn) return;
      added.push([target, type, fn, opts]);
      add(type, fn, opts);
    });
  });
  return () => {
    for (const [target, type, fn, opts] of added.splice(0)) target.removeEventListener(type, fn, opts);
    for (const spy of spies) spy.mockRestore();
  };
}
