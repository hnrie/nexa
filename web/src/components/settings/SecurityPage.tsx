import { Check, Copy, Download, Lock, ShieldCheck, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError } from "@/api/client";
import { auth as authApi } from "@/api/auth";
import type { MfaStatus, TotpSetup } from "@/api/types";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { QrCode } from "@/components/common/QrCode";
import { Select } from "@/components/common/Select";
import { Field, TextInput } from "@/components/common/TextInput";
import { Toggle } from "@/components/common/Toggle";
import { b64 } from "@/crypto/bytes";
import { deriveAuthKey, deriveMaster } from "@/crypto/kdf";
import { users as usersApi } from "@/api/users";
import { AUTO_LOCK_CHOICES, BLUR_DELAY_CHOICES, DEFAULT_LOCK, loadLock, passcodeProblem, patchLock, type LockConfig } from "@/lib/appLock";
import { useAuth } from "@/stores/auth";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import s from "./Settings.module.css";

import { t } from "@/i18n";
/** Turns the account password into the proof the server expects. */
async function authKeyFor(password: string): Promise<string> {
  const bundle = await usersApi.myKeys();
  const master = await deriveMaster(password, b64.dec(bundle.kdf_salt), { m: bundle.kdf_params.m, t: bundle.kdf_params.t, p: bundle.kdf_params.p, v: 1 });
  return b64.enc(deriveAuthKey(master));
}

type Dialog = null | "enable" | "disable" | "codes" | "passcode" | "removePasscode";

