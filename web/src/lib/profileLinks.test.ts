import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { PublicUser } from "@/api/types";
import { loadSharedProfile, profileLinkItem, profileUrl, useSharedProfiles } from "./profileLinks";
import { setPublicUrl } from "./appLinks";
import { useUsers } from "@/stores/users";

const user = (name: string): PublicUser => ({ id: "7", username: "maya", display_name: name, avatar_id: null, banner_id: null, about_me: "", pronouns: "", accent_color: null, accent_color_2: null, status_text: "", status_emoji: "", status_expires_at: null, public_key: null, flags: 0, group_link_only: false, created_at: 0 }) as unknown as PublicUser;

const entry = (name = "maya") => useSharedProfiles.getState().byName[name];

describe("profile links", () => {
  beforeEach(() => {
    useSharedProfiles.setState({ byName: {} });
    setPublicUrl(null);
  });

  it("are made at Nexa's public address", () => {
    setPublicUrl("https://nexa.example");
    expect(profileUrl("maya")).toBe("https://nexa.example/@maya");
  });

  it("ask once, whatever the case, then answer from what they know while it is fresh", async () => {
    let clock = 1_000;
    const fetch = vi.fn(async () => user("Maya"));
    await Promise.all([loadSharedProfile("maya", { fetch, now: () => clock }), loadSharedProfile("MAYA", { fetch, now: () => clock })]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(entry()).toMatchObject({ status: "ready", user: { display_name: "Maya" } });
    clock += 60_000;
    await loadSharedProfile("maya", { fetch, now: () => clock });
    expect(fetch).toHaveBeenCalledTimes(1);
    // after five minutes a new name is asked for, the old one shown meanwhile
    clock += 5 * 60_000;
    fetch.mockResolvedValueOnce(user("Maya K"));
    await loadSharedProfile("maya", { fetch, now: () => clock });
    expect(entry()).toMatchObject({ status: "ready", user: { display_name: "Maya K" } });
  });

  it("tell a link to nobody from a request that failed", async () => {
    await loadSharedProfile("ghost", { fetch: () => Promise.reject(new ApiError(404, "profile_not_found", "gone")) });
    expect(entry("ghost")).toMatchObject({ status: "missing" });
    await loadSharedProfile("maya", { fetch: () => Promise.reject(new Error("offline")) });
    expect(entry()).toMatchObject({ status: "failed" });
  });

  it("are offered in menus for people, not for Nexa's own account", () => {
    useUsers.setState({ byId: { "7": user("Maya"), "8": { ...user("Nexa"), id: "8", username: "nexa", flags: 16 } } } as never);
    expect(profileLinkItem("7")).toMatchObject({ id: "copy-profile-link" });
    expect(profileLinkItem("8")).toBeNull();
    expect(profileLinkItem("9")).toBeNull();
  });
});
