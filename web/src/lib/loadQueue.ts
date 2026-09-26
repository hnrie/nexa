/**
 * A few loads at a time, the ones people are looking at first.
 *
 * A grid of stickers used to start every picture near the screen at once. On
 * a slow link they all crawled in together, so the ones in view finished no
 * sooner than the ones a screen away, and loads for tiles that were already
 * gone (a closed picker, a pack scrolled past) kept the line busy. Here work
 * waits its turn: the lowest priority number goes first (what is on screen,
 * then what is about to be), a device runs as many at once as it can handle,
 * and work nobody wants any more is dropped before it starts, or stopped if
 * it has.
 */

/** What a cancelled piece of work rejects with. */
export class AbortedError extends Error {
  override name = "AbortError";
  constructor() {
    super("aborted");
  }
}

export function isAborted(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

export interface Ticket<T> {
  readonly promise: Promise<T>;
  /** Moves the work up or down the line while it waits (lower goes sooner). */
  setPriority(priority: number): void;
  /** Drops the work if it has not started, or aborts it if it has. */
  cancel(): void;
  /** Whether it is still waiting for a turn. */
  readonly waiting: boolean;
}

interface Job {
  priority: number;
  seq: number;
  run: (signal: AbortSignal) => Promise<unknown>;
  ctrl: AbortController;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  state: "waiting" | "running" | "done";
}

export class LoadQueue {
  private waiting: Job[] = [];
  private running = 0;
  private seq = 0;

  /** slots is asked each time a turn comes up, so it can follow the connection. */
  constructor(private readonly slots: () => number) {}

  add<T>(priority: number, run: (signal: AbortSignal) => Promise<T>): Ticket<T> {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res as (v: unknown) => void;
      reject = rej;
    });
    const job: Job = { priority, seq: this.seq++, run, ctrl: new AbortController(), resolve, reject, state: "waiting" };
    this.waiting.push(job);
    // a caller that drops the promise must not see an unhandled rejection
    promise.catch(() => undefined);
    this.pump();
    return {
      promise,
      setPriority: (p: number) => {
        if (job.state === "waiting") job.priority = p;
      },
      cancel: () => {
        if (job.state === "waiting") {
          this.waiting.splice(this.waiting.indexOf(job), 1);
          job.state = "done";
          job.reject(new AbortedError());
          this.settleQuiet();
        } else if (job.state === "running") {
          job.ctrl.abort();
        }
      },
      get waiting() {
        return job.state === "waiting";
      },
    };
  }

  /** How much is running and waiting. */
  get size(): { running: number; waiting: number } {
    return { running: this.running, waiting: this.waiting.length };
  }

  private quiet: (() => void)[] = [];

  /** Resolves once nothing is running or waiting, for work that should only use a free line. */
  whenIdle(): Promise<void> {
    if (this.running === 0 && this.waiting.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.quiet.push(resolve));
  }

  private settleQuiet(): void {
    if (this.running > 0 || this.waiting.length > 0) return;
    const waiting = this.quiet;
    this.quiet = [];
    for (const resolve of waiting) resolve();
  }

  private pump(): void {
    while (this.waiting.length > 0 && this.running < Math.max(1, this.slots())) {
      // the most urgent first, and among equals the oldest
      let best = 0;
      for (let i = 1; i < this.waiting.length; i++) {
        const a = this.waiting[i]!;
        const b = this.waiting[best]!;
        if (a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i;
      }
      const job = this.waiting.splice(best, 1)[0]!;
      job.state = "running";
      this.running++;
      let done: Promise<unknown>;
      try {
        done = Promise.resolve(job.run(job.ctrl.signal));
      } catch (e) {
        done = Promise.reject(e);
      }
      void done.then(job.resolve, job.reject).finally(() => {
        job.state = "done";
        this.running--;
        this.pump();
        this.settleQuiet();
      });
    }
  }
}

interface DeviceHints {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
}

/**
 * How many downloads a device runs at once. A phone with few cores or little
 * memory, or a connection that says it is slow or saving data, gets fewer, so
 * the tiles in view finish first instead of everything arriving late together.
 */
export function loadSlots(nav: DeviceHints | undefined = typeof navigator !== "undefined" ? (navigator as DeviceHints) : undefined): number {
  const cores = nav?.hardwareConcurrency || 4;
  const memory = nav?.deviceMemory ?? 4;
  let slots = cores >= 8 && memory >= 4 ? 6 : cores >= 4 && memory >= 2 ? 4 : 2;
  const conn = nav?.connection;
  if (conn?.saveData || conn?.effectiveType === "slow-2g" || conn?.effectiveType === "2g") slots = Math.min(slots, 2);
  else if (conn?.effectiveType === "3g") slots = Math.min(slots, 3);
  return slots;
}

/**
 * How long to wait before trying a failed load again: a second, then twice as
 * long each time up to half a minute, spread a little so a grid of failures
 * does not come back all in the same instant.
 */
export function retryDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.8 + 0.4 * random()));
}
