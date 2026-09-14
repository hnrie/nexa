import { api, captchaOptions } from "./client";
import type { GuestInfo, GuestLink, Snowflake } from "./types";

export const guests = {
  /** Makes a link into a channel's call, carrying the key of `epoch`; maxAge is in seconds. */
  createLink(channelId: Snowflake, epoch: number, maxAge?: number): Promise<GuestLink> {
    return api.request("POST", `/channels/${channelId}/guest-links`, { epoch, ...(maxAge ? { max_age: maxAge } : {}) });
  },
  /** The caller's links for a call, or all of them for whoever manages its guests. */
  links(channelId: Snowflake): Promise<GuestLink[]> {
    return api.request("GET", `/channels/${channelId}/guest-links`);
  },
  /** Revokes every link of a call for whoever manages its guests, otherwise the caller's own. */
  revokeAll(channelId: Snowflake): Promise<{ revoked: number }> {
    return api.request("DELETE", `/channels/${channelId}/guest-links`);
  },
  revokeLink(channelId: Snowflake, code: string): Promise<void> {
    return api.request("DELETE", `/channels/${channelId}/guest-links/${encodeURIComponent(code)}`);
  },
  /** Puts a guest out of a call. */
  remove(channelId: Snowflake, guestId: Snowflake): Promise<void> {
    return api.request("DELETE", `/channels/${channelId}/guests/${guestId}`);
  },
  /** Whether a link still lets people in; it says nothing about where it leads. */
  check(code: string): Promise<{ ok: boolean }> {
    return api.request("GET", `/guest/links/${encodeURIComponent(code)}`);
  },
  join(code: string, displayName: string, captcha: string | null): Promise<{ token: string; guest: GuestInfo }> {
    return api.request("POST", "/guest/join", { code, display_name: displayName }, captchaOptions(captcha));
  },
  /** Ends the caller's stay as a guest. */
  leave(): Promise<void> {
    return api.request("DELETE", "/guest/me");
  },
};
