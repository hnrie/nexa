import { api } from "./client";
import type { AdminSettings, AdminStats, AdminUser, InstanceInfo, Snowflake } from "./types";

export const admin = {
  instance(): Promise<InstanceInfo> {
    return api.request<InstanceInfo>("GET", "/instance");
  },
  stats(): Promise<AdminStats> {
    return api.request<AdminStats>("GET", "/admin/stats");
  },
  users(q = "", before?: Snowflake): Promise<AdminUser[]> {
    return api.request<AdminUser[]>("GET", "/admin/users", undefined, { query: { q, before, limit: 50 } });
  },
  patchUser(id: Snowflake, body: { disabled?: boolean; admin?: boolean }): Promise<AdminUser> {
    return api.request<AdminUser>("PATCH", `/admin/users/${id}`, body);
  },
  settings(): Promise<AdminSettings> {
    return api.request<AdminSettings>("GET", "/admin/settings");
  },
  patchSettings(body: { registration?: string; registration_key?: string }): Promise<AdminSettings> {
    return api.request<AdminSettings>("PATCH", "/admin/settings", body);
  },
};
