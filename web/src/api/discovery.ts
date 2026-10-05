import { api, captchaOptions } from "./client";
import type { DiscoveryCard, PublicUser, ServerView, Snowflake } from "./types";

export interface DiscoveryQuery {
  q?: string;
  category?: string;
  tag?: string;
  language?: string;
  min_members?: number;
  max_members?: number;
  sort?: "members" | "newest" | "created";
  offset?: number;
  limit?: number;
}

export const discovery = {
  search(q: DiscoveryQuery = {}): Promise<{ servers: DiscoveryCard[]; has_more: boolean; next_offset?: number }> {
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "" && v !== 0) query[k] = String(v);
    return api.request("GET", "/discovery", undefined, { query });
  },
  categories(): Promise<{ categories: string[]; counts: Record<string, number>; total: number; tags: string[]; languages: string[] }> {
    return api.request("GET", "/discovery/categories");
  },
  server(id: Snowflake): Promise<{ server: DiscoveryCard; emojis?: { id: Snowflake; blob_id: Snowflake; name: string; animated: boolean }[]; owner?: PublicUser }> {
    return api.request("GET", `/discovery/${id}`);
  },
  join(id: Snowflake, captcha?: string | null): Promise<{ server: ServerView; users: PublicUser[] }> {
    return api.request("POST", `/discovery/${id}/join`, undefined, captchaOptions(captcha));
  },
};
