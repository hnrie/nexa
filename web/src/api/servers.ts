import { api } from "./client";
import type { AuditEntry, Ban, Channel, Invite, InvitePreview, Member, PermString, PublicUser, Role, Server, ServerKeyInfo, ServerView, Snowflake } from "./types";

type Progress = (loaded: number, total: number) => void;

export interface ServerPatch {
  name?: string;
  description?: string;
  system_channel_id?: Snowflake | null;
  default_notifications?: number;
}

export interface ChannelPatch {
  name?: string;
  topic?: string;
  nsfw?: boolean;
  slowmode_seconds?: number;
  user_limit?: number;
}

export interface ChannelPositionPatch {
  id: Snowflake;
  position: number;
  parent_id?: Snowflake | null;
}

export interface RoleBody {
  name?: string;
  color?: number;
  hoist?: boolean;
  mentionable?: boolean;
  permissions?: PermString;
}

export interface MemberPatch {
  nick?: string | null;
  timeout_until?: number | null;
  roles?: Snowflake[];
}

function upload<T>(path: string, file: Blob, onProgress?: Progress): Promise<T> {
  const opts: { method: string; headers: Record<string, string>; onProgress?: Progress } = { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" } };
  if (onProgress) opts.onProgress = onProgress;
  return api.upload<T>(path, file, opts);
}

export const servers = {
  create(name: string): Promise<ServerView> {
    return api.request<ServerView>("POST", "/servers", { name });
  },
  get(id: Snowflake): Promise<{ server: ServerView; users: PublicUser[] }> {
    return api.request("GET", `/servers/${id}`);
  },
  patch(id: Snowflake, body: ServerPatch): Promise<Server> {
    return api.request<Server>("PATCH", `/servers/${id}`, body);
  },
  delete(id: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/servers/${id}`);
  },
  uploadIcon(id: Snowflake, file: Blob, onProgress?: Progress): Promise<Server> {
    return upload<Server>(`/servers/${id}/icon`, file, onProgress);
  },
  deleteIcon(id: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/servers/${id}/icon`);
  },
  uploadBanner(id: Snowflake, file: Blob, onProgress?: Progress): Promise<Server> {
    return upload<Server>(`/servers/${id}/banner`, file, onProgress);
  },
  deleteBanner(id: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/servers/${id}/banner`);
  },
  leave(id: Snowflake): Promise<void> {
    return api.request<void>("POST", `/servers/${id}/leave`);
  },
  transfer(id: Snowflake, userId: Snowflake): Promise<Server> {
    return api.request<Server>("POST", `/servers/${id}/transfer`, { user_id: userId });
  },
  channels(id: Snowflake): Promise<Channel[]> {
    return api.request<Channel[]>("GET", `/servers/${id}/channels`);
  },
  createChannel(id: Snowflake, body: { type: "text" | "voice" | "category"; name: string; parent_id?: Snowflake | null }): Promise<Channel> {
    return api.request<Channel>("POST", `/servers/${id}/channels`, body);
  },
  setChannelPositions(id: Snowflake, list: ChannelPositionPatch[]): Promise<Channel[]> {
    return api.request<Channel[]>("PATCH", `/servers/${id}/channels`, list);
  },
  patchChannel(channelId: Snowflake, body: ChannelPatch): Promise<Channel> {
    return api.request<Channel>("PATCH", `/channels/${channelId}`, body);
  },
  deleteChannel(channelId: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/channels/${channelId}`);
  },
  putOverwrite(channelId: Snowflake, targetId: Snowflake, body: { type: "role" | "member"; allow: PermString; deny: PermString }): Promise<{ overwrite: unknown; key_actions?: { needs_own_key: boolean; conv_id: Snowflake } }> {
    return api.request("PUT", `/channels/${channelId}/permissions/${targetId}`, body);
  },
  deleteOverwrite(channelId: Snowflake, targetId: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/channels/${channelId}/permissions/${targetId}`);
  },
  roles(id: Snowflake): Promise<Role[]> {
    return api.request<Role[]>("GET", `/servers/${id}/roles`);
  },
  createRole(id: Snowflake, body: RoleBody): Promise<Role> {
    return api.request<Role>("POST", `/servers/${id}/roles`, body);
  },
  patchRole(id: Snowflake, roleId: Snowflake, body: RoleBody): Promise<Role> {
    return api.request<Role>("PATCH", `/servers/${id}/roles/${roleId}`, body);
  },
  deleteRole(id: Snowflake, roleId: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/servers/${id}/roles/${roleId}`);
  },
  setRolePositions(id: Snowflake, list: { id: Snowflake; position: number }[]): Promise<Role[]> {
    return api.request<Role[]>("PATCH", `/servers/${id}/roles`, list);
  },
  members(id: Snowflake, query: { after?: Snowflake; limit?: number; q?: string } = {}): Promise<{ members: Member[]; users: PublicUser[] }> {
    const q: Record<string, string> = {};
    if (query.after) q["after"] = query.after;
    if (query.limit) q["limit"] = String(query.limit);
    if (query.q) q["q"] = query.q;
    return api.request("GET", `/servers/${id}/members`, undefined, { query: q });
  },
  member(id: Snowflake, userId: Snowflake): Promise<Member> {
    return api.request<Member>("GET", `/servers/${id}/members/${userId}`);
  },
  patchMember(id: Snowflake, userId: Snowflake | "@me", body: MemberPatch): Promise<Member> {
    return api.request<Member>("PATCH", `/servers/${id}/members/${userId}`, body);
  },
  kick(id: Snowflake, userId: Snowflake, reason?: string): Promise<void> {
    return api.request<void>("DELETE", `/servers/${id}/members/${userId}`, undefined, reason ? { query: { reason } } : {});
  },
  addRole(id: Snowflake, userId: Snowflake, roleId: Snowflake): Promise<Member> {
    return api.request<Member>("PUT", `/servers/${id}/members/${userId}/roles/${roleId}`);
  },
  removeRole(id: Snowflake, userId: Snowflake, roleId: Snowflake): Promise<Member> {
    return api.request<Member>("DELETE", `/servers/${id}/members/${userId}/roles/${roleId}`);
  },
  bans(id: Snowflake): Promise<{ bans: Ban[]; users: PublicUser[] }> {
    return api.request("GET", `/servers/${id}/bans`);
  },
  ban(id: Snowflake, userId: Snowflake, body: { reason?: string; delete_message_days?: number } = {}): Promise<void> {
    return api.request<void>("PUT", `/servers/${id}/bans/${userId}`, body);
  },
  unban(id: Snowflake, userId: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/servers/${id}/bans/${userId}`);
  },
  invites(id: Snowflake): Promise<Invite[]> {
    return api.request<Invite[]>("GET", `/servers/${id}/invites`);
  },
  createInvite(channelId: Snowflake, body: { max_age?: number; max_uses?: number } = {}): Promise<Invite> {
    return api.request<Invite>("POST", `/channels/${channelId}/invites`, body);
  },
  invitePreview(code: string): Promise<InvitePreview> {
    return api.request<InvitePreview>("GET", `/invites/${encodeURIComponent(code)}`);
  },
  join(code: string): Promise<{ server: ServerView; users: PublicUser[] }> {
    return api.request("POST", `/invites/${encodeURIComponent(code)}`);
  },
  deleteInvite(code: string): Promise<void> {
    return api.request<void>("DELETE", `/invites/${encodeURIComponent(code)}`);
  },
  auditLog(id: Snowflake, query: { before?: Snowflake; limit?: number } = {}): Promise<{ entries: AuditEntry[]; users: PublicUser[] }> {
    const q: Record<string, string> = {};
    if (query.before) q["before"] = query.before;
    if (query.limit) q["limit"] = String(query.limit);
    return api.request("GET", `/servers/${id}/audit-log`, undefined, { query: q });
  },
  keys(id: Snowflake): Promise<ServerKeyInfo[]> {
    return api.request<ServerKeyInfo[]>("GET", `/servers/${id}/keys`);
  },
};
