import { api } from "./client";
import type { UnfurlResult } from "./types";

export const unfurl = {
  async fetch(url: string, signal?: AbortSignal): Promise<UnfurlResult | null> {
    const opts: { query: { url: string }; signal?: AbortSignal } = { query: { url } };
    if (signal) opts.signal = signal;
    const res = await api.request<UnfurlResult | undefined>("GET", "/unfurl", undefined, opts);
    return res && typeof res.url === "string" ? res : null;
  },
};
