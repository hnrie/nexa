import { KeyRound, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import type { ServerKeyInfo } from "@/api/types";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { formatFull } from "@/lib/time";
import { ring } from "@/lib/keyring";
import { useKeys } from "@/stores/keys";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import st from "@/components/settings/Settings.module.css";
import s from "../ServerSettings.module.css";

export default function EncryptionPage({ serverId }: { serverId: string }) {
  const users = useUsers((u) => u.byId);
  const toast = useUI((u) => u.toast);
  const rotate = useKeys((k) => k.rotate);
  const reconcile = useKeys((k) => k.reconcile);
  const [info, setInfo] = useState<ServerKeyInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    serversApi
      .keys(serverId)
      .then(setInfo)
      .catch(() => setInfo([]));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  const doRotate = async (conv: string) => {
    setBusy(conv);
    try {
      await rotate(conv, "manual");
      toast("A new key was created and shared with everyone entitled to it.", "success");
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not rotate the key.", "error");
    } finally {
      setBusy(null);
    }
  };
  const doReconcile = async () => {
    setBusy("reconcile");
    try {
      await reconcile();
      toast("Checked everyone's keys.", "success");
    } finally {
      setBusy(null);
    }
  };

  const needsRotation = info?.some((c) => c.flags?.needs_rotation) ?? false;
  return (
    <>
      <h2 className={st.title}>Encryption</h2>
      <p className={st.hint}>Every message here is end-to-end encrypted. The server root key encrypts ordinary channels; private channels have keys of their own. Keys are only ever wrapped to members' devices; the server stores ciphertext and can't read any of it.</p>
      <div style={{ height: 16 }} />
      {needsRotation ? (
        <div className={s.warn}>
          <TriangleAlert size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
          Someone left or was removed and the keys they held have not been rotated yet. Rotating happens automatically when a key holder is online; you can also do it now.
        </div>
      ) : null}
      {info === null ? <Spinner /> : null}
      {info?.map((c) => {
        const latest = c.epochs.length ? c.epochs[c.epochs.length - 1]! : null;
        const held = ring.latest(c.conv_id);
        const holdLatest = !!held && !!latest && held.epoch === latest.epoch;
        return (
          <div key={c.conv_id} className={s.keyCard} data-conv={c.conv_id}>
            <KeyRound size={22} style={{ color: c.flags?.needs_rotation ? "var(--warning)" : "var(--positive)" }} />
            <div className={s.keyText}>
              <span className={s.keyName}>{c.name}</span>
              <span className={s.keySub}>
                {latest ? `Key epoch ${latest.epoch} · created ${formatFull(latest.created_at)} by ${displayName(users[latest.created_by])}${latest.reason ? ` (${latest.reason})` : ""}` : "No key yet: one is created with the first message."}
                {" · "}
                {holdLatest ? "You hold the current key." : held ? "You hold an older key; waiting for the current one." : "You don't hold this key yet."}
              </span>
            </div>
            <Button size="sm" variant="secondary" disabled={!holdLatest || busy === c.conv_id} loading={busy === c.conv_id} onClick={() => void doRotate(c.conv_id)} title={holdLatest ? "Create a fresh key and share it with everyone entitled" : "Only holders of the current key can rotate it"}>
              <RefreshCw size={14} /> Rotate
            </Button>
          </div>
        );
      })}
      <div className={st.sep} />
      <div className={s.keyCard}>
        <ShieldCheck size={22} style={{ color: "var(--positive)" }} />
        <div className={s.keyText}>
          <span className={s.keyName}>Share missing keys</span>
          <span className={s.keySub}>Members who joined while nobody with the key was online receive it as soon as a holder connects. Run a check now.</span>
        </div>
        <Button size="sm" variant="secondary" loading={busy === "reconcile"} onClick={() => void doReconcile()}>Check now</Button>
      </div>
    </>
  );
}
