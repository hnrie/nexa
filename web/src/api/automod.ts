import { api } from "./client";
import type { Envelope } from "@/crypto/message";
import type { AutomodAction, AutomodConfig, AutomodEvent, AutomodKind, AutomodPresets, AutomodRule, PublicUser, Snowflake } from "./types";

export interface RuleBody {
  name?: string;
  kind?: AutomodKind;
  enabled?: boolean;
  config?: AutomodConfig;
  actions?: AutomodAction[];
  exempt_roles?: Snowflake[];
  exempt_channels?: Snowflake[];
}

export const automod = {
  /** Every rule, for the people who write them. */
  rules(serverId: Snowflake): Promise<AutomodRule[]> {
    return api.request("GET", `/servers/${serverId}/automod/rules`);
  },
  /** The rules members' apps apply to messages. */
  forMembers(serverId: Snowflake): Promise<AutomodRule[]> {
    return api.request("GET", `/servers/${serverId}/automod`);
  },
  create(serverId: Snowflake, body: RuleBody): Promise<AutomodRule> {
    return api.request("POST", `/servers/${serverId}/automod/rules`, body);
  },
  update(serverId: Snowflake, ruleId: Snowflake, body: RuleBody): Promise<AutomodRule> {
    return api.request("PATCH", `/servers/${serverId}/automod/rules/${ruleId}`, body);
  },
  remove(serverId: Snowflake, ruleId: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/servers/${serverId}/automod/rules/${ruleId}`);
  },
  /** What this app caught: its own message (no message_id), or someone else's that got past (a moderator's app). */
  report(serverId: Snowflake, body: { rule_id: Snowflake; channel_id: Snowflake; message_id?: Snowflake; content?: Envelope }): Promise<{ actions: string[] }> {
    return api.request("POST", `/servers/${serverId}/automod/report`, body);
  },
  events(serverId: Snowflake, q: { before?: Snowflake; user_id?: Snowflake; limit?: number } = {}): Promise<{ events: AutomodEvent[]; users: PublicUser[] }> {
    const query: Record<string, string> = {};
    if (q.before) query["before"] = q.before;
    if (q.user_id) query["user_id"] = q.user_id;
    if (q.limit) query["limit"] = String(q.limit);
    return api.request("GET", `/servers/${serverId}/automod/events`, undefined, { query });
  },
  stats(serverId: Snowflake): Promise<{ since: number; rules: { rule_id: Snowflake | null; rule_name: string; rule_kind: string; count: number }[] }> {
    return api.request("GET", `/servers/${serverId}/automod/stats`);
  },
  presets(): Promise<AutomodPresets> {
    return api.request("GET", `/automod/presets`);
  },
};
