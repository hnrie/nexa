import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/TextInput";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import s from "./ServerModals.module.css";
import { guarded } from "@/lib/captcha";

export function CreateServerModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const me = useAuth((a) => a.me);
  const toast = useUI((u) => u.toast);
  const [mode, setMode] = useState<"create" | "join">("create");
  const [name, setName] = useState(() => (me ? `${me.display_name || me.username}'s server` : "My server"));
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      const view = await guarded("create_server", (captcha) => serversApi.create(clean, captcha));
      useChannels.getState().upsert(view.channels);
      useServers.getState().setFromView(view);
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
    const m = /(?:invite\/)?([A-Za-z0-9_-]{4,32})(?:[#?].*)?$/.exec(code.trim());
    if (!m) return toast("That doesn't look like an invite link or code.", "error");
    const hash = code.includes("#") ? code.slice(code.indexOf("#")) : "";
    onClose();
    nav(`/invite/${m[1]}${hash}`);
  };

  if (mode === "join") {
    return (
      <Modal open onClose={onClose} title="Join a Server" width={440} footer={<><Button variant="ghost" onClick={() => setMode("create")}>Back</Button><Button onClick={join} disabled={!code.trim()}>Join Server</Button></>}>
        <div className={s.form}>
          <p className={s.hint}>Enter an invite below to join an existing server.</p>
          <Field label="Invite link" required>
            <TextInput value={code} onChange={(e) => setCode(e.target.value)} placeholder={`${window.location.origin}/invite/hTKzmak`} autoFocus onKeyDown={(e) => e.key === "Enter" && join()} />
          </Field>
          <p className={s.fine}>Invites look like {window.location.origin}/invite/hTKzmak or just the code.</p>
        </div>
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title="Create Your Server" width={440} footer={<><Button variant="ghost" onClick={() => setMode("join")}>Have an invite already?</Button><Button onClick={() => void create()} loading={busy} disabled={!name.trim()}>Create</Button></>}>
      <div className={s.form}>
        <p className={s.hint}>Your server is where you and your friends hang out. Make yours and start talking. Everything in it is end-to-end encrypted.</p>
        <Field label="Server name" required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus onKeyDown={(e) => e.key === "Enter" && void create()} data-testid="server-name" />
        </Field>
        <p className={s.fine}>By creating a server, you agree to keep it a decent place.</p>
      </div>
    </Modal>
  );
}
