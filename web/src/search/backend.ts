/**
 * The page's end of the search index: operations sent to the search worker,
 * answered as promises. Where a worker cannot be started the same code runs
 * in the page (search/core.ts), which is slower on a very large index but
 * otherwise the same.
 */
import { SearchCore, type Op } from "./core";

export interface Backend {
  call<T>(op: Op): Promise<T>;
  /** Stops it at once: a worker is ended, freeing everything it held. */
  terminate(): void;
  readonly inWorker: boolean;
}

class WorkerBackend implements Backend {
  readonly inWorker = true;
  private readonly worker: Worker;
  private seq = 0;
  private readonly waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private dead: Error | null = null;

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; value?: unknown; error?: string }>) => {
      const w = this.waiting.get(e.data.id);
      if (!w) return;
      this.waiting.delete(e.data.id);
      if (e.data.ok) w.resolve(e.data.value);
      else w.reject(new Error(e.data.error ?? "search worker failed"));
    };
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.fail(new Error(`search worker stopped: ${e.message}`));
    };
  }

  private fail(err: Error): void {
    this.dead = err;
    for (const w of this.waiting.values()) w.reject(err);
    this.waiting.clear();
  }

  call<T>(op: Op): Promise<T> {
    if (this.dead) return Promise.reject(this.dead);
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      try {
        this.worker.postMessage({ id, ...op });
      } catch (err) {
        this.waiting.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  terminate(): void {
    this.worker.terminate();
    this.fail(new Error("search index closed"));
  }
}

class PageBackend implements Backend {
  readonly inWorker = false;
  private core: SearchCore | null = new SearchCore();

  call<T>(op: Op): Promise<T> {
    if (!this.core) return Promise.reject(new Error("search index closed"));
    return this.core.handle(op) as Promise<T>;
  }

  terminate(): void {
    const core = this.core;
    this.core = null;
    void core?.handle({ op: "close" });
  }
}

export function createBackend(): Backend {
  if (typeof Worker === "undefined") return new PageBackend();
  try {
    return new WorkerBackend();
  } catch (err) {
    console.warn("search: no worker, searching in the page", err);
    return new PageBackend();
  }
}

/** For tests: the in-page backend, whatever the environment offers. */
export function pageBackend(): Backend {
  return new PageBackend();
}
