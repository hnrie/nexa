import { Hash, Lock, Volume2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import type { Channel } from "@/api/types";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/TextInput";
import { Toggle } from "@/components/common/Toggle";
import { P, permString } from "@/lib/perms";
import { useChannels } from "@/stores/channels";
import { useKeys } from "@/stores/keys";
import { useUI } from "@/stores/ui";
import s from "./ServerModals.module.css";

import { t } from "@/i18n";
function slug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export function CreateChannelModal({ onClose, serverId, parentId }: { onClose: () => void; serverId: string; parentId?: string | undefined }) {
  const nav = useNavigate();
  const parent = useChannels((c) => (parentId ? c.byId[parentId] : undefined));
  const upsert = useChannels((c) => c.upsert);
  const toast = useUI((u) => u.toast);
  const [type, setType] = useState<"text" | "voice">("text");
  const [name, setName] = useState("");
  const [priv, setPriv] = useState(false);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const clean = type === "text" ? slug(name) : name.trim();
    if (!clean || busy) return;
    setBusy(true);
    let made: Channel | null = null;
    try {
      const body: { type: "text" | "voice"; name: string; parent_id?: string | null } = { type, name: clean };
      if (parentId) body.parent_id = parentId;
      const ch = await serversApi.createChannel(serverId, body);
      made = ch;
      upsert(ch);
      if (priv) {
        // deny @everyone view, then give the channel its own key so members outside it never hold one
        const res = await serversApi.putOverwrite(ch.id, serverId, { type: "role", allow: "0", deny: permString(P.VIEW_CHANNEL) });
        upsert(await serversApi.channels(serverId));
        if (res.key_actions?.needs_own_key) await useKeys.getState().ensureConvKey(ch.id);
        upsert(await serversApi.channels(serverId));
      }
      onClose();
      nav(`/channels/${serverId}/${ch.id}`);
    } catch (err) {
      if (made && priv) {
        // It exists but may still be open to everyone or lack its own key. Take it back down, so
        // nothing gets posted in a channel everyone can read and trying again does not make a second one.
        const ch = made;
        const gone = await serversApi.deleteChannel(ch.id).then(() => true, () => false);
        if (gone) {
          useChannels.getState().remove(ch.id);
        } else {
          onClose();
          nav(`/channels/${serverId}/${ch.id}`);
          toast(t("modals.createChannel.theChannelWasCreatedButMay"), "error");
          return;
        }
      }
      toast(err instanceof ApiError ? err.message : t("modals.createChannel.couldNotCreateTheChannel"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t("modals.createChannel.createChannel")} width={460} footer={<><Button variant="ghost" onClick={onClose}>{t("chat.editMessage.cancel")}</Button><Button onClick={() => void create()} loading={busy} disabled={!name.trim()}>{t("modals.createChannel.createChannel")}</Button></>}>
      <div className={s.form}>
        {parent ? <p className={s.hint}>{t("modals.createChannel.inCategory", { name: parent.name })}</p> : null}
        {/* `as="div"`: the doc comment on Field says it in as many words — a
            label wrapping a group of radios passes a stray tap on its caption,
            or on any gap between the options, to the first radio. */}
        <Field as="div" label={t("modals.createChannel.channelType")}>
          <div className={s.types} role="radiogroup" aria-label={t("modals.createChannel.channelType")}>
            <label className={s.type} data-on={type === "text"}>
              <span className={s.typeIcon}><Hash size={22} /></span>
              <span className={s.typeText}><span className={s.typeLabel}>{t("modals.createChannel.text")}</span><span className={s.typeDesc}>{t("modals.createChannel.sendMessagesImagesGifsEmojiOpinions")}</span></span>
              <input type="radio" name="type" checked={type === "text"} onChange={() => setType("text")} />
            </label>
            <label className={s.type} data-on={type === "voice"}>
              <span className={s.typeIcon}><Volume2 size={22} /></span>
              <span className={s.typeText}><span className={s.typeLabel}>{t("modals.createChannel.voice")}</span><span className={s.typeDesc}>{t("modals.createChannel.hangOutTogetherWithVoiceVideo")}</span></span>
              <input type="radio" name="type" checked={type === "voice"} onChange={() => setType("voice")} />
            </label>
          </div>
        </Field>
        <Field label={t("modals.createChannel.channelName")} required>
          <div className={s.hashInput}>
            {type === "text" ? <Hash size={16} /> : <Volume2 size={16} />}
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="new-channel" maxLength={100} autoFocus onKeyDown={(e) => e.key === "Enter" && void create()} data-testid="channel-name" />
          </div>
        </Field>
        <Toggle checked={priv} onChange={setPriv} label={t("modals.createChannel.privateChannel")} description={t("modals.createChannel.onlySelectedMembersAndRolesWill")} />
        {priv ? <p className={s.fine}><Lock size={12} /> {t("modals.createChannel.addRolesOrMembersFromThe")}</p> : null}
      </div>
    </Modal>
  );
}
