import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Spinner } from "@/components/common/Spinner";
import { LEGAL_EFFECTIVE, acceptTerms, previouslyAccepted, termsAccepted } from "@/lib/legal";
import { useLegalDocs } from "@/lib/legalDocs";
import { useAuth } from "@/stores/auth";
import { t } from "@/i18n";
import s from "./Legal.module.css";
import { LegalChanges, LegalHighlights } from "./LegalContent";
import { LegalDocument } from "./LegalDocument";

type Tab = "summary" | "terms" | "privacy";
const TABS: Tab[] = ["summary", "terms", "privacy"];

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
  const baseId = useId();
  const tabId = (x: Tab) => `${baseId}-tab-${x}`;
  const panelId = `${baseId}-panel`;
  // a new document starts at its top
  useEffect(() => {
    reader.current?.scrollTo({ top: 0 });
  }, [tab]);
  // The dialog opens at the top of the reading, where it starts, whatever it
  // focuses first.
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
  // Tabs as the pattern has them: one stop for the row, the arrows move
  // along it (mirrored when the page reads right to left), Home and End jump.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.indexOf(tab);
    // the row's own direction, which follows its (English) labels rather than the page
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const step = e.key === "ArrowRight" ? (rtl ? -1 : 1) : e.key === "ArrowLeft" ? (rtl ? 1 : -1) : 0;
    const to = step ? TABS[(i + step + TABS.length) % TABS.length] : e.key === "Home" ? TABS[0] : e.key === "End" ? TABS[TABS.length - 1] : undefined;
    if (!to) return;
    e.preventDefault();
    setTab(to);
    document.getElementById(tabId(to))?.focus();
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
        // The checkbox rides with the button it unlocks. Below the reading it
        // sat under the fold on a phone, with "Agree" greyed out and nothing on
        // screen saying why.
        <div className={s.gateFootWrap}>
          <label className={s.check} dir="auto">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} data-testid="terms-check" />
            <span>{t("legal.gateCheck")}</span>
          </label>
          <div className={s.gateFoot}>
            <Button variant="ghost" onClick={() => void logout()}>
              {t("settings.settings.logOut")}
            </Button>
            <span className={s.grow} />
            <Button variant="primary" disabled={!checked} onClick={agree} data-testid="terms-agree">
              {t("legal.agreeAndContinue")}
            </Button>
          </div>
        </div>
      }
    >
      {/* the legal text is English on purpose; it lays itself out as English (see LegalContent) */}
      <div className={s.gate} data-testid="terms-gate" ref={gate} dir="auto">
        <p className={s.gateLead}>{previous ? t("legal.gateUpdatedIntro", { version: LEGAL_EFFECTIVE }) : t("legal.gateIntro", { version: LEGAL_EFFECTIVE })}</p>
        {previous ? <LegalChanges /> : null}
        <div className={s.readTabs} role="tablist" aria-label={t("legal.readSummary")}>
          {tabs.map((x) => (
            <button
              key={x.id}
              id={tabId(x.id)}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              aria-controls={panelId}
              tabIndex={tab === x.id ? 0 : -1}
              className={s.readTab}
              data-selected={tab === x.id}
              onClick={() => setTab(x.id)}
              onKeyDown={onTabKey}
            >
              {x.label}
            </button>
          ))}
        </div>
        {tab === "summary" ? (
          <div role="tabpanel" id={panelId} aria-labelledby={tabId(tab)}>
            <LegalHighlights />
          </div>
        ) : (
          // focusable, so the document can be scrolled from the keyboard too
          <div className={s.reader} ref={reader} role="tabpanel" id={panelId} aria-labelledby={tabId(tab)} tabIndex={0}>
            {docs ? (
              <LegalDocument doc={tab === "terms" ? docs.terms : docs.privacy} toc={false} />
            ) : (
              <div className={s.loading}>
                <Spinner />
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
