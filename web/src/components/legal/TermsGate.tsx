import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Spinner } from "@/components/common/Spinner";
import { LEGAL_VERSION, acceptTerms, previouslyAccepted, termsAccepted } from "@/lib/legal";
import { useLegalDocs } from "@/lib/legalDocs";
import { useAuth } from "@/stores/auth";
import { t } from "@/i18n";
import s from "./Legal.module.css";
import { LegalChanges, LegalHighlights } from "./LegalContent";
import { LegalDocument } from "./LegalDocument";

type Tab = "summary" | "terms" | "privacy";

/**
 * Blocks the app until the account agrees to the current Terms and Privacy
 * Policy. Someone agreeing again after a change is shown what changed first.
 * The documents can be read in full right here, and anyone who does not want
 * to agree can sign out instead — there is no other way past.
 *
 * Agreement is kept per account on this device; bumping LEGAL_VERSION asks
 * everyone again.
 */
export function TermsGate() {
  const me = useAuth((a) => a.me);
  const status = useAuth((a) => a.status);
  const logout = useAuth((a) => a.logout);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState<Tab>("summary");
  const [, force] = useState(0);
  const reader = useRef<HTMLDivElement>(null);
  const gate = useRef<HTMLDivElement>(null);
  // a new document starts at its top
  useEffect(() => {
    reader.current?.scrollTo({ top: 0 });
  }, [tab]);
  // The dialog focuses its first field, the checkbox at the bottom, which
  // scrolls the dialog to it; it should open at the top, where the reading starts.
  const shown = status === "ready" && !!me && !termsAccepted(me.id);
  // fetched only for someone who is being asked
  const docs = useLegalDocs(shown);
  useEffect(() => {
    if (shown) gate.current?.parentElement?.scrollTo({ top: 0 });
  }, [shown]);

  if (status !== "ready" || !me) return null;
  if (termsAccepted(me.id)) return null;
  const previous = previouslyAccepted(me.id);
  const agree = () => {
    if (!checked) return;
    acceptTerms(me.id);
    force((n) => n + 1);
  };
  const tabs: { id: Tab; label: string }[] = [
    { id: "summary", label: t("legal.readSummary") },
    { id: "terms", label: t("legal.termsTitle") },
    { id: "privacy", label: t("legal.privacyTitle") },
  ];
  return (
    <Modal
      open
      onClose={() => undefined}
      closeOnOverlay={false}
      closeButton={false}
      title={previous ? t("legal.gateTitleUpdated") : t("legal.gateTitle")}
      width={680}
      footer={
        <div className={s.gateFoot}>
          <Button variant="ghost" onClick={() => void logout()}>
            {t("settings.settings.logOut")}
          </Button>
          <span className={s.grow} />
          <Button variant="primary" disabled={!checked} onClick={agree} data-testid="terms-agree">
            {t("legal.agreeAndContinue")}
          </Button>
        </div>
      }
    >
      <div className={s.gate} data-testid="terms-gate" ref={gate}>
        <p className={s.gateLead}>{previous ? t("legal.gateUpdatedIntro", { version: LEGAL_VERSION }) : t("legal.gateIntro", { version: LEGAL_VERSION })}</p>
        {previous ? <LegalChanges /> : null}
        <div className={s.readTabs} role="tablist" aria-label={t("legal.readSummary")}>
          {tabs.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={s.readTab} data-selected={tab === x.id} onClick={() => setTab(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        {tab === "summary" ? (
          <LegalHighlights />
        ) : (
          <div className={s.reader} ref={reader} role="tabpanel">
            {docs ? (
              <LegalDocument doc={tab === "terms" ? docs.terms : docs.privacy} toc={false} />
            ) : (
              <div className={s.loading}>
                <Spinner />
              </div>
            )}
          </div>
        )}
        <label className={s.check}>
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} data-testid="terms-check" />
          <span>{t("legal.gateCheck")}</span>
        </label>
      </div>
    </Modal>
  );
}
