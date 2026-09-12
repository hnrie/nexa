import { useEffect, useState } from "react";
import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import type { Invite } from "@/api/types";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { dispatchHooks } from "@/gateway/dispatch";
import type { GatewayEvent } from "@/gateway/events";
import { formatFull } from "@/lib/time";
import { useChannels } from "@/stores/channels";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import st from "@/components/settings/Settings.module.css";
import s from "../ServerSettings.module.css";

export default function InvitesPage({ serverId }: { serverId: string }) {
  const users = useUsers((u) => u.byId);
  const channels = useChannels((c) => c.byId);
  const toast = useUI((u) => u.toast);
  const openModal = useUI((u) => u.openModal);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      serversApi
        .invites(serverId)
        .then((list) => alive && setInvites(list))
        .catch(() => alive && setInvites([]));
    void load();
    const hook = (e: GatewayEvent) => {
      if ((e.t === "invite_create" || e.t === "invite_delete") && (e.d as { server_id?: string }).server_id === serverId) void load();
    };
    dispatchHooks.onUnhandled.push(hook);
    return () => {
      alive = false;
      dispatchHooks.onUnhandled.splice(dispatchHooks.onUnhandled.indexOf(hook), 1);
    };
  }, [serverId]);

  const revoke = async (code: string) => {
    setBusy(code);
    try {
      await serversApi.deleteInvite(code);
      setInvites((cur) => cur?.filter((i) => i.code !== code) ?? null);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not revoke the invite.", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h2 className={st.title}>Invites</h2>
      <p className={st.hint}>Active invite links for this server. Revoking a link does not remove anyone who already joined.</p>
      <div style={{ margin: "16px 0" }}>
        <Button size="sm" onClick={() => openModal("invite", { serverId })}>Create Invite</Button>
      </div>
      {invites === null ? <Spinner /> : null}
      {invites && invites.length === 0 ? <p className={st.hint}>There are no active invites.</p> : null}
      {invites && invites.length > 0 ? (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr><th>Inviter</th><th>Code</th><th>Channel</th><th>Uses</th><th>Expires</th><th /></tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.code}>
                  <td>{displayName(users[i.inviter_id])}</td>
                  <td className={s.code}>{i.code}</td>
                  <td>{i.channel_id && channels[i.channel_id] ? `#${channels[i.channel_id]!.name}` : "—"}</td>
                  <td>{i.uses}{i.max_uses ? ` / ${i.max_uses}` : ""}</td>
                  <td>{i.expires_at ? formatFull(i.expires_at) : "Never"}</td>
                  <td><Button size="sm" variant="ghost" loading={busy === i.code} onClick={() => void revoke(i.code)}>Revoke</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
