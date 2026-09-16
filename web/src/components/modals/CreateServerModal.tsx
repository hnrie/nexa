import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import { Button } from "@/components/common/Button";
import { IconPicker } from "@/components/common/IconPicker";
import { initials } from "@/lib/avatarColor";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/TextInput";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import s from "./ServerModals.module.css";
import { guarded } from "@/lib/captcha";

import { t } from "@/i18n";
export function CreateServerModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const me = useAuth((a) => a.me);
  const toast = useUI((u) => u.toast);
  const [mode, setMode] = useState<"create" | "join">("create");
  const [name, setName] = useState(() => (me ? `${me.display_name || me.username}'s server` : "My server"));
  const [code, setCode] = useState("");
  const [icon, setIcon] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      const view = await guarded("create_server", (captcha) => serversApi.create(clean, captcha));
      useChannels.getState().upsert(view.channels);
      useServers.getState().setFromView(view);
      // the icon goes up once the server exists; a failure there still leaves the server made
      if (icon) {
        try {
          useServers.getState().updateServer(await serversApi.uploadIcon(view.id, icon));
        } catch (err) {
          toast(err instanceof ApiError ? `The server was made, but its icon did not upload: ${err.message}` : "The server was made, but its icon did not upload.", "error");
        }
      }
      onClose();
      const general = view.channels.find((c) => c.type === "text");
      nav(general ? `/channels/${view.id}/${general.id}` : `/channels/${view.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not create the server.", "error");
    } finally {
      setBusy(false);
    }
  };

  const join = () => {
    // a pasted link often ends in a space, which would cut the key off the end of the hash
    const c = code.trim();
    const m = /(?:invite\/)?([A-Za-z0-9_-]{4,32})(?:[#?].*)?$/.exec(c);
    if (!m) return toast("That doesn't look like an invite link or code.", "error");
    const hash = c.includes("#") ? c.slice(c.indexOf("#")) : "";
    onClose();
    nav(`/invite/${m[1]}${hash}`);
  };

  if (mode === "join") {
    return (
      <Modal open onClose={onClose} title={t("modals.createServer.joinAServer")} width={440} footer={<><Button variant="ghost" onClick={() => setMode("create")}>{t("modals.createServer.back")}</Button><Button onClick={join} disabled={!code.trim()}>{t("modals.createServer.joinServer")}</Button></>}>
        <div className={s.form}>
          <p className={s.hint}>{t("modals.createServer.enterAnInviteBelowToJoin")}</p>
          <Field label={t("modals.createServer.inviteLink")} required>
            <TextInput value={code} onChange={(e) => setCode(e.target.value)} placeholder={`${window.location.origin}/invite/hTKzmak`} autoFocus onKeyDown={(e) => e.key === "Enter" && join()} />
          </Field>
          <p className={s.fine}>Invites look like {window.location.origin}/invite/hTKzmak or just the code.</p>
        </div>
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title={t("modals.createServer.createYourServer")} width={440} footer={<><Button variant="ghost" onClick={() => setMode("join")}>{t("modals.createServer.haveAnInviteAlready")}</Button><Button onClick={() => void create()} loading={busy} disabled={!name.trim()}>{t("modals.createServer.create")}</Button></>}>
      <div className={s.form}>
        <p className={s.hint}>{t("modals.createServer.yourServerIsWhereYouAnd")}</p>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <IconPicker currentUrl={null} picked={icon} onPick={setIcon} onRemove={() => setIcon(null)} initials={initials(name || "S")} label={t("modals.createServer.serverIcon")} testId="server-icon" />
        </div>
        <Field label={t("modals.createServer.serverName")} required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus onKeyDown={(e) => e.key === "Enter" && void create()} data-testid="server-name" />
        </Field>
        <p className={s.fine}>{t("modals.createServer.byCreatingAServerYouAgree")}</p>
      </div>
    </Modal>
  );
}
