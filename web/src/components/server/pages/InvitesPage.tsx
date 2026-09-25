import { useEffect, useState } from "react";
import { servers as serversApi } from "@/api/servers";
import type { Invite } from "@/api/types";
import { Button } from "@/components/common/Button";
import { LoadError } from "@/components/common/LoadError";
import { Spinner } from "@/components/common/Spinner";
import { dispatchHooks } from "@/gateway/dispatch";
import type { GatewayEvent } from "@/gateway/events";
import { describeError } from "@/lib/errors";
import { formatFull } from "@/lib/time";
import { copyAndSay } from "@/lib/copyText";
import { inviteUrl } from "@/lib/inviteLink";
import { ring } from "@/lib/keyring";
import { useChannels } from "@/stores/channels";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import st from "@/components/settings/Settings.module.css";
import s from "../ServerSettings.module.css";

import { t } from "@/i18n";
export default function InvitesPage({ serverId }: { serverId: string }) {
  const users = useUsers((u) => u.byId);
  const channels = useChannels((c) => c.byId);
  const toast = useUI((u) => u.toast);
  const openModal = useUI((u) => u.openModal);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  // "There are no active invites" is a statement of fact about the server; a
  // request that failed has no business making it.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      serversApi
        .invites(serverId)
        .then((list) => {
          if (!alive) return;
          setInvites(list);
          setFailed(false);
        })
        .catch(() => {
          if (!alive) return;
          setInvites(null);
          setFailed(true);
        });
    void load();
    const hook = (e: GatewayEvent) => {
      if ((e.t === "invite_create" || e.t === "invite_delete") && (e.d as { server_id?: string }).server_id === serverId) void load();
    };
    dispatchHooks.onUnhandled.push(hook);
    return () => {
      alive = false;
      dispatchHooks.onUnhandled.splice(dispatchHooks.onUnhandled.indexOf(hook), 1);
    };
  }, [serverId, attempt]);

  const revoke = async (code: string) => {
    setBusy(code);
    try {
      await serversApi.deleteInvite(code);
      setInvites((cur) => cur?.filter((i) => i.code !== code) ?? null);
    } catch (err) {
      toast(describeError(err, t("server.invites.couldNotRevokeTheInvite")), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h2 className={st.title}>{t("server.invites.invites")}</h2>
      <p className={st.hint}>{t("server.invites.activeInviteLinksForThisServer")}</p>
      <div style={{ margin: "16px 0" }}>
        <Button size="sm" onClick={() => openModal("invite", { serverId })}>{t("server.invites.createInvite")}</Button>
      </div>
      {invites === null && !failed ? <Spinner label={t("server.invites.loadingInvites")} /> : null}
      {failed ? <LoadError message={t("server.invites.theInviteListCouldNotBe")} onRetry={() => setAttempt((n) => n + 1)} /> : null}
      {invites && invites.length === 0 ? <p className={st.hint}>{t("server.invites.thereAreNoActiveInvites")}</p> : null}
      {invites && invites.length > 0 ? (
        <div className={s.tableWrap}>
          {/* data-label names each value when a phone draws a row as a card */}
          <table className={[s.table, s.stack].join(" ")}>
            <thead>
              <tr><th>{t("server.invites.inviter")}</th><th>{t("server.invites.code")}</th><th>{t("server.invites.channel")}</th><th>{t("server.invites.uses")}</th><th>{t("server.invites.expires")}</th><th /></tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.code} data-invite={i.code}>
                  <td data-label={t("server.invites.inviter")}>{displayName(users[i.inviter_id])}</td>
                  <td data-label={t("server.invites.code")} className={s.code} dir="ltr">{i.code}</td>
                  <td data-label={t("server.invites.channel")}>{i.channel_id && channels[i.channel_id] ? <bdi>#{channels[i.channel_id]!.name}</bdi> : "—"}</td>
                  <td data-label={t("server.invites.uses")}>{i.uses}{i.max_uses ? ` / ${i.max_uses}` : ""}</td>
                  <td data-label={t("server.invites.expires")}>{i.expires_at ? formatFull(i.expires_at) : t("server.invites.never")}</td>
                  <td className={s.inviteActions}>
                    {/* The link itself, carrying the server's key where this
                        device holds it, as the invite dialog makes it: the
                        table used to offer only a way to revoke. */}
                    <Button size="sm" variant="secondary" onClick={() => copyAndSay(inviteUrl(i.code, ring.latest(serverId)), t("server.invites.linkCopied"))} data-testid="invite-copy">{t("server.invites.copyLink")}</Button>
                    <Button size="sm" variant="ghost" loading={busy === i.code} onClick={() => void revoke(i.code)}>{t("server.invites.revoke")}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
