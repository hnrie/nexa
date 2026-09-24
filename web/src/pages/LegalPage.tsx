import { Link } from "react-router-dom";
import { NexaWordmark } from "@/components/common/Brand";
import { Spinner } from "@/components/common/Spinner";
import { ContactBlock, LegalHighlights } from "@/components/legal/LegalContent";
import { LegalDocument } from "@/components/legal/LegalDocument";
import { CONTACT_EMAIL } from "@/lib/legal";
import { useLegalDocs } from "@/lib/legalDocs";
import { t } from "@/i18n";
import s from "./Auth.module.css";
import l from "@/components/legal/Legal.module.css";

/**
 * The public legal pages: /terms and /privacy show the documents whole, as
 * written in docs/legal; /about says what Nexa is and points at both. The
 * documents are English on purpose — a translated Terms is a different Terms.
 */
export default function LegalPage({ page }: { page: "terms" | "privacy" | "about" }) {
  const docs = useLegalDocs(page !== "about");
  return (
    <div className={s.page}>
      <div className={s.brand}>
        <Link to="/" aria-label="Nexa">
          <NexaWordmark height={38} />
        </Link>
      </div>
      <main className={s.card} style={{ width: 760 }} data-testid={`legal-${page}`}>
        {page !== "about" && !docs ? (
          <div className={l.loading}>
            <Spinner />
          </div>
        ) : null}
        {page === "terms" && docs ? <LegalDocument doc={docs.terms} /> : null}
        {page === "privacy" && docs ? <LegalDocument doc={docs.privacy} /> : null}
        {page === "about" ? (
          <>
            <h1 className={s.title}>{t("legal.aboutTitle")}</h1>
            <p className={l.body}>{t("legal.aboutLead")}</p>
            <LegalHighlights />
            <p className={l.body} style={{ marginTop: 16 }}>
              <Link to="/terms">{t("legal.termsTitle")}</Link>
              {" · "}
              <Link to="/privacy">{t("legal.privacyTitle")}</Link>
            </p>
            <ContactBlock />
          </>
        ) : null}
        <p className={l.body} style={{ marginTop: 20 }}>
          <Link to="/register">{t("home.nav.getStarted")}</Link>
          {" · "}
          <Link to="/login">{t("home.nav.logIn")}</Link>
          {" · "}
          {page !== "terms" ? (
            <>
              <Link to="/terms">{t("legal.termsTitle")}</Link>
              {" · "}
            </>
          ) : null}
          {page !== "privacy" ? (
            <>
              <Link to="/privacy">{t("legal.privacyTitle")}</Link>
              {" · "}
            </>
          ) : null}
          <a href={`mailto:${CONTACT_EMAIL}`}>{t("legal.contactOwner")}</a>
        </p>
      </main>
    </div>
  );
}
