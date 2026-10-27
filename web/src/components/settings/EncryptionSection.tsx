import { PersonName } from "@/components/common/PersonName";
/**
 * What this device knows about identity keys, in one place a person can read.
 *
 * Two things used to happen with nothing on screen at all: the client sealed a
 * conversation key for whoever the server named, and it accepted whatever key
 * the server gave for a person. Both are now checked, and both can be refused —
 * but a refusal nobody can see is only marginally better than no refusal, so
 * this is where they are written down, alongside this account's own safety
 * number and how long this device has been keeping watch.
 */
import { Copy, KeyRound, QrCode, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/common/Button";
import { fingerprintOfB64 } from "@/crypto/fingerprint";
import { copyAndSay } from "@/lib/copyText";
import { SafetyNumber } from "@/components/profile/KeyVerify";
import { b64 } from "@/crypto/bytes";
import { hasPins, pinsSince } from "@/lib/keyPins";
import { formatDateDivider } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { useKeyAlerts, type SecurityEvent } from "@/stores/keyAlerts";
import { displayName, useUsers } from "@/stores/users";
import { useUI } from "@/stores/ui";
import s from "./Settings.module.css";
import k from "@/components/profile/KeyVerify.module.css";

import { t, Tr } from "@/i18n";

function describe(e: SecurityEvent, name: React.ReactNode): React.ReactNode {
  switch (e.kind) {
    case "key_changed":
      return <Tr id="encryption.logKeyChanged" values={{ name }} />;
    case "outsider_refused":
      return t("encryption.logOutsiderRefused", { count: e.count ?? 1 });
    case "grant_withheld":
      return <Tr id="encryption.logGrantWithheld" values={{ name }} />;
    case "unchecked":
      return t("encryption.logUnchecked", { count: e.count ?? 0 });
  }
}

export function EncryptionSection() {
  const me = useAuth((a) => a.me);
  const identity = useAuth((a) => a.identity);
  const events = useKeyAlerts((x) => x.events);
  const pending = useKeyAlerts((x) => x.pending);
  const clearEvents = useKeyAlerts((x) => x.clearEvents);
  const users = useUsers((u) => u.byId);
  const openModal = useUI((u) => u.openModal);
  const since = pinsSince();
  const pendingCount = Object.keys(pending).length;
  // The key in hand, not the one the server would answer with: this is the one
  // thing on the page that can be shown without trusting anybody.
  const myKey = identity ? b64.enc(identity.publicKey) : (me?.public_key ?? null);
  const [showCode, setShowCode] = useState(false);

  return (
    <>
      <h3 className={s.h5} style={{ marginTop: 28 }}><KeyRound size={16} /> {t("encryption.sectionTitle")}</h3>
      <p className={s.hint}>{t("encryption.sectionHint")}</p>

      {/* The number used to sit here with no name, straight under a sentence
          about other people's keys, and read as if it might be one of theirs. */}
      {myKey ? (
        <div className={s.safety} data-testid="own-safety-number">
          <div className={s.safetyHead}>
            <div>
              <div className={s.deviceName}>{t("encryption.yourSafetyNumber")}</div>
              <div className={s.deviceSub}>{t("encryption.yourSafetyNumberHint")}</div>
            </div>
            <div className={s.safetyBtns}>
              <Button size="sm" variant="secondary" onClick={() => copyAndSay(fingerprintOfB64(myKey) ?? "")}><Copy size={14} /> {t("modals.groupInvite.copy")}</Button>
              <Button size="sm" variant="secondary" onClick={() => setShowCode((v) => !v)} aria-expanded={showCode}><QrCode size={14} /> {showCode ? t("encryption.hideCode") : t("encryption.showCode")}</Button>
            </div>
          </div>
          <SafetyNumber publicKey={myKey} qr={showCode} />
        </div>
      ) : null}

      <div className={s.device} style={{ marginTop: 12 }} data-testid="key-memory-row">
        <div>
          <div className={s.deviceName}>{hasPins() ? t("encryption.rememberingKeys") : t("encryption.rememberingNothingYet")}</div>
          <div className={s.deviceSub}>
            {hasPins() && since ? t("encryption.rememberingSince", { when: formatDateDivider(since) }) : t("encryption.rememberingNothingYetSub")}
          </div>
        </div>
        {pendingCount > 0 ? (
          <Button size="sm" variant="danger" onClick={() => openModal("keyChange")} data-testid="review-key-changes">
            <ShieldAlert size={14} /> {t("encryption.reviewChanges", { count: pendingCount })}
          </Button>
        ) : null}
      </div>

      {events.length > 0 ? (
        <div className={s.device} style={{ marginTop: 12, alignItems: "flex-start" }} data-testid="key-log">
          <ul className={k.log}>
            {events.slice(0, 20).map((e) => (
              <li key={e.id} className={k.logRow}>
                <span>{describe(e, e.userId ? <PersonName userId={e.userId}>{displayName(users[e.userId])}</PersonName> : t("names.unknownUser"))}</span>
                <span className={k.logWhen}>{formatDateDivider(e.at)}</span>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="secondary" onClick={clearEvents}>{t("encryption.clearLog")}</Button>
        </div>
      ) : null}
    </>
  );
}
