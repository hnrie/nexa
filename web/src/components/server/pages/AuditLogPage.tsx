import { useEffect, useState } from "react";
import { servers as serversApi } from "@/api/servers";
import type { AuditEntry } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { formatFull } from "@/lib/time";
import { useChannels } from "@/stores/channels";
import { useExpressions } from "@/stores/expressions";
import { useServers } from "@/stores/servers";
import { displayName, useUsers } from "@/stores/users";
import st from "@/components/settings/Settings.module.css";
import s from "../ServerSettings.module.css";

import { t } from "@/i18n";
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
  };
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

  const load = async (before?: string) => {
    setBusy(true);
    try {
      const res = await serversApi.auditLog(serverId, { limit: 50, ...(before ? { before } : {}) });
      upsertUsers(res.users);
      setEntries((cur) => [...(before ? (cur ?? []) : []), ...res.entries]);
      if (res.entries.length < 50) setDone(true);
    } catch {
      setEntries((cur) => cur ?? []);
      setDone(true);
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
      return ch ? (ch.type === "category" ? ch.name : `#${ch.name}`) : changes?.name ? `#${changes.name}` : "a deleted channel";
    }
    if (e.target_type === "role") {
      const changes = e.changes as { name?: string } | null;
      return server?.roles[e.target_id]?.name ?? changes?.name ?? "a deleted role";
    }
    if (e.target_type === "emoji") {
      const changes = e.changes as { name?: string } | null;
      return changes?.name ? `:${changes.name}:` : "";
    }
    if (e.target_type === "sticker_pack") {
      // pack updates record no changes, so the pack's current name is the only one there is
      const changes = e.changes as { name?: string } | null;
      return changes?.name ?? packs[e.target_id]?.name ?? "";
    }
    return "";
  };
  const changesText = (e: AuditEntry): string => {
    if (!e.changes || typeof e.changes !== "object") return "";
    const obj = e.changes as Record<string, unknown>;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v) && v.length > 3) parts.push(`${k}: ${t("server.auditLog.itemsCount", { count: v.length })}`);
      else parts.push(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
    }
    return parts.join(" · ").slice(0, 300);
  };

  return (
    <>
      <h2 className={st.title}>{t("server.auditLog.auditLog")}</h2>
      <p className={st.hint}>{t("server.auditLog.everyModerationAndConfigurationChangeIn")}</p>
      <div style={{ height: 16 }} />
      {entries === null ? <Spinner /> : null}
      {entries && entries.length === 0 ? <p className={st.hint}>{t("server.auditLog.nothingHasHappenedYet")}</p> : null}
      {entries?.map((e) => (
        <div key={e.id} className={s.auditRow}>
          <Avatar id={e.actor_id} avatarId={users[e.actor_id]?.avatar_id ?? null} name={displayName(users[e.actor_id])} size={32} />
          <div className={s.auditText}>
            <b>{displayName(users[e.actor_id])}</b> {verbs()[e.action] ?? e.action} {targetName(e) ? <b>{targetName(e)}</b> : null}
            <div className={s.auditMeta}>{formatFull(e.created_at)}{e.reason ? ` · ${t("server.auditLog.reason", { reason: e.reason })}` : ""}</div>
            {changesText(e) ? <div className={s.auditChanges}>{changesText(e)}</div> : null}
          </div>
        </div>
      ))}
      {entries && entries.length > 0 && !done ? (
        <div className={s.loadMore}>
          <Button variant="secondary" size="sm" loading={busy} onClick={() => void load(entries[entries.length - 1]?.id)}>{t("server.auditLog.loadMore")}</Button>
        </div>
      ) : null}
    </>
  );
}
