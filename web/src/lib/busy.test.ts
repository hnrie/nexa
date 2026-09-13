import { holdReload, reloadAllowed } from "./busy";

describe("reload holds", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function watch(): { done: () => boolean } {
    let done = false;
    void reloadAllowed().then(() => {
      done = true;
    });
    return { done: () => done };
  }

  it("lets a reload go ahead after a quiet moment when nothing is held", async () => {
    const w = watch();
    await vi.advanceTimersByTimeAsync(999);
    expect(w.done()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.done()).toBe(true);
  });

  it("waits for every hold to be released", async () => {
    const upload = holdReload();
    const call = holdReload();
    const w = watch();
    await vi.advanceTimersByTimeAsync(60_000);
    upload();
    upload();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(w.done()).toBe(false);
    call();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(w.done()).toBe(true);
  });

  it("keeps waiting when the next step starts right after one ends", async () => {
    const upload = holdReload();
    const w = watch();
    upload();
    await vi.advanceTimersByTimeAsync(10);
    const send = holdReload();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(w.done()).toBe(false);
    send();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(w.done()).toBe(true);
  });
});
