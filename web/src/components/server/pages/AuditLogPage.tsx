import { useEffect, useState } from "react";
import { servers as serversApi } from "@/api/servers";
import type { AuditEntry } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Select } from "@/components/common/Select";
import { LoadError } from "@/components/common/LoadError";
import { Spinner } from "@/components/common/Spinner";
import { formatSpan } from "@/lib/moderation";
import { P, has, parsePerm, permGroups } from "@/lib/perms";
import { formatFull, formatShortDuration } from "@/lib/time";
import { useChannels } from "@/stores/channels";
import { useExpressions } from "@/stores/expressions";
import { useServers } from "@/stores/servers";
import { displayName, useUsers } from "@/stores/users";
import st from "@/components/settings/Settings.module.css";
import s from "../ServerSettings.module.css";

import { t } from "@/i18n";
import { isolate } from "../bidi";
/** What each audited action says, looked up per render so it follows the language. */
function verbs(): Record<string, string> {
  return {
    server_update: t("server.auditLog.verb.server_update"),
    server_transfer: t("server.auditLog.verb.server_transfer"),
    channel_create: t("server.auditLog.verb.channel_create"),
    channel_update: t("server.auditLog.verb.channel_update"),
    channel_delete: t("server.auditLog.verb.channel_delete"),
    channel_positions: t("server.auditLog.verb.channel_positions"),
    overwrite_update: t("server.auditLog.verb.overwrite_update"),
    overwrite_delete: t("server.auditLog.verb.overwrite_delete"),
    role_create: t("server.auditLog.verb.role_create"),
    role_update: t("server.auditLog.verb.role_update"),
    role_delete: t("server.auditLog.verb.role_delete"),
    role_positions: t("server.auditLog.verb.role_positions"),
    member_update: t("server.auditLog.verb.member_update"),
    member_role_add: t("server.auditLog.verb.member_role_add"),
    member_role_remove: t("server.auditLog.verb.member_role_remove"),
    member_kick: t("server.auditLog.verb.member_kick"),
    member_ban: t("server.auditLog.verb.member_ban"),
    member_unban: t("server.auditLog.verb.member_unban"),
    member_voice: t("server.auditLog.verb.member_voice"),
    emoji_create: t("server.auditLog.verb.emoji_create"),
    emoji_update: t("server.auditLog.verb.emoji_update"),
    emoji_delete: t("server.auditLog.verb.emoji_delete"),
    sticker_pack_create: t("server.auditLog.verb.sticker_pack_create"),
    sticker_pack_update: t("server.auditLog.verb.sticker_pack_update"),
    sticker_pack_delete: t("server.auditLog.verb.sticker_pack_delete"),
    invite_create: t("server.auditLog.verb.invite_create"),
    invite_delete: t("server.auditLog.verb.invite_delete"),
    webhook_create: t("server.auditLog.verb.webhook_create"),
    webhook_update: t("server.auditLog.verb.webhook_update"),
    webhook_delete: t("server.auditLog.verb.webhook_delete"),
    server_tag_update: t("server.auditLog.verb.server_tag_update"),
    server_tag_delete: t("server.auditLog.verb.server_tag_delete"),
  };
}

/** A channel by the name its row shows: text channels with their "#", voice channels and categories without. */
function shownChannel(ch: { type: string; name: string }): string {
  return ch.type === "text" ? `#${ch.name}` : ch.name;
}

