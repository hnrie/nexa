import { useMediaAnimation } from "@/lib/mediaAnimation";
import { useState } from "react";
import { servers as serversApi } from "@/api/servers";
import { iconUrl } from "@/api/users";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { ServerTagChip, forgetTagPreview } from "@/components/servertag/ServerTagChip";
import { t } from "@/i18n";
import { initials } from "@/lib/avatarColor";
import { describeError } from "@/lib/errors";
import { canWearTag } from "@/lib/serverTags";
import { useAuth } from "@/stores/auth";
import { useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import s from "./ServerTagChooser.module.css";

/** Puts a server's tag on the account, or takes it off (null), saying how it went. */
export async function wearServerTag(serverId: string | null, text?: string): Promise<boolean> {
  const { toast } = useUI.getState();
  try {
    useAuth.getState().setMe(await serversApi.wearTag(serverId));
    if (serverId) forgetTagPreview(serverId);
    toast(serverId ? t("serverTag.nowWearing", { tag: text ?? "" }) : t("serverTag.tookOff"), "success");
    return true;
  } catch (err) {
    toast(describeError(err, t("serverTag.couldNotChange")), "error");
    return false;
  }
}

/**
 * Settings, Profiles: the server tag worn next to your name, and the way to
 * choose another from the servers you are in.
 */
export function ServerTagChooser() {
  const me = useAuth((a) => a.me);
  const servers = useServers((x) => x.byId);
  const order = useServers((x) => x.order);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  if (!me) return null;
  const worn = me.server_tag ?? null;
  const from = worn ? servers[worn.server_id] : undefined;
  const tagged = order.map((id) => servers[id]).filter((st): st is NonNullable<typeof st> => !!st?.server.tag);

  const wear = async (id: string | null, text?: string) => {
    setBusy(id ?? "off");
    const ok = await wearServerTag(id, text);
    setBusy(null);
    if (ok && id) setOpen(false);
  };

  return (
    <div>
      <div data-setting="serverTag" className={s.head}>{t("serverTag.choose.title")}</div>
      <p className={s.hint}>{t("serverTag.choose.hint")}</p>
      <div className={s.card} data-testid="worn-tag">
        {worn ? (
          <>
            <ServerTagChip tag={worn} size="lg" open={false} />
            <span className={s.from} dir="auto">{from ? from.server.name : t("serverTag.choose.aServer")}</span>
            <span className={s.btns}>
              <Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={tagged.length === 0}>{t("settings.security.change")}</Button>
              <Button size="sm" variant="ghost" loading={busy === "off"} onClick={() => void wear(null)} data-testid="tag-take-off">{t("serverTag.takeOff")}</Button>
            </span>
          </>
        ) : (
          <>
            <span className={s.none}>{tagged.length ? t("serverTag.choose.none") : t("serverTag.choose.noneToWear")}</span>
            {tagged.length ? (
              <span className={s.btns}>
                <Button size="sm" onClick={() => setOpen(true)} data-testid="tag-choose">{t("serverTag.choose.button")}</Button>
              </span>
            ) : null}
          </>
        )}
      </div>
      {open ? (
        <Modal open onClose={() => setOpen(false)} title={t("serverTag.choose.dialogTitle")} width={480}>
          <ServerTagList onWorn={() => setOpen(false)} />
        </Modal>
      ) : null}
    </div>
  );
}

/**
 * The servers with a tag the account could wear, each with its tag and the
 * way to put it on (or the word that it is on already), for the chooser
 * dialog and the profile designer.
 */
export function ServerTagList({ onWorn }: { onWorn?: () => void }) {
  useMediaAnimation();
  const me = useAuth((a) => a.me);
  const servers = useServers((x) => x.byId);
  const order = useServers((x) => x.order);
  const [busy, setBusy] = useState<string | null>(null);
  const worn = me?.server_tag ?? null;
  const tagged = order.map((id) => servers[id]).filter((st): st is NonNullable<typeof st> => !!st?.server.tag);
  const wear = async (id: string, text: string) => {
    setBusy(id);
    const ok = await wearServerTag(id, text);
    setBusy(null);
    if (ok) onWorn?.();
  };
  if (!tagged.length) return <p className={s.none}>{t("serverTag.choose.noneToWear")}</p>;
  return (
    <ul className={s.list}>
      {tagged.map((st) => {
        const tag = st.server.tag!;
        const can = canWearTag(st);
        const wearing = worn?.server_id === st.server.id;
        const icon = iconUrl(st.server.icon_id, 40);
        return (
          <li key={st.server.id} className={s.row} data-testid={`tag-row-${st.server.id}`}>
            {icon ? <img className={s.icon} src={icon} alt="" draggable={false} /> : <span className={s.icon} data-initials>{initials(st.server.name)}</span>}
            <span className={s.rowText}>
              <span className={s.rowName} dir="auto">{st.server.name}</span>
              {!can ? <span className={s.rowNote}>{t("serverTag.keptToRoles")}</span> : null}
            </span>
            <ServerTagChip tag={tag} open={false} />
            {wearing ? (
              <span className={s.wearing}>{t("serverTag.choose.wearing")}</span>
            ) : (
              <Button size="sm" variant="secondary" disabled={!can} loading={busy === st.server.id} onClick={() => void wear(st.server.id, tag.text)}>{t("serverTag.wear")}</Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
