import { holdReload, reloadAllowed, reloadHolds } from "./busy";

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
    const upload = holdReload("upload");
    const call = holdReload("call");
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
    const upload = holdReload("upload");
    const w = watch();
    upload();
    await vi.advanceTimersByTimeAsync(10);
    const send = holdReload("send");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(w.done()).toBe(false);
    send();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(w.done()).toBe(true);
  });

  it("says what it waits for, the longest-lasting first", () => {
    expect(reloadHolds()).toEqual([]);
    const send = holdReload("send");
    const up1 = holdReload("upload");
    const up2 = holdReload("upload");
    const call = holdReload("call");
    expect(reloadHolds()).toEqual(["call", "upload", "send"]);
    call();
    up1();
    // one upload is still going
    expect(reloadHolds()).toEqual(["upload", "send"]);
    up2();
    up2();
    send();
    expect(reloadHolds()).toEqual([]);
  });
});
