/**
 * Audio in iPhone and iPad home-screen apps. Since iOS 26, closing a
 * home-screen app while its audio is running can leave sound broken in every
 * home-screen app until the phone restarts (Safari itself keeps working), and
 * an AudioContext keeps audio running even while it plays nothing. So there a
 * context is stopped whenever nothing needs it and started again for the next
 * sound. Everywhere else a context stays up once started, as it always has.
 */

/** Whether this page runs as an iPhone or iPad home-screen app. */
export function isHomeScreenApp(): boolean {
  return typeof navigator !== "undefined" && (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Starts and stops one AudioContext as it is needed. */
export class AudioKeeper {
  private stopped = false;
  private stopping: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The device refused to start the last time it was asked. */
  refused = false;
  /** What the browser said when it refused. */
  problem: string | null = null;

  constructor(readonly ac: AudioContext) {
    // started again while released (by a tap, or by the system after an interruption): stopped again
    ac.addEventListener("statechange", () => {
      if (ac.state === "running" && this.stopped) void this.stop();
    });
  }

  /** Released, and not wanted since. */
  get released(): boolean {
    return this.stopped;
  }

  /**
   * Wants the context running: resumes it when it is suspended, released or
   * interrupted (iOS does not always bring a context back by itself after the
   * app has been in the background). Resolves with whether it runs; while the
   * browser waits for a tap to allow it, it does not resolve at all.
   */
  want(): Promise<boolean> {
    this.stopped = false;
    this.cancel();
    if (this.ac.state === "closed") return Promise.resolve(false);
    // a resume asked for during a stop waits for it, so the stop cannot land after it and win
    if (this.stopping) return this.stopping.then(() => (this.stopped ? false : this.resume()));
    return this.ac.state === "running" ? Promise.resolve(true) : this.resume();
  }

  /** want(), giving up after `within` ms. */
  started(within: number): Promise<boolean> {
    const wanted = this.want();
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), within);
      void wanted.then((ok) => {
        clearTimeout(timer);
        resolve(ok && !this.stopped && this.ac.state === "running");
      });
    });
  }

  /** Stops the context until something wants it again. */
  release(): void {
    this.cancel();
    if (this.ac.state === "closed") return;
    this.stopped = true;
    // one still starting is stopped by the statechange listener once it runs
    if (this.ac.state !== "suspended") void this.stop();
  }

  /** In a home-screen app, releases the context after `after` ms if `idle()` still says nothing needs it then. */
  releaseLater(idle: () => boolean, after: number): void {
    if (!isHomeScreenApp()) return;
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (idle()) this.release();
    }, after);
  }

  private resume(): Promise<boolean> {
    return this.ac.resume().then(
      () => {
        this.refused = false;
        this.problem = null;
        return true;
      },
      (err: unknown) => {
        this.refused = true;
        const e = err as { name?: unknown; message?: unknown } | null;
        this.problem = e && typeof e.message === "string" ? `${String(e.name)}: ${e.message}` : String(err);
        return false;
      },
    );
  }

  private stop(): Promise<void> {
    const done = () => {
      this.stopping = null;
    };
    this.stopping ??= this.ac.suspend().then(done, done);
    return this.stopping;
  }

  private cancel(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