export default function AuditLogPage({ serverId }: { serverId: string }) {
  const users = useUsers((u) => u.byId);
  const upsertUsers = useUsers((u) => u.upsert);
  const channels = useChannels((c) => c.byId);
  const server = useServers((x) => x.byId[serverId]);
  const packs = useExpressions((x) => x.packs);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  // A first page that failed used to read "Nothing has happened yet", which for
  // a moderation record is the most misleading sentence in the app. A later
  // page that failed keeps what is already on screen and says the rest is
  // missing.
  const [failed, setFailed] = useState(false);
  // Who and what to show. The log only ever arrives a page at a time, so this
  // narrows what has loaded; "Load more" carries on further back, filtered.
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const load = async (before?: string) => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await serversApi.auditLog(serverId, { limit: 50, ...(before ? { before } : {}) });
      upsertUsers(res.users);
      setEntries((cur) => [...(before ? (cur ?? []) : []), ...res.entries]);
      setDone(res.entries.length < 50);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  const targetName = (e: AuditEntry): string => {
    if (!e.target_id) return "";
    if (e.target_type === "user") return displayName(users[e.target_id]);
    if (e.target_type === "channel") {
      const ch = channels[e.target_id];
      const changes = e.changes as { name?: string } | null;
      return isolate(ch ? shownChannel(ch) : changes?.name ? `#${changes.name}` : t("server.auditLog.aDeletedChannel"));
    }
    if (e.target_type === "role") {
      const changes = e.changes as { name?: string } | null;
      return server?.roles[e.target_id]?.name ?? changes?.name ?? t("server.auditLog.aDeletedRole");
    }
    if (e.target_type === "emoji") {
      const changes = e.changes as { name?: string } | null;
      return changes?.name ? isolate(`:${changes.name}:`) : "";
    }
    if (e.target_type === "webhook") {
      // a rename records the new name, other changes the name it has; creating and deleting record the one it had
      const changes = e.changes as { name?: string; current_name?: string } | null;
      const name = changes?.name || changes?.current_name;
      return name ? isolate(name) : "";
    }
    if (e.target_type === "sticker_pack") {
      // pack updates record no changes, so the pack's current name is the only one there is
      const changes = e.changes as { name?: string } | null;
      return changes?.name ?? packs[e.target_id]?.name ?? "";
    }
    return "";
  };
  // What an id in the changes stands for, where this client knows: a row
  // reading "role: 96767107336765440" told a moderator nothing about which
  // role was handed out.
  const roleName = (id: string): string | undefined => (id === serverId ? isolate("@everyone") : server?.roles[id]?.name);
  const channelName = (id: string): string | undefined => {
    const ch = channels[id];
    return ch ? isolate(shownChannel(ch)) : undefined;
  };
  const userName = (id: string): string | undefined => (users[id] ? displayName(users[id]) : undefined);
  const permNames = (v: unknown): string => {
    const bits = parsePerm(v as string);
    if (bits === 0n) return none();
    return permGroups()
      .flatMap((g) => g.items)
      .filter((it) => has(bits, P[it.name]))
      .map((it) => it.label)
      .join(", ");
  };
  const none = () => t("settings.profile.none");
  const onOff = (v: unknown) => (v ? t("server.auditLog.on") : t("server.channelSettings.slowmodeOff"));
  // What each recorded field is called on the screens where it is set, and its
  // value in the words those screens use: "max_age: 604800" was the invite's
  // lifetime in seconds, and "hoist: true" a checkbox a moderator knows by
  // another name.
  const field = (k: string, v: unknown, e: AuditEntry, obj: Record<string, unknown>): [string, string] | null => {
    const str = typeof v === "string" ? v : undefined;
    const num = typeof v === "number" ? v : undefined;
    switch (k) {
      case "name":
        return [t("modals.subchat.name"), str || none()];
      case "description":
        return [t("server.serverOverview.serverDescription"), str || none()];
      case "topic":
        return [t("server.channelSettings.channelTopic"), str || none()];
      case "type":
        return [t("modals.createChannel.channelType"), str === "voice" ? t("modals.createChannel.voice") : str === "category" ? t("server.auditLog.category") : t("modals.createChannel.text")];
      case "system_channel_id":
        return [t("server.serverOverview.systemMessagesChannel"), (str && channelName(str)) || t("server.serverOverview.noSystemMessages")];
      case "default_notifications":
        return [t("server.serverOverview.defaultNotificationSettings"), num === 1 ? t("server.serverOverview.onlyMentions") : t("server.serverOverview.allMessages")];
      case "nsfw":
        return [t("server.channelSettings.ageRestrictedChannel"), onOff(v)];
      case "slowmode_seconds":
        return [t("server.channelSettings.slowmode"), num ? formatShortDuration(num) : t("server.channelSettings.slowmodeOff")];
      case "user_limit":
        return [t("server.auditLog.userLimit"), num ? String(num) : t("server.channelSettings.noLimit")];
      case "color":
        return [t("server.roles.roleColour"), num ? `#${num.toString(16).padStart(6, "0")}` : t("server.roles.default")];
      case "tag":
        return [t("serverTag.page.tagLabel"), str || none()];
      case "tag_badge":
        return [t("serverTag.page.badge"), str?.startsWith("image:") ? t("serverTag.page.yourPicture") : (str ?? "").replace(/^icon:/, "")];
      case "tag_color":
        return [t("serverTag.page.color"), typeof num === "number" ? `#${num.toString(16).padStart(6, "0")}` : t("serverTag.page.accent")];
      case "tag_limited":
        return [t("serverTag.page.who"), v ? t("serverTag.page.someRoles") : t("serverTag.page.everyone")];
      case "tag_join":
        return [t("serverTag.page.join"), onOff(v)];
      case "hoist":
        return [t("server.roles.displayRoleMembersSeparatelyFromOnline"), onOff(v)];
      case "mentionable":
        return [t("server.roles.allowAnyoneToMentionThisRole"), onOff(v)];
      case "permissions":
        return [t("server.channelSettings.permissions"), permNames(v)];
      case "allow":
        return [t("server.permissionGrid.allow"), permNames(v)];
      case "deny":
        return [t("server.permissionGrid.deny"), permNames(v)];
      case "target_id":
      case "target": {
        // an overwrite names who it is for; a member's own entry already does
        if (!str) return null;
        const member = obj["target_type"] === "member";
        return [member ? t("server.channelSettings.member") : t("server.channelSettings.role"), (member ? userName(str) : (roleName(str) ?? userName(str))) ?? str];
      }
      case "role":
        return [t("server.channelSettings.role"), (str && roleName(str)) || t("server.auditLog.aDeletedRole")];
      case "roles":
        return [t("server.members.roles"), Array.isArray(v) && v.length ? v.map((id) => roleName(String(id)) ?? t("server.auditLog.aDeletedRole")).join(", ") : none()];
      case "nick":
        return [t("modals.serverProfile.nickname"), str || none()];
      case "timeout_until":
        return [t("server.members.timedOut"), num && num > 0 ? formatFull(num) : none()];
      case "mute":
        return [t("voice.voice.mute"), onOff(v)];
      case "deaf":
        return [t("shell.user.deafen"), onOff(v)];
      case "channel_id":
        // the channel an entry is about is its own target; a voice move names where to
        if (v === e.target_id) return null;
        return [t("server.invites.channel"), (str && channelName(str)) || t("server.auditLog.disconnected")];
      case "parent_id":
        return [t("server.auditLog.category"), (str && channelName(str)) || none()];
      case "code":
        return [t("server.invites.code"), str ?? ""];
      case "max_age":
        return [t("modals.groupInvite.expireAfter"), num ? formatSpan(num * 1000) : t("server.invites.never")];
      case "max_uses":
        return [t("modals.groupInvite.maxNumberOfUses"), num ? String(num) : t("modals.invite.noLimit")];
      case "delete_message_days":
        return [t("server.memberAction.deleteMessageHistory"), num ? formatSpan(num * 86_400_000) : none()];
      case "icon":
        return [t("server.serverOverview.serverIcon"), v ? t("server.auditLog.changed") : t("server.auditLog.removed")];
      case "banner":
        return [t("server.serverOverview.serverBanner"), v ? t("server.auditLog.changed") : t("server.auditLog.removed")];
      case "avatar":
        return [t("integrations.image"), v ? t("server.auditLog.changed") : t("server.auditLog.removed")];
      case "target_type":
      case "current_name":
        return null;
      default:
        return [k, Array.isArray(v) ? t("server.auditLog.itemsCount", { count: v.length }) : str ?? JSON.stringify(v)];
    }
  };
  const changesText = (e: AuditEntry): string => {
    if (!e.changes || typeof e.changes !== "object") return "";
    // the reorders record the whole new order, which says nothing read as text
    if (Array.isArray(e.changes)) return t("server.auditLog.itemsCount", { count: e.changes.length });
    const obj = e.changes as Record<string, unknown>;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      const shown = field(k, v, e, obj);
      if (shown) parts.push(`${shown[0]}: ${shown[1]}`);
    }
    return parts.join(" · ");
  };
  // A long bulk change is cut, with a way to read the rest: the cut used to
  // drop its tail with no sign there was one.
  const LONG = 300;
  const changesView = (e: AuditEntry) => {
    const text = changesText(e);
    if (!text) return null;
    const open = expanded.has(e.id);
    const long = text.length > LONG;
    return (
      <div className={s.auditChanges}>
        {long && !open ? `${text.slice(0, LONG - 1)}…` : text}
        {long ? (
          <button type="button" className={s.auditMore} aria-expanded={open} onClick={() => setExpanded((cur) => { const next = new Set(cur); if (open) next.delete(e.id); else next.add(e.id); return next; })}>
            {open ? t("server.auditLog.showLess") : t("server.auditLog.showAll")}
          </button>
        ) : null}
      </div>
    );
  };
  const actors = [...new Set((entries ?? []).map((e) => e.actor_id))];
  const actions = [...new Set((entries ?? []).map((e) => e.action))];
  const shown = (entries ?? []).filter((e) => (!actor || e.actor_id === actor) && (!action || e.action === action));
  const filtering = !!actor || !!action;

  return (
    <>
      <h2 className={st.title}>{t("server.auditLog.auditLog")}</h2>
      <p className={st.hint}>{t("server.auditLog.everyModerationAndConfigurationChangeIn")}</p>
      <div style={{ height: 16 }} />
      {entries && entries.length > 0 ? (
        <div className={s.auditFilters}>
          <Select value={actor} onChange={(e) => setActor(e.target.value)} aria-label={t("server.auditLog.filterByMember")} data-testid="audit-actor">
            <option value="">{t("server.auditLog.anyone")}</option>
            {actors.map((id) => <option key={id} value={id}>{displayName(users[id])}</option>)}
          </Select>
          <Select value={action} onChange={(e) => setAction(e.target.value)} aria-label={t("server.auditLog.filterByAction")} data-testid="audit-action">
            <option value="">{t("server.auditLog.anyAction")}</option>
            {actions.map((a) => <option key={a} value={a}>{verbs()[a] ?? a}</option>)}
          </Select>
        </div>
      ) : null}
      {filtering && !done ? <p className={st.hint} style={{ margin: "0 0 12px" }}>{t("server.auditLog.filteredSoFar")}</p> : null}
      {entries === null && !failed ? <Spinner label={t("server.auditLog.loadingTheAuditLog")} /> : null}
      {entries && entries.length === 0 && !failed ? <p className={st.hint}>{t("server.auditLog.nothingHasHappenedYet")}</p> : null}
      {entries && entries.length > 0 && shown.length === 0 ? <p className={st.hint}>{t("server.auditLog.nothingMatches")}</p> : null}
      {shown.map((e) => (
        <div key={e.id} className={s.auditRow}>
          <Avatar id={e.actor_id} avatarId={users[e.actor_id]?.avatar_id ?? null} name={displayName(users[e.actor_id])} size={32} />
          <div className={s.auditText}>
            <b>{displayName(users[e.actor_id])}</b> {verbs()[e.action] ?? e.action} {targetName(e) ? <b>{targetName(e)}</b> : null}
            <div className={s.auditMeta}>{formatFull(e.created_at)}{e.reason ? ` · ${t("server.auditLog.reason", { reason: e.reason })}` : ""}</div>
            {changesView(e)}
          </div>
        </div>
      ))}
      {failed ? (
        <LoadError
          message={entries && entries.length > 0 ? t("server.auditLog.theRestOfTheLogCould") : t("server.auditLog.theAuditLogCouldNotBe")}
          busy={busy}
          onRetry={() => void load(entries && entries.length > 0 ? entries[entries.length - 1]?.id : undefined)}
        />
      ) : null}
      {entries && entries.length > 0 && !done && !failed ? (
        <div className={s.loadMore}>
          <Button variant="secondary" size="sm" loading={busy} onClick={() => void load(entries[entries.length - 1]?.id)}>{t("server.auditLog.loadMore")}</Button>
        </div>
      ) : null}
    </>
  );
}
