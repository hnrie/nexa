import { CONTACT_EMAIL, OWNER_USERNAME } from "@/lib/legal";
import { t } from "@/i18n";
import s from "./Legal.module.css";

/**
 * The platform rules + privacy substance, shared by Settings → About and the
 * public /terms /privacy /about pages so they can never drift apart.
 */
export function ContactBlock() {
  return (
    <p className={s.body}>
      {t("legal.contactOwner")}: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      {" · "}
      <a href="/channels/@me">{t("legal.inApp", { user: `@${OWNER_USERNAME}` })}</a>
    </p>
  );
}

export function EncryptionNote() {
  return (
    <section className={s.section}>
      <h3 className={s.h}>{t("legal.encryptionTitle")}</h3>
      <p className={s.body}>{t("legal.encryptionBody")}</p>
    </section>
  );
}

export function RulesSummary() {
  const rules = [
    t("legal.ruleIllegal"),
    t("legal.ruleCopyright"),
    t("legal.ruleGore"),
    t("legal.ruleHate"),
  ];
  return (
    <section className={s.section}>
      <h3 className={s.h}>{t("legal.rulesTitle")}</h3>
      <ol className={s.list}>
        {rules.map((r) => (
          <li key={r} className={s.body}>
            {r}
          </li>
        ))}
      </ol>
      <p className={s.body}>{t("legal.enforcementBody")}</p>
    </section>
  );
}

export function TermsFull() {
  return (
    <section className={s.section}>
      <h3 className={s.h}>{t("legal.termsTitle")}</h3>
      <p className={s.body}>{t("legal.termsWhat")}</p>
      <p className={s.body}>{t("legal.termsAccounts")}</p>
      <EncryptionNote />
      <RulesSummary />
      <p className={s.body}>{t("legal.termsUse")}</p>
      <ContactBlock />
    </section>
  );
}

export function PrivacyFull() {
  return (
    <section className={s.section}>
      <h3 className={s.h}>{t("legal.privacyTitle")}</h3>
      <p className={s.body}>{t("legal.privacySummary")}</p>
      <p className={s.body}>{t("legal.privacyVisible")}</p>
      <p className={s.body}>{t("legal.privacyNever")}</p>
    </section>
  );
}
