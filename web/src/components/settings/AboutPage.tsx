import { Link } from "react-router-dom";
import { CONTACT_EMAIL, LEGAL_VERSION, OWNER_USERNAME } from "@/lib/legal";
import { t } from "@/i18n";
import s from "../settings/Settings.module.css";
import l from "../legal/Legal.module.css";
import { PrivacyFull, TermsFull } from "../legal/LegalContent";

/**
 * Settings → About, pinned to the bottom of the nav: what Nexa is, the
 * rules, the privacy substance, and how to reach the owner. Same content as
 * the public /about + /terms + /privacy pages.
 */
export default function AboutPage() {
  return (
    <>
      <h2 className={s.title}>{t("legal.aboutTitle")}</h2>
      <p className={s.hint}>{t("legal.aboutIntro", { version: LEGAL_VERSION })}</p>
      <p className={l.body}>
        <Link to="/terms">{t("legal.termsTitle")}</Link>
        {" · "}
        <Link to="/privacy">{t("legal.privacyTitle")}</Link>
        {" · "}
        {t("legal.contactOwner")}: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        {" · "}
        {t("legal.inApp", { user: `@${OWNER_USERNAME}` })}
      </p>
      <TermsFull />
      <PrivacyFull />
    </>
  );
}
