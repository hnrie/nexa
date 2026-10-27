import { PersonName } from "@/components/common/PersonName";
import { useEffect, useState } from "react";
import type { PublicUser } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { QrCode } from "@/components/common/QrCode";
import { Spinner } from "@/components/common/Spinner";
import { waitForQrSignIn } from "@/lib/qrLogin";
import { ReadableError } from "@/lib/readableError";
import type { SignedIn } from "@/stores/auth";
import s from "./Auth.module.css";

import { t, Tr } from "@/i18n";

/**
 * The login page's QR code: a phone where the account is signed in scans it
 * and approves, and this device signs in (lib/qrLogin.ts). It turns into the
 * person who scanned it while they decide, and a new code follows a no.
 */
export function QrSignIn({ onSignedIn, onError, className }: { onSignedIn: (out: SignedIn) => Promise<void>; onError: (message: string) => void; className?: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [scanned, setScanned] = useState<PublicUser | null>(null);

  useEffect(() => {
    const stop = new AbortController();
    void waitForQrSignIn(
      {
        onCode: (l) => {
          setLink(l);
          setScanned(null);
        },
        onScanned: setScanned,
        onDenied: () => setScanned(null),
      },
      stop.signal,
    )
      .then(onSignedIn)
      .catch((err) => {
        if (!stop.signal.aborted) onError(err instanceof ReadableError ? err.message : t("qrLogin.couldNotSignIn"));
      });
    return () => stop.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className={[s.qrSide, className ?? ""].join(" ")} aria-live="polite" data-testid="qr-sign-in">
      {scanned ? (
        <>
          <div className={s.qrPlate} data-scanned>
            <Avatar id={scanned.id} avatarId={scanned.avatar_id} name={scanned.display_name} size={96} />
          </div>
          <h2 className={s.qrTitle}>{t("qrLogin.checkYourPhone")}</h2>
          <p className={s.qrText}>{<Tr id="qrLogin.approveAs" values={{ name: <PersonName user={scanned}>{scanned.display_name}</PersonName> }} />}</p>
        </>
      ) : (
        <>
          <div className={s.qrPlate}>
            {link ? <QrCode text={link} size={168} label={t("qrLogin.title")} /> : <Spinner size={32} />}
          </div>
          <h2 className={s.qrTitle}>{t("qrLogin.title")}</h2>
          <p className={s.qrText}>{t("qrLogin.hint")}</p>
        </>
      )}
    </section>
  );
}
