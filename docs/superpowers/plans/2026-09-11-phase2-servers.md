# Evilion Chat — Phase 2 (Servers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Servers with categories and drag-and-drop channel ordering, roles with Discord's permission model, per-channel overwrites, invites (carrying the encryption key in the URL fragment), member list, moderation, audit log, per-server keys with rotation, and the matching UI.

**Architecture:** A pure `internal/perms` package implements the bitflag algorithm; the store gains server/role/member/invite/ban/audit queries plus `ChannelPerms` and server-aware `Entitled`; the API adds `/servers/*`, `/invites/*` and server-channel handling behind the hooks Phase 1 left (`ChannelAccess`, `ConvForChannel`, `ServerChannelPatch`, `CanRotate`, `InviteCheck`, `EntitledHook`, hub `ViewerResolver/Access/Interested/ReadyExtras/ExtraChannels`). The client mirrors the permission function, adds a `servers` store, the server rail entries, the channel sidebar with categories and reordering, server/channel settings, invite flow, and the member list.

**Spec:** `docs/superpowers/specs/2026-09-11-chat-design.md` §3 (Servers), §4, §5.1, §5.3, §6.4–6.5, §7.4.

## Global constraints
Same as Phase 1. Permissions serialise as decimal strings in JSON (int64 in SQLite, BigInt in TypeScript). Every server endpoint re-checks permissions with `perms` server-side; the client's mirror only gates affordances.

## Tasks

### Task 1: `internal/perms`
Bits with Discord's values: CreateInstantInvite 1<<0, KickMembers 1<<1, BanMembers 1<<2, Administrator 1<<3, ManageChannels 1<<4, ManageServer 1<<5, AddReactions 1<<6, ViewAuditLog 1<<7, PrioritySpeaker 1<<8, Stream 1<<9, ViewChannel 1<<10, SendMessages 1<<11, ManageMessages 1<<13, EmbedLinks 1<<14, AttachFiles 1<<15, ReadMessageHistory 1<<16, MentionEveryone 1<<17, Connect 1<<20, Speak 1<<21, MuteMembers 1<<22, DeafenMembers 1<<23, MoveMembers 1<<24, UseVAD 1<<25, ChangeNickname 1<<26, ManageNicknames 1<<27, ManageRoles 1<<28, ManageEmojis 1<<30, ModerateMembers 1<<40, UseSoundboard 1<<42, CreatePolls 1<<49. `All`, `DefaultEveryone`. `Compute(everyoneID ids.ID, everyone Perm, roles []Role, member Member, isOwner bool, overwrites []Overwrite) Perm` implementing spec §5.3 exactly; `Has`, `HighestPosition`, `CanManageRole`, `CanActOn`. Tests: 40+ table cases (base OR, admin, everyone overwrite deny/allow, role aggregate, member overwrite beats roles, timeout, no ViewChannel → 0, owner bypass, hierarchy).

### Task 2: store — servers, members, roles, server channels, overwrites, invites, bans, audit, server keys
- `CreateServer(ctx, owner, name) (*Server, error)`: server row, @everyone role (id = server id, DefaultEveryone), "Text Channels" category with `general`, "Voice Channels" category with `General`, system channel = general, owner member.
- `ServerByID`, `UpdateServer(patch)`, `DeleteServer`, `ServersForUser(uid) []*Server`, `TransferOwnership`.
- Members: `AddMember`, `RemoveMember`, `Member(server, uid) (*Member with RoleIDs)`, `Members(server, after, limit, q) []*Member`, `MemberIDs(server)`, `MemberCount`, `UpdateMember(patch{Nickname, AvatarID, TimeoutUntil})`, `IsMember`, `AddMemberRole/RemoveMemberRole/SetMemberRoles`.
- Roles: `CreateRole`, `UpdateRole(patch)`, `DeleteRole` (also removes member_roles, overwrites), `Roles(server)`, `SetRolePositions([]{id,pos})`.
- Channels: `CreateServerChannel`, `ServerChannels(server)`, `SetChannelPositions([]{id,pos,parent})`, `DeleteChannel` (categories unparent children), `SetOverwrite`, `DeleteOverwrite`, `Overwrites(channel)`, `OverwritesForServer(server) map[channel][]Overwrite`.
- `ChannelPerms(ctx, channelID, userID) (Perm, *Channel, error)` and `ServerPerms(ctx, serverID, userID) (Perm, error)` using perms; `ChannelViewers(ctx, channelID) []ids.ID`.
- `Entitled(conv)`: server id → member ids; server channel → viewers; DM as before.
- Invites: `CreateInvite(code 8 chars base62)`, `InviteByCode` (nil on expired/exhausted), `UseInvite`, `InvitesForServer`, `DeleteInvite`.
- Bans: `Ban`, `Unban`, `Bans(server)`, `IsBanned`.
- Audit: `AuditLog(entry)`, `AuditEntries(server, before, limit)`.
- `ChannelsForUser(uid)`: ids of all server channels the user can view (for read states in ready).
Tests for each, including `ChannelPerms` with overwrites and `Entitled` for a private channel.

