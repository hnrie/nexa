import { Clock, LogOut, MessagesSquare, ShieldAlert } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { nexa as nexaApi } from "@/api/moderation";
import { NexaWordmark } from "@/components/common/Brand";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { LockNote, ThreadChat } from "@/components/nexa/ThreadChat";
import { NoticeCard } from "@/components/nexa/NoticeCard";
import { fullDate, relativeTo } from "@/lib/moderation";
import { useAuth } from "@/stores/auth";
import { useBan, useNexa } from "@/stores/nexa";
import { t } from "@/i18n";
import s from "@/components/nexa/Nexa.module.css";
import { usePageTitle } from "./AuthLayout";

/** How often the ban screen asks whether the ban still holds, and for new replies. */
const STANDING_EVERY = 30_000;
const THREAD_EVERY = 15_000;

/**
 * What a banned account sees instead of the app: why, by whom, until when,
 * and its case thread, where it can appeal. There is no live connection while
 * banned, so this asks the server itself — and the moment the ban is lifted or
 * runs out, the app comes back on its own.
 */
export default function BannedPage() {
  const ban = useBan();
  const logout = useAuth((a) => a.logout);
  const caseId = ban?.case_id ?? "";
  const thread = useNexa((n) => (caseId ? n.threads[caseId] : undefined));
  const people = useNexa((n) => n.people);
  const pendingBan = useNexa((n) => !!caseId && !!n.state?.pending.some((c) => c.id === caseId));
  usePageTitle(t("nexa.ban.title"));

  useEffect(() => {
    const refresh = () =>
      nexaApi
        .state()
        .then((r) => useNexa.getState().setState(r.state))
        .catch(() => undefined);
    const onShow = () => document.visibilityState === "visible" && void refresh();
    const h = setInterval(refresh, STANDING_EVERY);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(h);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);

  useEffect(() => {
    if (!caseId) return;
    const load = () => void useNexa.getState().loadThread(caseId).catch(() => undefined);
    load();
    const h = setInterval(load, THREAD_EVERY);
    return () => clearInterval(h);
  }, [caseId]);

  // this page says everything the pop-up would; it counts as read
  useEffect(() => {
    if (pendingBan) void useNexa.getState().ack(caseId).catch(() => undefined);
  }, [pendingBan, caseId]);

  return (
    <main className={s.banPage} data-testid="banned-page">
      <div className={s.banColumn}>
        <div className={s.banTop}>
          <NexaWordmark height={28} />
          <span className={s.spacer} />
          <Button size="sm" variant="ghost" onClick={() => void logout()}>
            <LogOut size={16} aria-hidden="true" /> {t("settings.settings.logOut")}
          </Button>
        </div>
        <div className={s.banHero}>
          <h1 className={s.banTitle}>{t("nexa.ban.title")}</h1>
          <p className={s.banLead}>{ban?.expires_at === null ? t("nexa.ban.leadPermanent") : t("nexa.ban.lead")}</p>
          {ban?.expires_at ? (
            <span className={s.banCountdown}>
              <Clock size={16} aria-hidden="true" />
              {t("nexa.ban.endsAt", { when: fullDate(ban.expires_at), rel: relativeTo(ban.expires_at) })}
            </span>
          ) : null}
        </div>
        {thread ? <NoticeCard c={thread.case} people={people} perspective="member" /> : <Spinner label={t("chat.pins.loading")} />}
        {thread ? (
          <section className={s.banThread} aria-label={t("nexa.ban.appealTitle")}>
            <div className={s.banThreadHead}>
              <MessagesSquare size={18} aria-hidden="true" />
              {t("nexa.ban.appealTitle")}
            </div>
            <ThreadChat
              lines={thread.messages}
              people={people}
              perspective="member"
              fileKind="cases"
              action="ban"
              onSend={thread.case.status === "closed" ? undefined : (body, files) => useNexa.getState().reply(caseId, body, files)}
              upload={nexaApi.upload}
              locked={thread.case.status === "closed" ? <LockNote text={t("nexa.thread.closedMember")} /> : undefined}
              note={
                thread.case.status === "closed" ? undefined : (
                  <>
                    <ShieldAlert size={14} aria-hidden="true" />
                    {t("nexa.chat.notE2E")}
                  </>
                )
              }
              placeholder={t("nexa.thread.placeholder")}
              dropName={t("nexa.ban.appealTitle")}
              onSeen={() => useNexa.getState().markThreadRead(caseId)}
            />
          </section>
        ) : null}
        <p className={s.banFine}>
          {t("nexa.ban.fine")} <Link to="/terms">{t("legal.termsTitle")}</Link> · <Link to="/privacy">{t("legal.privacyTitle")}</Link>
        </p>
      </div>
    </main>
  );
}
