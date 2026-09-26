import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { InvitePreview } from "@/api/types";
import { loadInvitePreview, useInvitePreviews } from "./invitePreviews";

const preview = (online: number): InvitePreview => ({
  code: "abc",
  server: { id: "1", name: "Lab", icon_id: null, banner_id: "9", description: "", member_count: 10, online_count: online },
  expires_at: null,
});

const entry = (code = "abc") => useInvitePreviews.getState().byCode[code];

describe("invite previews", () => {
  beforeEach(() => useInvitePreviews.setState({ byCode: {} }));

  it("asks once, then answers from what it knows while that is fresh", async () => {
    let clock = 1_000;
    const fetch = vi.fn(async () => preview(3));
    const first = loadInvitePreview("abc", { fetch, now: () => clock });
    // two cards for the same invite share one request
    const second = loadInvitePreview("abc", { fetch, now: () => clock });
    expect(entry()).toEqual({ status: "loading" });
    await Promise.all([first, second]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(entry()).toMatchObject({ status: "ready", preview: { server: { online_count: 3 } } });
    clock += 60_000;
    await loadInvitePreview("abc", { fetch, now: () => clock });
    expect(fetch).toHaveBeenCalledTimes(1);
    // five minutes on, the counts are asked for again, and the old ones stay up meanwhile
    clock += 5 * 60_000;
    fetch.mockImplementation(async () => preview(7));
    const again = loadInvitePreview("abc", { fetch, now: () => clock });
    expect(entry()?.status).toBe("ready");
    await again;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(entry()).toMatchObject({ status: "ready", preview: { server: { online_count: 7 } } });
  });

  it("remembers an invite the server does not know as invalid", async () => {
    await loadInvitePreview("gone", { fetch: async () => Promise.reject(new ApiError(404, "invite_invalid", "This invite is invalid or has expired.")) });
    expect(entry("gone")?.status).toBe("invalid");
  });

  it("tries a failed request again after a while, or at once when asked", async () => {
    let clock = 0;
    const fetch = vi.fn(async (): Promise<InvitePreview> => Promise.reject(new ApiError(0, "network", "offline")));
    await loadInvitePreview("x", { fetch, now: () => clock });
    expect(entry("x")?.status).toBe("failed");
    clock += 5_000;
    await loadInvitePreview("x", { fetch, now: () => clock });
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockImplementation(async () => preview(1));
    await loadInvitePreview("x", { fetch, now: () => clock, force: true });
    expect(entry("x")?.status).toBe("ready");
    // a later failure keeps the answer it had
    clock += 10 * 60_000;
    fetch.mockImplementation(async () => Promise.reject(new ApiError(503, "busy", "busy")));
    await loadInvitePreview("x", { fetch, now: () => clock });
    expect(entry("x")?.status).toBe("ready");
  });
});
