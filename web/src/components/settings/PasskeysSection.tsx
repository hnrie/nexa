import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Spinner } from "@/components/common/Spinner";
import { Field, TextInput } from "@/components/common/TextInput";
import { describeDevice } from "@/lib/deviceLabel";
import { describeError } from "@/lib/errors";
import { addPasskey, passkeyCancelled, passkeysApi, passkeysSupported, type PasskeyInfo } from "@/lib/passkeys";
import { formatDateDivider } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { useUI } from "@/stores/ui";
import s from "./Settings.module.css";

import { t } from "@/i18n";

/** Settings, Security: the passkeys that sign this account in and open its messages (lib/passkeys.ts). */
export function PasskeysSection() {
  const identity = useAuth((a) => a.identity);
  const toast = useUI((u) => u.toast);
  const openModal = useUI((u) => u.openModal);
  // undefined while asking, null when the answer did not come
  const [list, setList] = useState<PasskeyInfo[] | null | undefined>(undefined);
  const [dialog, setDialog] = useState<null | { kind: "add" } | { kind: "rename"; key: PasskeyInfo }>(null);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setList(undefined);
    passkeysApi.list().then(setList, () => setList(null));
  };
  useEffect(load, []);

  const close = () => {
    setDialog(null);
    setPassword("");
    setName("");
    setError(null);
  };

  const add = async () => {
    if (!password || !identity || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addPasskey(password, identity, name.trim() || describeDevice(navigator.userAgent).label);
      close();
      load();
      toast(t("passkeys.added"), "success");
    } catch (err) {
      if (!passkeyCancelled(err)) setError(describeError(err, t("passkeys.couldNotAdd")));
    } finally {
      setBusy(false);
    }
  };

  const rename = async (key: PasskeyInfo) => {
    if (busy) return;
    setBusy(true);
    try {
      await passkeysApi.rename(key.id, name.trim());
      close();
      load();
    } catch (err) {
      setError(describeError(err, t("modals.confirm.somethingWentWrong")));
    } finally {
      setBusy(false);
    }
  };

  const remove = (key: PasskeyInfo) =>
    openModal("confirm", {
      title: t("passkeys.removeTitle", { name: key.name || t("passkeys.passkey") }),
      body: t("passkeys.removeBody"),
      confirmLabel: t("passkeys.remove"),
      danger: true,
      onConfirm: async () => {
        await passkeysApi.remove(key.id);
        load();
      },
    });

  const supported = passkeysSupported();

  return (
    <>
      <h3 data-setting="passkeys" className={s.h5} style={{ marginTop: 28 }}><KeyRound size={16} /> {t("passkeys.title")}</h3>
      <p className={s.hint}>{t("passkeys.hint")}</p>
      {list === undefined ? (
        <div className={s.device}><Spinner size={24} label={t("settings.security.oneMoment")} /></div>
      ) : list === null ? (
        <div className={s.device}>
          <div className={s.deviceSub}>{t("settings.security.weCouldNotAskTheServer")}</div>
          <Button size="sm" variant="secondary" onClick={load}>{t("chat.messageList.tryAgain")}</Button>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {list.map((k) => (
            <div key={k.id} className={s.device} data-testid="passkey-row">
              <div style={{ minWidth: 0 }}>
                <div className={s.deviceName}>{k.name || t("passkeys.passkey")}</div>
                <div className={s.deviceSub}>
                  {k.last_used_at ? t("passkeys.addedAndUsed", { added: formatDateDivider(k.created_at), used: formatDateDivider(k.last_used_at) }) : t("passkeys.addedOn", { added: formatDateDivider(k.created_at) })}
                </div>
                {k.rp_id !== location.hostname ? <div className={s.deviceSub}>{t("passkeys.worksAt", { site: k.rp_id })}</div> : null}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button size="sm" variant="secondary" onClick={() => { setName(k.name); setDialog({ kind: "rename", key: k }); }}>{t("passkeys.rename")}</Button>
                <Button size="sm" variant="danger" onClick={() => remove(k)}>{t("passkeys.remove")}</Button>
              </div>
            </div>
          ))}
          <div className={s.device}>
            <div className={s.deviceSub}>{supported ? (list.length ? t("passkeys.addAnother") : t("passkeys.none")) : t("passkeys.unsupported")}</div>
            {supported ? <Button size="sm" onClick={() => setDialog({ kind: "add" })} data-testid="passkey-add">{t("passkeys.add")}</Button> : null}
          </div>
        </div>
      )}

      {dialog?.kind === "add" ? (
        <Modal title={t("passkeys.add")} open onClose={close} onSubmit={() => void add()} width={440}>
          <div className={s.form}>
            {error ? <div className={s.dangerBox}>{error}</div> : null}
            <p className={s.hint}>{t("passkeys.addHint")}</p>
            <Field label={t("chat.lockedChannel.password")} required>
              <TextInput type="password" reveal value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus data-testid="passkey-password" />
            </Field>
            <Field label={t("passkeys.name")}>
              <TextInput value={name} onChange={(e) => setName(e.target.value.slice(0, 64))} placeholder={describeDevice(navigator.userAgent).label} />
            </Field>
            <Button block loading={busy} disabled={!password} onClick={() => void add()} data-testid="passkey-continue">{t("settings.security.continue")}</Button>
          </div>
        </Modal>
      ) : null}

      {dialog?.kind === "rename" ? (
        <Modal title={t("passkeys.rename")} open onClose={close} onSubmit={() => void rename(dialog.key)} width={420}>
          <div className={s.form}>
            {error ? <div className={s.dangerBox}>{error}</div> : null}
            <Field label={t("passkeys.name")}>
              <TextInput value={name} onChange={(e) => setName(e.target.value.slice(0, 64))} autoFocus />
            </Field>
            <Button block loading={busy} onClick={() => void rename(dialog.key)}>{t("passkeys.save")}</Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