export default function SecurityPage() {
  const me = useAuth((a) => a.me);
  const setMe = useAuth((a) => a.setMe);
  const setPasscode = useAuth((a) => a.setPasscode);
  const removePasscode = useAuth((a) => a.removePasscode);
  const lockApp = useAuth((a) => a.lockApp);
  const toast = useUI((u) => u.toast);

  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [lock, setLock] = useState<LockConfig | null>(() => (me ? loadLock(me.id) : null));
  // The account's own policy: it may have been set on another device.
  const policy = useSettings((st) => st.settings.appLock);

  useEffect(() => {
    authApi.mfaStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  if (!me) return null;

  const close = () => {
    setDialog(null);
    setPassword("");
    setCode("");
    setPin("");
    setPin2("");
    setSetup(null);
    setCodes(null);
    setError(null);
    setCopied(false);
    setShowSecret(false);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    const [st, fresh] = await Promise.all([authApi.mfaStatus(), usersApi.me()]);
    setStatus(st);
    setMe(fresh);
  };

  const beginSetup = () =>
    run(async () => {
      setSetup(await authApi.totpSetup(await authKeyFor(password)));
      setPassword("");
    });

  const finishSetup = () =>
    run(async () => {
      if (!setup) return;
      const res = await authApi.totpEnable(setup.ticket, code.replace(/\s/g, ""));
      setCodes(res.backup_codes);
      setSetup(null);
      setCode("");
      await refresh();
      toast("Two-factor authentication is on.", "success");
    });

  const disable = () =>
    run(async () => {
      await authApi.mfaDisable(await authKeyFor(password));
      await refresh();
      close();
      toast("Two-factor authentication is off.", "success");
    });

  const regenerate = () =>
    run(async () => {
      const res = await authApi.newBackupCodes(await authKeyFor(password));
      setCodes(res.backup_codes);
      setPassword("");
      await refresh();
    });

  const savePasscode = () =>
    run(async () => {
      const problem = passcodeProblem(pin);
      if (problem) throw new Error(problem);
      if (pin !== pin2) throw new Error("Those two passcodes are different.");
      await setPasscode(pin, lock ?? DEFAULT_LOCK);
      setLock(loadLock(me.id));
      close();
      toast("This device now asks for your passcode.", "success");
    });

  const dropPasscode = () =>
    run(async () => {
      await removePasscode();
      setLock(null);
      close();
      toast("Passcode removed.", "success");
    });

  const patch = (p: Partial<Pick<LockConfig, "autoLockMs" | "lockOnBlur" | "blurDelayMs">>) => {
    const next = patchLock(me.id, p);
    if (next) setLock(next);
    useAuth.getState().bumpLock();
    // keep the account's copy in step, so another device locks the same way
    if (policy) useSettings.getState().patch({ appLock: { ...policy, ...p } });
  };

  const copyCodes = async () => {
    if (!codes) return;
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Could not reach the clipboard. Select the codes and copy them.", "error");
    }
  };

  const downloadCodes = () => {
    if (!codes) return;
    const body = `nexa backup codes for @${me.username}\nEach code works once.\n\n${codes.join("\n")}\n`;
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `evilion-chat-backup-codes-${me.username}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const on = status?.enabled ?? false;
  const left = status?.backup_codes_left ?? 0;

  return (
    <>
      <h2 className={s.title}>{t("settings.security.security")}</h2>

      <h3 className={s.h}><ShieldCheck size={16} /> {t("settings.security.twoFactorAuthentication")}</h3>
      <p className={s.hint}>
        An authenticator app adds a six-digit code to every sign-in, so your password alone is not enough. Your messages stay end-to-end encrypted either way; this protects the account itself.
      </p>
      <div className={s.device} data-testid="mfa-row">
        <div>
          <div className={s.deviceName}>{on ? "Authenticator app is on" : "Authenticator app is off"}</div>
          <div className={s.deviceSub}>
            {on ? `${left} backup ${left === 1 ? "code" : "codes"} left${status?.enabled_at ? ` · on since ${new Date(status.enabled_at).toLocaleDateString()}` : ""}` : "Works with any TOTP app, such as Aegis, Ente Auth, 1Password or Google Authenticator."}
          </div>
        </div>
        {on ? (
          <div style={{ display: "flex", gap: 8 }}>
            <Button size="sm" variant="secondary" onClick={() => setDialog("codes")}>{t("settings.security.backupCodes")}</Button>
            <Button size="sm" variant="danger" onClick={() => setDialog("disable")} data-testid="mfa-disable">{t("settings.security.turnOff")}</Button>
          </div>
        ) : (
          <Button size="sm" onClick={() => setDialog("enable")} data-testid="mfa-enable">{t("settings.security.setUp")}</Button>
        )}
      </div>
      {on && left === 0 ? <div className={s.dangerBox} style={{ marginTop: 12 }}>{t("settings.security.youHaveNoBackupCodesLeft")}</div> : null}

      <h3 className={s.h} style={{ marginTop: 28 }}><Lock size={16} /> {t("settings.security.appLock")}</h3>
      <p className={s.hint}>
        A passcode for this device. While it is on, your keys are stored wrapped by the passcode, so closing the tab or locking the app really does put your messages out of reach until you type it again. Ten wrong tries wipe the wrapped copy, and your account password gets you back in.
      </p>
      <div className={s.device} data-testid="lock-row">
        <div>
          <div className={s.deviceName}>{policy ? "Passcode is on for this account" : "No passcode set"}</div>
          <div className={s.deviceSub}>{policy ? "Every device you sign in on asks for it, on each reload and whenever the app locks." : "The app opens straight into your messages."}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {policy ? <Button size="sm" variant="secondary" onClick={() => setDialog("passcode")}>{t("settings.security.change")}</Button> : null}
          {policy ? (
            <Button size="sm" variant="danger" onClick={() => setDialog("removePasscode")} data-testid="lock-remove">{t("composer.composer.remove")}</Button>
          ) : (
            <Button size="sm" onClick={() => setDialog("passcode")} data-testid="lock-set">{t("settings.security.setAPasscode")}</Button>
          )}
        </div>
      </div>

      {lock ? (
        <div className={s.rows} style={{ marginTop: 12 }}>
          <div className={s.row}>
            <div className={s.rowLabel}>
              Lock after inactivity
              <div className={s.deviceSub}>{t("settings.security.nothingTypedClickedOrScrolledFor")}</div>
            </div>
            <div className={s.rowValue}>
              <Select value={String(lock.autoLockMs)} onChange={(e) => patch({ autoLockMs: Number(e.target.value) })} aria-label={t("settings.security.lockAfterInactivity")} data-testid="lock-idle">
                {AUTO_LOCK_CHOICES.map((c) => <option key={c.ms} value={c.ms}>{c.label}</option>)}
              </Select>
            </div>
          </div>
          <div className={s.row}>
            <div className={s.rowLabel} style={{ flex: 1 }}>
              <Toggle checked={lock.lockOnBlur} onChange={(v) => patch({ lockOnBlur: v })} label={t("settings.security.lockWhenTheAppLosesFocus")} description={t("settings.security.switchingToAnotherWindowOrTab")} />
            </div>
          </div>
          {lock.lockOnBlur ? (
            <div className={s.row}>
              <div className={s.rowLabel}>{t("settings.security.lockOnceItIsInThe")}</div>
              <div className={s.rowValue}>
                <Select value={String(lock.blurDelayMs)} onChange={(e) => patch({ blurDelayMs: Number(e.target.value) })} aria-label={t("settings.security.lockOnceInTheBackground")}>
                  {BLUR_DELAY_CHOICES.map((c) => <option key={c.ms} value={c.ms}>{c.label}</option>)}
                </Select>
              </div>
            </div>
          ) : null}
          <div className={s.row}>
            <div className={s.rowLabel}>{t("settings.security.lockRightNow")}</div>
            <div className={s.rowValue}><Button size="sm" variant="secondary" onClick={lockApp} data-testid="lock-now">{t("settings.security.lock")}</Button></div>
          </div>
        </div>
      ) : null}

      {dialog === "enable" ? (
        <Modal title={codes ? "Save your backup codes" : setup ? "Scan this with your authenticator" : "Set up two-factor authentication"} open onClose={close} closeOnOverlay={!codes} width={460}>
          <div className={s.form}>
            {error ? <div className={s.dangerBox}>{error}</div> : null}
            {codes ? (
              <BackupCodes codes={codes} copied={copied} onCopy={() => void copyCodes()} onDownload={downloadCodes} onDone={close} />
            ) : !setup ? (
              <>
                <p className={s.hint}>{t("settings.security.confirmYourPasswordToStart")}</p>
                <Field label={t("chat.lockedChannel.password")} required>
                  <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
                </Field>
                <Button block loading={busy} disabled={!password} onClick={() => void beginSetup()}>{t("settings.security.continue")}</Button>
              </>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <QrCode text={setup.uri} size={188} label={t("settings.security.authenticatorSetupCode")} />
                </div>
                <button type="button" className={s.hint} style={{ textAlign: "center", textDecoration: "underline" }} onClick={() => setShowSecret((v) => !v)}>
                  {showSecret ? "Hide the key" : "Can't scan it?"}
                </button>
                {showSecret ? <div className={s.recovery} data-testid="totp-secret">{setup.formatted}</div> : null}
                <Field label={t("settings.security.enterTheSixDigitCodeIt")} required>
                  <TextInput
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, "").slice(0, 7))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    autoFocus
                    data-testid="totp-code"
                  />
                </Field>
                <Button block loading={busy} disabled={code.replace(/\s/g, "").length !== 6} onClick={() => void finishSetup()} data-testid="totp-confirm">{t("settings.security.turnOn")}</Button>
              </>
            )}
          </div>
        </Modal>
      ) : null}

      {dialog === "codes" ? (
        <Modal title={t("settings.security.backupCodes")} open onClose={close} closeOnOverlay={!codes} width={460}>
          <div className={s.form}>
            {error ? <div className={s.dangerBox}>{error}</div> : null}
            {!codes ? (
              <>
                <p className={s.hint}>Each code signs you in once when you cannot reach your authenticator. Making a new set cancels the old one. You have {left} left.</p>
                <Field label={t("chat.lockedChannel.password")} required>
                  <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
                </Field>
                <Button block loading={busy} disabled={!password} onClick={() => void regenerate()}>{t("settings.security.generateNewCodes")}</Button>
              </>
            ) : (
              <BackupCodes codes={codes} copied={copied} onCopy={() => void copyCodes()} onDownload={downloadCodes} onDone={close} />
            )}
          </div>
        </Modal>
      ) : null}

      {dialog === "disable" ? (
        <Modal title={t("settings.security.turnOffTwoFactorAuthentication")} open onClose={close} width={440}>
          <div className={s.form}>
            {error ? <div className={s.dangerBox}>{error}</div> : null}
            <p className={s.hint}>{t("settings.security.yourPasswordAloneWillGetInto")}</p>
            <Field label={t("chat.lockedChannel.password")} required>
              <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
            </Field>
            <Button block variant="danger" loading={busy} disabled={!password} onClick={() => void disable()}>{t("settings.security.turnItOff")}</Button>
          </div>
        </Modal>
      ) : null}

      {dialog === "passcode" ? (
        <Modal title={lock ? "Change your passcode" : "Set a passcode"} open onClose={close} width={440}>
          <div className={s.form}>
            {error ? <div className={s.dangerBox}>{error}</div> : null}
            <p className={s.hint}>{t("settings.security.digitsOrAPhraseAtLeast")}</p>
            <Field label={t("settings.security.passcode")} required>
              <TextInput type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="new-password" autoFocus data-testid="passcode-new" />
            </Field>
            <Field label={t("settings.security.passcodeAgain")} required>
              <TextInput type="password" value={pin2} onChange={(e) => setPin2(e.target.value)} autoComplete="new-password" data-testid="passcode-confirm" />
            </Field>
            <Button block loading={busy} disabled={!pin || !pin2} onClick={() => void savePasscode()} data-testid="passcode-save">{lock ? "Change it" : "Turn it on"}</Button>
          </div>
        </Modal>
      ) : null}

      {dialog === "removePasscode" ? (
        <Modal title={t("settings.security.removeThePasscode")} open onClose={close} width={440}>
          <div className={s.form}>
            {error ? <div className={s.dangerBox}>{error}</div> : null}
            <p className={s.hint}>{t("settings.security.thisDeviceGoesBackToKeeping")}</p>
            <Button block variant="danger" loading={busy} onClick={() => void dropPasscode()}>{t("settings.security.removeIt")}</Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function BackupCodes({ codes, copied, onCopy, onDownload, onDone }: { codes: string[]; copied: boolean; onCopy: () => void; onDownload: () => void; onDone: () => void }) {
  return (
    <>
      <div className={s.dangerBox} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <Smartphone size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>{t("settings.security.saveTheseNowTheyAreShown")}</span>
      </div>
      <div className={s.recovery} data-testid="backup-codes">
        {codes.map((c) => <div key={c}>{c}</div>)}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="secondary" onClick={onCopy}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}</Button>
        <Button variant="secondary" onClick={onDownload}><Download size={15} /> {t("chat.attachments.download")}</Button>
        <Button onClick={onDone} style={{ marginLeft: "auto" }}>{t("modals.serverNotifications.done")}</Button>
      </div>
    </>
  );
}
