import { Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import { Button } from "@/components/common/Button";
import { Field, TextInput } from "@/components/common/TextInput";
import { useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import st from "@/components/settings/Settings.module.css";
import s from "../ServerSettings.module.css";

/** Irons out what phone keyboards change on their own: stray spaces and curly quotes. */
function norm(x: string): string {
  return x.trim().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

export default function DeleteServerPage({ serverId, onDone }: { serverId: string; onDone: () => void }) {
  const server = useServers((x) => x.byId[serverId]?.server);
  const remove = useServers((x) => x.remove);
  const toast = useUI((u) => u.toast);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  if (!server) return null;
  const go = async () => {
    setBusy(true);
    try {
      await serversApi.delete(serverId);
      remove(serverId);
      onDone();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not delete the server.", "error");
      setBusy(false);
    }
  };
  return (
    <>
      <h2 className={st.title}>Delete Server</h2>
      <div className={s.danger}>
        <p className={st.hint} style={{ margin: 0 }}>Are you sure you want to delete <b>{server.name}</b>? Every channel, message and role in it is gone for everyone, permanently. There is no undo.</p>
        <Field label={`Type "${server.name}" to confirm`}>
          <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={server.name} autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} data-testid="delete-server-confirm" />
        </Field>
        <div>
          <Button variant="danger" disabled={norm(typed) !== norm(server.name)} loading={busy} onClick={() => void go()} data-testid="delete-server"><Trash2 size={16} /> Delete Server</Button>
        </div>
      </div>
    </>
  );
}
