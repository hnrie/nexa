/**
 * The search worker: the index, its searches and its disk, off the page's
 * thread, so a search through a hundred thousand messages or the reading of
 * the index at start-up never stops the app from drawing.
 *
 * The page sends plain data and the key that seals the index on disk (a
 * CryptoKey the worker cannot export); nothing here talks to the network.
 */
import { SearchCore, type Op } from "./core";

interface WorkerScope {
  onmessage: ((e: MessageEvent<Op & { id: number }>) => void) | null;
  postMessage(msg: unknown): void;
}

const scope = self as unknown as WorkerScope;
const core = new SearchCore();

scope.onmessage = (e) => {
  const { id, ...op } = e.data;
  core.handle(op as Op).then(
    (value) => scope.postMessage({ id, ok: true, value }),
    (err: unknown) => scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
};
