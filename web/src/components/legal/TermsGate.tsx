import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { CONTACT_EMAIL, LEGAL_VERSION, acceptTerms, termsAccepted } from "@/lib/legal";
import { useAuth } from "@/stores/auth";
import { t } from "@/i18n";
import s from "./Legal.module.css";
import { EncryptionNote, RulesSummary } from "./LegalContent";

/**
 * First-run gate: blocks the app until the account accepts the current Terms
 * + Privacy Policy. Persists per account in localStorage; bumping
 * LEGAL_VERSION asks everyone again. No dismiss, no Escape hatch: Agree is
 * the only way through.
 */
export function TermsGate() {
  const me = useAuth((a) => a.me);
  const status = useAuth((a) => a.status);
  const [checked, setChecked] = useState(false);
  const [, force] = useState(0);
  if (status !== "ready" || !me) return null;
  if (termsAccepted(me.id)) return null;
  const agree = () => {
    if (!checked) return;
    acceptTerms(me.id);
    force((n) => n + 1);
  };
  return (
    <Modal
      open
      onClose={() => undefined}
      closeOnOverlay={false}
      title={t("legal.gateTitle")}
      ariaLabel={t("legal.gateTitle")}
      width={560}
      footer={
        <Button variant="primary" disabled={!checked} onClick={agree}>
          {t("legal.agreeAndContinue")}
        </Button>
      }
    >
      <div className={s.gate}>
        <p className={s.body}>{t("legal.gateIntro", { version: LEGAL_VERSION })}</p>
        <EncryptionNote />
        <RulesSummary />
        <p className={s.body}>{t("legal.gatePrivacy")}</p>
        <div className={s.links}>
          <Link to="/terms" target="_blank" rel="noreferrer noopener">
            {t("legal.termsTitle")}
          </Link>
          <Link to="/privacy" target="_blank" rel="noreferrer noopener">
            {t("legal.privacyTitle")}
          </Link>
          <a href={`mailto:${CONTACT_EMAIL}`}>{t("legal.contactOwner")}</a>
        </div>
        <label className={s.check}>
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>{t("legal.gateCheck")}</span>
        </label>
      </div>
    </Modal>
  );
}
