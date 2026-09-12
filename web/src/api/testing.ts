/**
 * Test-only helpers.
 *
 * The domain modules are thin wrappers over `api.request` / `api.upload`; these
 * swap those two out for recorders so a test can assert on the method, path and
 * body that would have gone over the wire. Not imported by production code.
 */

import type { RequestOptions, UploadOptions } from "./client";
import { api } from "./client";

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  opts: RequestOptions | undefined;
}

export interface RecordedUpload {
  path: string;
  body: Blob | ArrayBuffer | Uint8Array;
  opts: UploadOptions | undefined;
}

/** Replaces `api.request` with a recorder that always resolves to `result`. */
export function recordRequests(result: unknown = {}): RecordedRequest[] {
  const calls: RecordedRequest[] = [];
  api.request = <T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<T> => {
    calls.push({ method, path, body, opts });
    return Promise.resolve(result as T);
  };
  return calls;
}

/** Replaces `api.upload` with a recorder that always resolves to `result`. */
export function recordUploads(result: unknown = {}): RecordedUpload[] {
  const calls: RecordedUpload[] = [];
  api.upload = <T>(
    path: string,
    body: Blob | ArrayBuffer | Uint8Array,
    opts?: UploadOptions,
  ): Promise<T> => {
    calls.push({ path, body, opts });
    return Promise.resolve(result as T);
  };
  return calls;
}

/** The single recorded call, or a clear failure if there wasn't exactly one. */
export function one<T>(calls: T[]): T {
  if (calls.length !== 1) throw new Error(`expected exactly 1 call, saw ${calls.length}`);
  const c = calls[0];
  if (!c) throw new Error("expected exactly 1 call, saw none");
  return c;
}
