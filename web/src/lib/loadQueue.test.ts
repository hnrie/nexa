import { describe, expect, it } from "vitest";
import { isAborted, LoadQueue, loadSlots, retryDelay } from "./loadQueue";

/** A job the test finishes by hand, recording when it started and whether it was aborted. */
function manual() {
  const started: string[] = [];
  const finish = new Map<string, () => void>();
  const aborted: string[] = [];
  const job = (name: string) => (signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      started.push(name);
      finish.set(name, () => resolve(name));
      signal.addEventListener("abort", () => {
        aborted.push(name);
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
  return { started, finish, aborted, job };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("LoadQueue", () => {
  it("runs no more than its slots at once, and starts the next as one finishes", async () => {
    const q = new LoadQueue(() => 2);
    const m = manual();
    const all = ["a", "b", "c", "d"].map((n) => q.add(1, m.job(n)).promise);
    expect(m.started).toEqual(["a", "b"]);
    m.finish.get("a")!();
    await tick();
    expect(m.started).toEqual(["a", "b", "c"]);
    m.finish.get("b")!();
    m.finish.get("c")!();
    await tick();
    m.finish.get("d")!();
    expect(await Promise.all(all)).toEqual(["a", "b", "c", "d"]);
    expect(q.size).toEqual({ running: 0, waiting: 0 });
  });

  it("takes the most urgent first, and the oldest among equals", async () => {
    const q = new LoadQueue(() => 1);
    const m = manual();
    q.add(1, m.job("first"));
    q.add(2, m.job("later"));
    q.add(1, m.job("near"));
    q.add(0, m.job("visible"));
    for (const n of ["first", "visible", "near", "later"]) {
      expect(m.started.at(-1)).toBe(n);
      m.finish.get(n)!();
      await tick();
    }
  });

  it("moves waiting work up when it becomes urgent", async () => {
    const q = new LoadQueue(() => 1);
    const m = manual();
    q.add(0, m.job("busy"));
    q.add(1, m.job("a"));
    const b = q.add(2, m.job("b"));
    b.setPriority(0);
    m.finish.get("busy")!();
    await tick();
    expect(m.started).toEqual(["busy", "b"]);
  });

  it("drops cancelled work before it starts, and aborts it once started", async () => {
    const q = new LoadQueue(() => 1);
    const m = manual();
    const running = q.add(0, m.job("running"));
    const waiting = q.add(0, m.job("waiting"));
    const after = q.add(0, m.job("after"));
    expect(waiting.waiting).toBe(true);
    waiting.cancel();
    await expect(waiting.promise).rejects.toSatisfy(isAborted);
    running.cancel();
    await expect(running.promise).rejects.toSatisfy(isAborted);
    expect(m.aborted).toEqual(["running"]);
    await tick();
    // the slot the aborted job held goes to the next in line, never to the dropped one
    expect(m.started).toEqual(["running", "after"]);
    m.finish.get("after")!();
    expect(await after.promise).toBe("after");
  });

  it("keeps going after a job throws", async () => {
    const q = new LoadQueue(() => 1);
    const bad = q.add(0, () => {
      throw new Error("no");
    });
    const good = q.add(0, async () => "yes");
    await expect(bad.promise).rejects.toThrow("no");
    expect(await good.promise).toBe("yes");
  });

  it("asks how many slots it has each time, so a change takes effect", async () => {
    let slots = 1;
    const q = new LoadQueue(() => slots);
    const m = manual();
    q.add(0, m.job("a"));
    q.add(0, m.job("b"));
    q.add(0, m.job("c"));
    expect(m.started).toEqual(["a"]);
    slots = 3;
    m.finish.get("a")!();
    await tick();
    expect(m.started).toEqual(["a", "b", "c"]);
  });
});

describe("loadSlots", () => {
  it("gives weak phones and slow connections fewer downloads at once", () => {
    expect(loadSlots({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe(6);
    expect(loadSlots({ hardwareConcurrency: 4, deviceMemory: 2 })).toBe(4);
    expect(loadSlots({ hardwareConcurrency: 2, deviceMemory: 1 })).toBe(2);
    expect(loadSlots({ hardwareConcurrency: 8, deviceMemory: 8, connection: { effectiveType: "3g" } })).toBe(3);
    expect(loadSlots({ hardwareConcurrency: 8, deviceMemory: 8, connection: { saveData: true } })).toBe(2);
    expect(loadSlots({ hardwareConcurrency: 8, deviceMemory: 8, connection: { effectiveType: "2g" } })).toBe(2);
    // a browser that says nothing is treated as an ordinary phone
    expect(loadSlots({})).toBe(4);
  });
});

describe("retryDelay", () => {
  it("doubles from a second up to half a minute, spread a little", () => {
    const mid = () => 0.5;
    expect([0, 1, 2, 3, 4, 5, 6, 9].map((n) => retryDelay(n, mid))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(retryDelay(0, () => 0)).toBe(800);
    expect(retryDelay(0, () => 1)).toBe(1200);
  });
});
