import { api, captchaOptions } from "./client";
import type { Channel, PublicUser, Relationship, Snowflake } from "./types";

export const relationships = {
  list(): Promise<Relationship[]> {
    return api.request<Relationship[]>("GET", "/users/@me/relationships");
  },
  request(username: string, captcha?: string | null): Promise<{ type: string; user: PublicUser }> {
    return api.request("POST", "/users/@me/relationships", { username }, captchaOptions(captcha));
  },
  accept(id: Snowflake): Promise<{ type: string; user: PublicUser; channel?: Channel }> {
    return api.request("PUT", `/users/@me/relationships/${id}`);
  },
  remove(id: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/users/@me/relationships/${id}`);
  },
  block(id: Snowflake): Promise<void> {
    return api.request<void>("PUT", `/users/@me/blocks/${id}`);
  },
  unblock(id: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/users/@me/blocks/${id}`);
  },
  setNickname(userId: Snowflake, nickname: string): Promise<Relationship> {
    return api.request<Relationship>("PATCH", `/users/@me/relationships/${userId}`, { nickname });
  },
  /** Puts a note on the request this account sent them: a sealed box, base64 (lib/requestNote). */
  setNote(userId: Snowflake, sealedB64: string): Promise<void> {
    return api.request<void>("PUT", `/users/@me/relationships/${userId}/note`, { note: sealedB64 });
  },
};