### Task 3: API — server routes
`POST /servers` `{name}`; `GET/PATCH/DELETE /servers/{id}`; `PUT/DELETE /servers/{id}/icon|banner`; `POST /servers/{id}/leave`; `POST /servers/{id}/transfer {user_id}`; `GET /servers/{id}/channels`; `POST /servers/{id}/channels {type,name,parent_id}`; `PATCH /servers/{id}/channels [{id,position,parent_id}]`; `PATCH /channels/{id}` for server channels via `ServerChannelPatch` (name, topic, nsfw, slowmode, user_limit); `DELETE /channels/{id}`; `PUT /channels/{id}/permissions/{target} {type,allow,deny}` and `DELETE`; `GET/POST /servers/{id}/roles`, `PATCH /servers/{id}/roles` (positions), `PATCH/DELETE /servers/{id}/roles/{rid}`; `GET /servers/{id}/members?after&limit&q`, `GET /servers/{id}/members/{uid}`, `PATCH /servers/{id}/members/{uid} {nick, roles, timeout_until}`, `PATCH /servers/{id}/members/@me {nick}`, `DELETE /servers/{id}/members/{uid}` (kick), `PUT/DELETE /servers/{id}/members/{uid}/roles/{rid}`; `GET /servers/{id}/bans`, `PUT /servers/{id}/bans/{uid} {reason, delete_message_days}`, `DELETE /servers/{id}/bans/{uid}`; `GET /servers/{id}/invites`, `POST /channels/{id}/invites {max_age, max_uses}`, `DELETE /invites/{code}`, `GET /invites/{code}` (preview, unauthenticated allowed), `POST /invites/{code}` (join; banned → 403); `GET /servers/{id}/audit-log?before&limit`; `GET /servers/{id}/keys` (epochs + flags for server and private channels). Every mutation writes an audit entry and emits the matching gateway event. Kick/ban/leave sets `needs_rotation` on the server conv and every private-channel conv the user could view and emits `key_rotation_needed` to remaining members. Permission changes that make a channel private set `needs_own_key` and return `key_actions` in the response. Self-grants (`user_id == me`) are always accepted in `POST /keys/grants`.
Tests: create server has defaults; permissions enforced (non-admin cannot create channel; MANAGE_ROLES hierarchy; kick requires higher role); invite join flow incl. expiry; ban blocks join; private channel Entitled shrinks; audit entries written; gateway events delivered to members.

### Task 4: Gateway
`ReadyExtras`: `servers: [{...server, channels, roles, members (when ≤ 500 members, each with role_ids, nickname, joined_at), my_member, member_count}]`; `ExtraChannels` = viewable server channels; `ViewerResolver` = `ChannelViewers`; `Access` = ChannelPerms has ViewChannel (+SendMessages for typing); `Interested` = co-members. Events: `server_create/update/delete`, `channel_create/update/delete/positions`, `member_add/update/remove`, `role_create/update/delete`, `ban_add/remove`, `invite_create/delete`. Presence of members: online members' presences in ready.

### Task 5: Client — permissions mirror, servers store, rail, sidebar, chat for server channels
- `lib/perms.ts` mirroring Task 1 with BigInt and the same test vectors.
- `stores/servers.ts`: `byId: Record<id, ServerState{server, roles, members: Record<uid, Member>, memberCount, me: Member}>`; selectors `myPerms(serverId, channelId?)`.
- Rail: server icons (icon or initials), ordered by `settings.serverPositions` then join order; unread pill/mention badge aggregation; context menu (Mark as read, Invite people, Notification settings, Leave, Copy ID); "+" opens Create Server modal.
- Server sidebar: header (name, dropdown), categories collapsible, channels with `#`/speaker/lock icons, unread bold + pill, mention badge, hover create-channel/settings buttons, drag-and-drop reorder (HTML5 DnD; drop → PATCH positions), context menus (edit, invite, mark read, mute, delete).
- Chat view for text channels: `#name` header + topic, member list toggle, permission gating (no SendMessages → composer replaced by "You do not have permission to send messages in this channel."), slow mode countdown, `@everyone` allowed only with MentionEveryone.
- Member list: grouped by hoisted roles → Online → Offline; role colour on names; virtualised beyond 200.
- Modals: Create Server, Invite (generate/copy link with `#k=<epoch>.<base64 root>`), Create Channel/Category, Channel Settings (Overview, Permissions with tri-state overwrite editor for roles and members, Delete), Server Settings (Overview, Roles editor with permission grid and drag order, Members, Bans, Invites, Audit Log, Encryption with "Rotate keys", Delete), Leave/Kick/Ban confirms, invite landing page `/invite/:code`.
- Keys: `convForChannel` uses the channel's `key_conv` (server id or channel id, from channel payload `key_conv_id`); join via fragment self-grants; `keys_needed`/rotation as Phase 1; when a channel becomes private the actor's client creates its epoch and grants viewers.
- Notifications: per-server mute and level in settings; rail badges respect them.
- e2e: create server → invite link → second user joins via link with fragment and reads history; create private channel; role denies; drag reorder persists after reload; kick rotates keys.
