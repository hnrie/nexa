/**
 * Showing an identity key to a person.
 *
 * Pinning a key (see `lib/keyPins.ts`) only ever catches a key that *changes*.
 * A key that was the server's own from the very first sight is invisible to it,
 * because there is nothing to compare against. That comparison has to happen
 * outside the server's reach — two people in a room, or on a phone call — so
 * there has to be something short enough for a human to read out, and something
 * a camera can check in a second.
 *
 * So: the thirty digits from `crypto/fingerprint.ts`, and the same digits as a
 * QR code. The digits are the canonical thing and the QR is only a faster way
 * of reading them, which is why both are on screen together — one person can
 * scan while the other reads.
 */

import { KeyRound, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useMemo } from "react";
import { QrCode } from "@/components/common/QrCode";
import { fingerprintOfB64 } from "@/crypto/fingerprint";
import { learnedThisSession, pinnedKey, startedWithNoPins, type PinVerdict } from "@/lib/keyPins";
import { useKeyAlerts } from "@/stores/keyAlerts";
import { useUsers } from "@/stores/users";
import s from "./KeyVerify.module.css";

import { t } from "@/i18n";

/**
 * What this device can say about a key without asking the server anything.
 *
 * A key this device only learned a moment ago counts as "first", not "same":
 * a second device pins everybody within a second of connecting, and a badge
 * reading "same key as before" straight afterwards would be claiming a check
 * that never happened. The grant path deliberately does not use this — there a
 * pin is a pin — but what a person is told has to be true.
 */
export function verdictFor(userId: string, publicKey: string | null | undefined): PinVerdict {
  if (!publicKey) return "unknown";
  const pin = pinnedKey(userId);
  if (!pin) return "first";
  if (pin !== publicKey) return "changed";
  return learnedThisSession(userId) ? "first" : "same";
}

/** The thirty digits, grouped, plus the QR code that carries the same value. */
export function SafetyNumber({ publicKey, qr = true, old = false }: { publicKey: string; qr?: boolean; old?: boolean }) {
  const digits = useMemo(() => fingerprintOfB64(publicKey), [publicKey]);
  if (!digits) return <p className={s.note}>{t("encryption.noKeyToShow")}</p>;
  const groups = digits.split(" ");
  return (
    <div className={s.panel}>
      <p className={s.digits} data-old={old || undefined} data-testid="safety-number">
        {groups.map((g, i) => (
          <span key={i}>{g}</span>
        ))}
      </p>
      {qr ? (
        <div className={s.qrWrap}>
          <QrCode text={digits} size={168} label={t("encryption.safetyNumberQr")} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The small badge beside a name. It says what this device knows, and nothing
 * more: "new to this device" is not "verified", and saying otherwise would be
 * the same lie the product used to tell by saying nothing at all.
 */
export function KeyStatusChip({ userId, onClick, iconOnly }: { userId: string; onClick?: () => void; iconOnly?: boolean }) {
  const user = useUsers((u) => u.byId[userId]);
  // Subscribed so accepting a change re-labels the chip immediately.
  const pending = useKeyAlerts((k) => k.pending[userId]);
  const verdict = pending ? "changed" : verdictFor(userId, user?.public_key);
  if (verdict === "unknown") return null;
  const state = verdict === "changed" ? "changed" : verdict === "same" ? "known" : "new";
  const label = state === "changed" ? t("encryption.chipChanged") : state === "known" ? t("encryption.chipKnown") : t("encryption.chipNew");
  const Icon = state === "changed" ? ShieldAlert : state === "known" ? ShieldCheck : ShieldQuestion;
  const body = (
    <>
      <Icon size={13} aria-hidden />
      {iconOnly ? null : label}
    </>
  );
  if (!onClick) {
    return (
      <span className={s.chip} data-state={state} data-icon-only={iconOnly || undefined} title={iconOnly ? label : undefined} data-testid="key-chip">
        {body}
      </span>
    );
  }
  return (
    <button type="button" className={s.chip} data-state={state} data-icon-only={iconOnly || undefined} title={iconOnly ? label : undefined} data-testid="key-chip" onClick={onClick} aria-label={iconOnly ? label : t("encryption.openSafetyNumber")}>
      {body}
    </button>
  );
}

/**
 * The whole story for one person: their digits, what this device remembers, and
 * the plain sentence about what that does and does not prove.
 */
export function KeyVerifyBody({ userId, name }: { userId: string; name: string }) {
  const user = useUsers((u) => u.byId[userId]);
  const pending = useKeyAlerts((k) => k.pending[userId]);
  const key = user?.public_key ?? null;
  const verdict = pending ? "changed" : verdictFor(userId, key);
  return (
    <div className={s.panel}>
      <p className={s.compare}>{t("encryption.compareInstruction", { name })}</p>
      {key ? <SafetyNumber publicKey={key} /> : <p className={s.note}>{t("encryption.noKeyToShow")}</p>}
      {verdict === "same" ? (
        <p className={s.note}>{t("encryption.noteSameSinceFirstSeen", { name })}</p>
      ) : verdict === "first" ? (
        <p className={s.note}>{startedWithNoPins() ? t("encryption.noteNoMemoryYet") : t("encryption.noteFirstSeenNow", { name })}</p>
      ) : verdict === "changed" ? (
        <p className={s.warn}>{t("encryption.noteChanged", { name })}</p>
      ) : null}
      <p className={s.note}>
        <KeyRound size={13} aria-hidden /> {t("encryption.noteWhatThisProves")}
      </p>
    </div>
  );
}
