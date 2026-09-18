import { useEffect, useState } from "react";
import { servers as serversApi } from "@/api/servers";
import type { Ban } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { LoadError } from "@/components/common/LoadError";
import { Spinner } from "@/components/common/Spinner";
import { TextInput } from "@/components/common/TextInput";
import { dispatchHooks } from "@/gateway/dispatch";
import type { GatewayEvent } from "@/gateway/events";
import { describeError } from "@/lib/errors";
import { formatFull } from "@/lib/time";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import st from "@/components/settings/Settings.module.css";
import s from "../ServerSettings.module.css";

import { t } from "@/i18n";
export default function BansPage({ serverId }: { serverId: string }) {
  const users = useUsers((u) => u.byId);
  const upsertUsers = useUsers((u) => u.upsert);
  const toast = useUI((u) => u.toast);
  const [bans, setBans] = useState<Ban[] | null>(null);
  // A request that failed used to end up as "No one is banned, keep it that
  // way", which a moderator has no reason to doubt. Held apart from the empty
  // list so the two can never be drawn the same.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      serversApi
        .bans(serverId)
        .then((res) => {
          if (!alive) return;
          upsertUsers(res.users);
          setBans(res.bans);
          setFailed(false);
        })
        .catch(() => {
          if (!alive) return;
          setBans(null);
          setFailed(true);
        });
    void load();
    const hook = (e: GatewayEvent) => {
      if ((e.t === "ban_add" || e.t === "ban_remove") && (e.d as { server_id?: string }).server_id === serverId) void load();
    };
    dispatchHooks.onUnhandled.push(hook);
    return () => {
      alive = false;
      dispatchHooks.onUnhandled.splice(dispatchHooks.onUnhandled.indexOf(hook), 1);
    };
  }, [serverId, upsertUsers, attempt]);

  const revoke = async (userId: string) => {
    setBusy(userId);
    try {
      await serversApi.unban(serverId, userId);
      setBans((cur) => cur?.filter((b) => b.user_id !== userId) ?? null);
    } catch (err) {
      toast(describeError(err, t("server.bans.couldNotRevokeTheBan")), "error");
    } finally {
      setBusy(null);
    }
  };

  const query = q.trim().toLowerCase();
  const shown = (bans ?? []).filter((b) => !query || displayName(users[b.user_id]).toLowerCase().includes(query) || (users[b.user_id]?.username ?? "").includes(query));
  return (
    <>
      <h2 className={st.title}>{bans ? t("server.bans.bansCount", { count: bans.length }) : t("server.bans.bans")}</h2>
      <div className={s.searchRow}>
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("server.bans.searchBans")} />
      </div>
      {bans === null && !failed ? <Spinner label={t("server.bans.loadingBans")} /> : null}
      {failed ? <LoadError message={t("server.bans.theBanListCouldNotBe")} onRetry={() => setAttempt((n) => n + 1)} /> : null}
      {bans && bans.length === 0 ? <p className={st.hint}>{t("server.bans.noOneIsBannedKeepIt")}</p> : null}
      {shown.map((b) => (
        <div key={b.user_id} className={s.memberRow}>
          <Avatar id={b.user_id} avatarId={users[b.user_id]?.avatar_id ?? null} name={displayName(users[b.user_id])} size={40} />
          <div className={s.memberText}>
            <span className={s.memberName}>{displayName(users[b.user_id])}</span>
            <span className={s.memberSub}>@{users[b.user_id]?.username ?? b.user_id} · {t("server.bans.bannedByOn", { when: formatFull(b.created_at), who: displayName(users[b.banned_by]) })}{b.reason ? ` · ${b.reason}` : ""}</span>
          </div>
          <Button size="sm" variant="secondary" loading={busy === b.user_id} onClick={() => void revoke(b.user_id)}>{t("server.bans.revokeBan")}</Button>
        </div>
      ))}
    </>
  );
}
