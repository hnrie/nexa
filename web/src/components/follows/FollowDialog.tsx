import { Info, Megaphone } from "lucide-react";
import { useMemo, useState } from "react";
import { ApiError } from "@/api/client";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Select } from "@/components/common/Select";
import { Field } from "@/components/common/TextInput";
import { t } from "@/i18n";
import { followInto } from "@/lib/follows";
import { P } from "@/lib/perms";
import { useChannels } from "@/stores/channels";
import { canI, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import s from "@/components/modals/ServerModals.module.css";

/**
 * Following an announcement channel: what it publishes from now on lands in
 * a text channel of a server this account manages webhooks in. Each post
 * arrives sealed for that channel, so only its people can read it.
 */
export function FollowDialog({ onClose, channelId }: { onClose: () => void; channelId: string }) {
  const source = useChannels((c) => c.byId[channelId]);
  const channels = useChannels((c) => c.byId);
  const servers = useServers((x) => x.byId);
  const order = useServers((x) => x.order);
  const toast = useUI((u) => u.toast);
  // where posts can go: text channels this account may manage webhooks in
  const targets = useMemo(() => {
    const out: { serverId: string; serverName: string; channels: typeof source[] }[] = [];
    for (const id of order) {
      const st = servers[id];
      if (!st) continue;
      const list = Object.values(channels)
        .filter((c) => c.server_id === id && c.type === "text" && c.id !== channelId && canI(st, P.MANAGE_WEBHOOKS, c.id))
        .sort((a, b) => a.position - b.position);
      if (list.length) out.push({ serverId: id, serverName: st.server.name, channels: list });
    }
    return out;
  }, [order, servers, channels, channelId]);
  const [serverId, setServerId] = useState(() => targets[0]?.serverId ?? "");
  const choices = targets.find((x) => x.serverId === serverId)?.channels ?? [];
  const [targetId, setTargetId] = useState(() => targets[0]?.channels[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const target = channels[targetId];

  const follow = async () => {
    if (!source || !target || busy) return;
    setBusy(true);
    try {
      await followInto(source, target);
      toast(t("follows.dialog.done", { source: source.name, target: target.name }), "success");
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("follows.dialog.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t("follows.dialog.title", { name: source?.name ?? "" })}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("chat.editMessage.cancel")}</Button>
          <Button onClick={() => void follow()} loading={busy} disabled={!target} data-testid="follow-confirm">{t("follows.dialog.follow")}</Button>
        </>
      }
    >
      <div className={s.form}>
        <div className={s.keyNote}>
          <Megaphone size={16} />
          <span>{t("follows.dialog.what")}</span>
        </div>
        {targets.length === 0 ? (
          <p className={s.hint}>{t("follows.dialog.nowhere")}</p>
        ) : (
          <>
            <Field label={t("follows.dialog.server")}>
              <Select
                value={serverId}
                onChange={(e) => {
                  setServerId(e.target.value);
                  setTargetId(targets.find((x) => x.serverId === e.target.value)?.channels[0]?.id ?? "");
                }}
              >
                {targets.map((x) => (
                  <option key={x.serverId} value={x.serverId}>{x.serverName}</option>
                ))}
              </Select>
            </Field>
            <Field label={t("follows.dialog.channel")}>
              <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} data-testid="follow-channel">
                {choices.map((c) => (
                  <option key={c!.id} value={c!.id}>#{c!.name}</option>
                ))}
              </Select>
            </Field>
            <p className={s.fine} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Info size={13} aria-hidden="true" style={{ flex: "none" }} />
              {t("follows.dialog.listedHint")}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
