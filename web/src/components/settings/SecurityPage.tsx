import { Check, Copy, Download, Lock, ShieldCheck, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { auth as authApi } from "@/api/auth";
import type { MfaStatus, TotpSetup } from "@/api/types";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Spinner } from "@/components/common/Spinner";
import { QrCode } from "@/components/common/QrCode";
import { Select } from "@/components/common/Select";
import { Field, TextInput } from "@/components/common/TextInput";
import { Toggle } from "@/components/common/Toggle";
import { b64 } from "@/crypto/bytes";
import { deriveAuthKey, deriveMaster } from "@/crypto/kdf";
import { acceptServerKdf } from "@/lib/serverKdf";
import { users as usersApi } from "@/api/users";
import { autoLockChoices, blurDelayChoices, DEFAULT_LOCK, loadLock, passcodeProblem, patchLock, type LockConfig } from "@/lib/appLock";
import { EncryptionSection } from "./EncryptionSection";
import { describeError } from "@/lib/errors";
import { formatDateDivider } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import s from "./Settings.module.css";

import { t } from "@/i18n";
/** Turns the account password into the proof the server expects. */
async function authKeyFor(password: string): Promise<string> {
  const bundle = await usersApi.myKeys();
  // The stretch parameters are the server's answer, and the proof below goes
  // straight back to it, so they are checked against the floor first.
  const master = await deriveMaster(password, b64.dec(bundle.kdf_salt), acceptServerKdf(bundle.kdf_params));
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

  // `undefined` is "still asking", `null` is "the check failed". Collapsing the
  // two into a falsy value reported two-factor as *off* for an account that has
  // it on, and offered a Set up button that was always going to fail.
  const [status, setStatus] = useState<MfaStatus | null | undefined>(undefined);
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

  const loadStatus = () => {
    setStatus(undefined);
    authApi.mfaStatus().then(setStatus, () => setStatus(null));
  };
  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setError(describeError(err, t("modals.confirm.somethingWentWrong")));
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
      toast(t("settings.security.twoFactorAuthenticationIsOn"), "success");
    });

  const disable = () =>
    run(async () => {
      await authApi.mfaDisable(await authKeyFor(password));
      await refresh();
      close();
      toast(t("settings.security.twoFactorAuthenticationIsOff"), "success");
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
      if (pin !== pin2) throw new Error(t("settings.security.thoseTwoPasscodesAreDifferent"));
      await setPasscode(pin, lock ?? DEFAULT_LOCK);
      setLock(loadLock(me.id));
      close();
      toast(t("settings.security.thisDeviceNowAsksForYour"), "success");
    });

  const dropPasscode = () =>
    run(async () => {
      await removePasscode();
      setLock(null);
      close();
      toast(t("settings.security.passcodeRemoved"), "success");
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
      toast(t("settings.security.couldNotReachTheClipboardSelect"), "error");
    }
  };

  const downloadCodes = () => {
    if (!codes) return;
    const body = `${t("settings.security.backupCodesFileHeading", { username: me.username })}\n${t("settings.security.eachCodeWorksOnce")}\n\n${codes.join("\n")}\n`;
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `evilion-chat-backup-codes-${me.username}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const on = status?.enabled ?? false;
  const left = status?.backup_codes_left ?? 0;
  const checking = status === undefined;
  const unknown = status === null;

  return (
    <>
      <h2 className={s.title}>{t("settings.security.security")}</h2>

      <h3 className={s.h5}><ShieldCheck size={16} /> {t("settings.security.twoFactorAuthentication")}</h3>
      <p className={s.hint}>
        {t("settings.security.anAuthenticatorAppAdds")}
      </p>
      <div className={s.device} data-testid="mfa-row">
        <div>
          <div className={s.deviceName}>
            {checking ? t("settings.security.checkingYourTwoFactorStatus") : unknown ? t("settings.security.twoFactorStatusUnknown") : on ? t("settings.security.authenticatorAppIsOn") : t("settings.security.authenticatorAppIsOff")}
          </div>
          <div className={s.deviceSub}>
            {checking
              ? t("settings.security.oneMoment")
              : unknown
                ? t("settings.security.weCouldNotAskTheServer")
                : on
                  ? `${t("settings.security.backupCodesLeftCount", { count: left })}${status?.enabled_at ? t("settings.security.onSince", { when: formatDateDivider(status.enabled_at) }) : ""}`
                  : t("settings.security.worksWithAnyTotpApp")}
          </div>
        </div>
        {checking ? (
          <Spinner size={24} label={t("settings.security.checkingYourTwoFactorStatus")} />
        ) : unknown ? (
          <Button size="sm" variant="secondary" onClick={loadStatus} data-testid="mfa-retry">{t("chat.messageList.tryAgain")}</Button>
        ) : on ? (
          <div style={{ display: "flex", gap: 8 }}>
            <Button size="sm" variant="secondary" onClick={() => setDialog("codes")}>{t("settings.security.backupCodes")}</Button>
            <Button size="sm" variant="danger" onClick={() => setDialog("disable")} data-testid="mfa-disable">{t("settings.security.turnOff")}</Button>
          </div>
        ) : (
          <Button size="sm" onClick={() => setDialog("enable")} data-testid="mfa-enable">{t("settings.security.setUp")}</Button>
        )}
      </div>
      {!checking && !unknown && on && left === 0 ? <div className={s.dangerBox} style={{ marginTop: 12 }}>{t("settings.security.youHaveNoBackupCodesLeft")}</div> : null}

      <h3 className={s.h} style={{ marginTop: 28 }}><Lock size={16} /> {t("settings.security.appLock")}</h3>
      <p className={s.hint}>
        A passcode for this device. While it is on, your keys are stored wrapped by the passcode, so closing the tab or locking the app really does put your messages out of reach until you type it again. Ten wrong tries wipe the wrapped copy, and your account password gets you back in.
      </p>
      <div className={s.device} data-testid="lock-row">
        <div>
          <div className={s.deviceName}>{policy ? t("settings.security.passcodeIsOnForThisAccount") : t("settings.security.noPasscodeSet")}</div>
          <div className={s.deviceSub}>{policy ? t("settings.security.everyDeviceYouSignInOn") : t("settings.security.theAppOpensStraightIntoYour")}</div>
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
              {t("settings.security.lockAfterInactivity")}
              <div className={s.deviceSub}>{t("settings.security.nothingTypedClickedOrScrolledFor")}</div>
            </div>
            <div className={s.rowValue}>
              <Select value={String(lock.autoLockMs)} onChange={(e) => patch({ autoLockMs: Number(e.target.value) })} aria-label={t("settings.security.lockAfterInactivity")} data-testid="lock-idle">
                {autoLockChoices().map((c) => <option key={c.ms} value={c.ms}>{c.label}</option>)}
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
                  {blurDelayChoices().map((c) => <option key={c.ms} value={c.ms}>{c.label}</option>)}
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

      <EncryptionSection />

      {dialog === "enable" ? (
        <Modal title={codes ? t("settings.security.saveYourBackupCodes") : setup ? t("settings.security.scanThisWithYourAuthenticator") : t("settings.security.setUpTwoFactorAuthentication")} open onClose={close} closeOnOverlay={!codes} width={460}>
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
                  {showSecret ? t("settings.security.hideTheKey") : t("settings.security.canTScanIt")}
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
                <p className={s.hint}>{t("settings.security.backupCodesHint")} {t("settings.security.backupCodesLeft", { count: left })}</p>
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
        <Modal title={lock ? t("settings.security.changeYourPasscode") : t("settings.security.setAPasscode")} open onClose={close} width={440}>
          <div className={s.form}>
            {error ? <div className={s.dangerBox}>{error}</div> : null}
            <p className={s.hint}>{t("settings.security.digitsOrAPhraseAtLeast")}</p>
            <Field label={t("settings.security.passcode")} required>
              <TextInput type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="new-password" autoFocus data-testid="passcode-new" />
            </Field>
            <Field label={t("settings.security.passcodeAgain")} required>
              <TextInput type="password" value={pin2} onChange={(e) => setPin2(e.target.value)} autoComplete="new-password" data-testid="passcode-confirm" />
            </Field>
            <Button block loading={busy} disabled={!pin || !pin2} onClick={() => void savePasscode()} data-testid="passcode-save">{lock ? t("settings.security.changeIt") : t("settings.security.turnItOn")}</Button>
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
        <Button onClick={onDone} style={{ marginInlineStart: "auto" }}>{t("modals.serverNotifications.done")}</Button>
      </div>
    </>
  );
}
