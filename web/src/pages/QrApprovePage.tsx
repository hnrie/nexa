import { PersonName } from "@/components/common/PersonName";
import { Laptop, ShieldAlert, Smartphone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/common/Button";
import { FullScreenSpinner } from "@/components/common/Spinner";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { describeDevice } from "@/lib/deviceLabel";
import { describeError } from "@/lib/errors";
import { approveQr, denyQr, parseQrLink, scanQr } from "@/lib/qrLogin";
import { useAuth } from "@/stores/auth";
import { AuthLayout, usePageTitle } from "./AuthLayout";
import s from "./Auth.module.css";

import { t, Tr } from "@/i18n";

/**
 * What a phone opens from a login page's QR code (`/login/qr#<id>.<key>`):
 * which device is asking, and Log In or Cancel. Only a device where the
 * account is signed in can let another one in.
 */
export default function QrApprovePage() {
  const status = useAuth((a) => a.status);
  const bootstrap = useAuth((a) => a.bootstrap);
  usePageTitle(t("qrLogin.logInOnAnotherDevice"));
  useEffect(() => {
    if (status === "idle") void bootstrap();
  }, [status, bootstrap]);
  if (status === "idle" || status === "loading") return <FullScreenSpinner />;
  if (status === "anonymous") {
    return (
      <AuthLayout title={t("qrLogin.logInOnAnotherDevice")} subtitle={t("qrLogin.signInHereFirst")}>
        <Link to="/login" className={s.center}>{t("login.logIn")}</Link>
      </AuthLayout>
    );
  }
  return (
    <RequireAuth>
      <Approve />
    </RequireAuth>
  );
}

type Step = { at: "asking" } | { at: "confirm"; device: string; phone: boolean } | { at: "done" } | { at: "cancelled" } | { at: "failed"; message: string };

function Approve() {
  const nav = useNavigate();
  const me = useAuth((a) => a.me);
  const identity = useAuth((a) => a.identity);
  // read once: the key in the link is what the box is sealed to
  const code = useMemo(() => parseQrLink(location.hash), []);
  const [step, setStep] = useState<Step>(code ? { at: "asking" } : { at: "failed", message: t("qrLogin.notACode") });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // the key stays out of the address bar and the history from here on
    history.replaceState(history.state, "", location.pathname);
    if (!code) return;
    scanQr(code.id).then(
      (r) => {
        const d = describeDevice(r.user_agent);
        setStep({ at: "confirm", device: d.label, phone: d.kind === "phone" || d.kind === "tablet" });
      },
      (err) => setStep({ at: "failed", message: describeError(err, t("qrLogin.codeExpired")) }),
    );
  }, [code]);

  const approve = async () => {
    if (!code || !identity || busy) return;
    setBusy(true);
    try {
      await approveQr(code.id, code.publicKey, identity);
      setStep({ at: "done" });
    } catch (err) {
      setStep({ at: "failed", message: describeError(err, t("qrLogin.codeExpired")) });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (code) await denyQr(code.id).catch(() => undefined);
    setStep({ at: "cancelled" });
  };

  if (step.at === "asking") return <FullScreenSpinner />;
  const home = <Button block size="lg" variant="secondary" onClick={() => nav("/channels/@me", { replace: true })}>{t("qrLogin.openNexa")}</Button>;
  if (step.at === "done") {
    return (
      <AuthLayout title={t("qrLogin.youReIn")} subtitle={t("qrLogin.theOtherDeviceIsSignedIn")} mark={<div className={s.mark} data-tone="good"><Laptop size={28} /></div>}>
        {home}
      </AuthLayout>
    );
  }
  if (step.at === "cancelled") {
    return (
      <AuthLayout title={t("qrLogin.cancelled")} subtitle={t("qrLogin.nobodyWasLetIn")}>
        {home}
      </AuthLayout>
    );
  }
  if (step.at === "failed") {
    return (
      <AuthLayout title={t("qrLogin.logInOnAnotherDevice")} subtitle={step.message} mark={<div className={s.mark} data-tone="warn"><ShieldAlert size={28} /></div>}>
        {home}
      </AuthLayout>
    );
  }
  return (
    <AuthLayout
      title={t("qrLogin.logInOnDevice", { device: step.device })}
      subtitle={<Tr id="qrLogin.asName" values={{ name: <PersonName user={me}>{me?.display_name ?? ""}</PersonName> }} />}
      mark={<div className={s.mark}>{step.phone ? <Smartphone size={28} /> : <Laptop size={28} />}</div>}
    >
      <div className={s.warn}>{t("qrLogin.onlyIfYouOpenedIt")}</div>
      <div className={s.form}>
        <Button block size="lg" loading={busy} onClick={() => void approve()} data-testid="qr-approve">{t("login.logIn")}</Button>
        <Button block size="lg" variant="secondary" disabled={busy} onClick={() => void cancel()} data-testid="qr-deny">{t("qrLogin.cancel")}</Button>
      </div>
    </AuthLayout>
  );
}
