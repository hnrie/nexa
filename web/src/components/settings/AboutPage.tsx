import { ArrowLeft, AtSign, Check, ExternalLink, Info, Mail, MessagesSquare, ScrollText, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { admin as adminApi } from "@/api/admin";
import { NexaTile, NexaWordmark } from "@/components/common/Brand";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { LegalHighlights } from "@/components/legal/LegalContent";
import { LegalDocument } from "@/components/legal/LegalDocument";
import { CONTACT_EMAIL, LEGAL_EFFECTIVE, LEGAL_VERSION, OWNER_USERNAME, termsAccepted } from "@/lib/legal";
import { useLegalDocs } from "@/lib/legalDocs";
import { useAuth } from "@/stores/auth";
import { t, useLocale } from "@/i18n";
import s from "./Settings.module.css";
import l from "../legal/Legal.module.css";

type Doc = "terms" | "privacy";

/**
 * Settings → About: what Nexa is, the Terms and Privacy Policy at a glance
 * and in full (readable right here, which the desktop app needs — it has no
 * tabs to open them in), how to reach whoever runs it, and what is running.
 */
export default function AboutPage() {
  const me = useAuth((a) => a.me);
  const [reading, setReading] = useState<Doc | null>(null);
  const [server, setServer] = useState<string | null>(null);
  const docs = useLegalDocs();
  const agreed = !!me && termsAccepted(me.id);
  const locale = useLocale();

  useEffect(() => {
    let alive = true;
    adminApi
      .instance()
      .then((i) => alive && setServer(i.version))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (reading) {
    return (
      <>
        <Button size="sm" variant="ghost" onClick={() => setReading(null)} style={{ marginBottom: 12 }}>
          <ArrowLeft size={16} aria-hidden="true" /> {t("settings.about.back")}
        </Button>
        {docs ? (
          <LegalDocument doc={docs[reading]} />
        ) : (
          <div className={l.loading}>
            <Spinner />
          </div>
        )}
      </>
    );
  }

  const doc = (id: Doc, title: string) => (
    <div className={l.row}>
      <span className={l.rowIcon} aria-hidden="true">
        {id === "terms" ? <ScrollText size={18} /> : <ShieldCheck size={18} />}
      </span>
      <span className={l.rowText}>
        <span className={l.rowTitle}>{title}</span>
        <span className={l.rowSub}>
          {t("settings.about.effective", { date: docs?.[id].effective ?? LEGAL_EFFECTIVE })}
          {agreed ? (
            <>
              {" · "}
              <span className={l.agreed}>
                <Check size={13} aria-hidden="true" />
                {t("settings.about.agreed")}
              </span>
            </>
          ) : null}
        </span>
      </span>
      <Button size="sm" variant="secondary" onClick={() => setReading(id)} data-testid={`about-read-${id}`}>
        {t("settings.about.read")}
      </Button>
    </div>
  );

  return (
    <>
      <h2 className={s.title}>{t("settings.about.title")}</h2>
      <div className={l.aboutHero}>
        <NexaTile size={56} />
        <div className={l.aboutHeroText}>
          <NexaWordmark height={26} />
          <p className={l.aboutLead}>{t("legal.aboutLead")}</p>
        </div>
      </div>

      <section className={l.aboutGroup}>
        <h3 className={l.aboutLabel}>{t("settings.about.glance")}</h3>
        <LegalHighlights />
      </section>

      <section className={l.aboutGroup}>
        <h3 className={l.aboutLabel}>{t("settings.about.documents")}</h3>
        {/* the page around them follows the language; a translated Terms would be a different Terms */}
        {!locale.startsWith("en") ? <p className={s.hint}>{t("settings.about.englishOnly")}</p> : null}
        <div className={l.rows}>
          {doc("terms", t("legal.termsTitle"))}
          {doc("privacy", t("legal.privacyTitle"))}
        </div>
      </section>

      <section className={l.aboutGroup}>
        <h3 className={l.aboutLabel}>{t("settings.about.contact")}</h3>
        <div className={l.rows}>
          <div className={l.row}>
            <span className={l.rowIcon} aria-hidden="true">
              <Mail size={18} />
            </span>
            <span className={l.rowText}>
              <span className={l.rowTitle}>{t("settings.about.email")}</span>
              <span className={l.rowSub}>
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              </span>
            </span>
            <a className={l.rowIcon} href={`mailto:${CONTACT_EMAIL}`} aria-label={t("legal.contactOwner")}>
              <ExternalLink size={16} />
            </a>
          </div>
          <div className={l.row}>
            <span className={l.rowIcon} aria-hidden="true">
              <AtSign size={18} />
            </span>
            <span className={l.rowText}>
              <span className={l.rowTitle}>{t("settings.about.inApp")}</span>
              <span className={l.rowSub}>@{OWNER_USERNAME}</span>
            </span>
          </div>
          <div className={l.row}>
            <span className={l.rowIcon} aria-hidden="true">
              <MessagesSquare size={18} />
            </span>
            <span className={l.rowText}>
              <span className={l.rowTitle}>{t("settings.about.appeals")}</span>
              <span className={l.rowSub}>{t("settings.about.appealsSub")}</span>
            </span>
          </div>
        </div>
      </section>

      <section className={l.aboutGroup}>
        <h3 className={l.aboutLabel}>{t("settings.about.version")}</h3>
        <div className={l.rows}>
          <div className={l.row}>
            <span className={l.rowIcon} aria-hidden="true">
              <Info size={18} />
            </span>
            <span className={l.rowText}>
              <span className={l.rowTitle}>Nexa</span>
              <span className={l.rowSub}>
                {server ? t("settings.about.server", { version: server }) : "…"} · {t("settings.about.terms", { version: LEGAL_VERSION })}
              </span>
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
