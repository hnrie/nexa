import { Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { menuAnchor } from "@/components/common/ContextMenu";
import { useServers } from "@/stores/servers";
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

  const server = useServers((x) => x.byId[serverId]?.server);
  const pausedUntil = server?.invites_paused_until ?? null;
  const paused = !!pausedUntil && pausedUntil > Date.now();
  const forever = paused && pausedUntil! > Date.now() + 365 * 24 * 3600 * 1000;
  const [pausing, setPausing] = useState(false);

  const setPause = async (until: number | null) => {
    setPausing(true);
    try {
      const srv = await serversApi.patch(serverId, { invites_paused_until: until });
      useServers.getState().updateServer(srv);
      toast(until ? t("server.invites.pausedToast") : t("server.invites.resumedToast"), "success");
    } catch (err) {
      toast(describeError(err, t("server.invites.pauseFailed")), "error");
    } finally {
      setPausing(false);
    }
  };
  const pauseMenu = (el: HTMLElement) => {
    const anchor = menuAnchor(el, "start");
    const spans = [
      ["1h", 1],
      ["6h", 6],
      ["12h", 12],
      ["1d", 24],
      ["1w", 24 * 7],
    ] as const;
    useUI.getState().openContextMenu({
      x: anchor.left,
      y: anchor.bottom + 4,
      anchor,
      label: t("server.invites.pauseFor"),
      items: [
        ...spans.map(([id, h]) => ({ id, label: t(`server.invites.pause${id}`), onSelect: () => void setPause(Date.now() + h * 3600 * 1000) })),
        { id: "forever", label: t("server.invites.pauseForever"), onSelect: () => void setPause(32503600000000) },
      ],
    });
  };
  const revokeAll = () => {
    openModal("confirm", {
      title: t("server.invites.revokeAllTitle"),
      body: t("server.invites.revokeAllBody", { count: invites?.length ?? 0 }),
      confirmLabel: t("server.invites.revokeAll"),
      danger: true,
      onConfirm: async () => {
        try {
          const res = await serversApi.revokeAllInvites(serverId);
          setInvites([]);
          toast(t("server.invites.revokedAll", { count: res.revoked }), "success");
        } catch (err) {
          toast(describeError(err, t("server.invites.couldNotRevokeTheInvite")), "error");
        }
      },
    });
  };

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
      <section className={s.joinPanel} data-paused={paused || undefined} aria-label={t("server.invites.whoCanJoin")}>
        <div className={s.joinText}>
          <span className={s.joinHead}>{paused ? t("server.invites.pausedHead") : t("server.invites.openHead")}</span>
          <span className={s.joinDesc}>
            {paused ? (forever ? t("server.invites.pausedForever") : t("server.invites.pausedUntil", { time: formatFull(pausedUntil!) })) : t("server.invites.openDesc")}
          </span>
        </div>
        <div className={s.joinBtns}>
          {paused ? (
            <Button size="sm" variant="positive" loading={pausing} onClick={() => void setPause(null)} data-testid="invites-resume">
              <Play size={14} aria-hidden="true" /> {t("server.invites.resume")}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" loading={pausing} onClick={(e) => pauseMenu(e.currentTarget)} data-testid="invites-pause">
              <Pause size={14} aria-hidden="true" /> {t("server.invites.pause")}
            </Button>
          )}
        </div>
      </section>
      <div className={s.inviteTools}>
        <Button size="sm" onClick={() => openModal("invite", { serverId })}>{t("server.invites.createInvite")}</Button>
        {invites && invites.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={revokeAll} data-testid="invites-revoke-all">{t("server.invites.revokeAll")}</Button>
        ) : null}
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
                  <td data-label={t("server.invites.channel")}>{i.channel_id && channels[i.channel_id] ? <bdi>#{channels[i.channel_id]!.name}</bdi> : t("settings.profile.none")}</td>
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
