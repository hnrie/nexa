import { Link } from "react-router-dom";
import { NexaWordmark } from "@/components/common/Brand";
import { CONTACT_EMAIL } from "@/lib/legal";
import { t } from "@/i18n";
import { PrivacyFull, TermsFull } from "@/components/legal/LegalContent";
import s from "./Auth.module.css";
import l from "@/components/legal/Legal.module.css";

/** Public legal pages: /terms, /privacy, /about. English on purpose. */
export default function LegalPage({ page }: { page: "terms" | "privacy" | "about" }) {
  return (
    <div className={s.page}>
      <div className={s.brand}>
        <Link to="/" aria-label="Nexa">
          <NexaWordmark height={38} />
        </Link>
      </div>
      <main className={s.card} style={{ width: 720 }}>
        <h1 className={s.title}>
          {page === "terms" ? t("legal.termsTitle") : page === "privacy" ? t("legal.privacyTitle") : t("legal.aboutTitle")}
        </h1>
        {page === "terms" ? <TermsFull /> : page === "privacy" ? <PrivacyFull /> : null}
        {page === "about" ? (
          <>
            <p className={l.body}>{t("legal.aboutIntro", { version: "" })}</p>
            <TermsFull />
            <PrivacyFull />
          </>
        ) : null}
        <p className={l.body}>
          <Link to="/register">{t("home.nav.getStarted")}</Link>
          {" · "}
          <Link to="/login">{t("home.nav.logIn")}</Link>
          {" · "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{t("legal.contactOwner")}</a>
        </p>
      </main>
    </div>
  );
}
