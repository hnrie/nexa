import { Info, LockOpen, Megaphone } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { FeedItem, People } from "@/api/moderation";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { NexaAvatar, OfficialBadge, PersonChip } from "@/components/nexa/NexaBits";
import { NoticeCard } from "@/components/nexa/NoticeCard";
import { PageHeaderButtons } from "@/components/shell/PageHeader";
import { useRenderCtx } from "@/lib/markdownCtx";
import { fullDate } from "@/lib/moderation";
import { formatTimestamp } from "@/lib/time";
import { Markdown } from "@/markdown";
import { useNexa } from "@/stores/nexa";
import { t } from "@/i18n";
import s from "@/components/nexa/Nexa.module.css";

/**
 * The Nexa conversation: what the moderation team has sent this account —
 * notices about actions on it, lifted mutes and bans, and announcements to
 * everyone. Nobody replies here; each notice opens onto its own case thread.
 */
export default function NexaPage() {
  const nav = useNavigate();
  const feed = useNexa((n) => n.feed);
  const more = useNexa((n) => n.feedMore);
  const loading = useNexa((n) => n.feedLoading);
  const people = useNexa((n) => n.people);
  const unread = useNexa((n) => n.state?.unread ?? 0);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    if (feed === null) void useNexa.getState().loadFeed().catch(() => undefined);
  }, [feed]);
  // looking at the conversation is reading it
  useEffect(() => {
    if (feed !== null && unread > 0) useNexa.getState().markSeen();
  }, [feed, unread]);

  const newest = feed?.[feed.length - 1];
  const newestKey = newest ? `${newest.kind}:${newest.at}` : "";
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [newestKey]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
  };

  const loadOlder = async () => {
    const el = scroller.current;
    const before = el ? el.scrollHeight - el.scrollTop : 0;
    await useNexa.getState().loadOlder();
    // keep the reader where they were rather than jumping to the new top
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - before;
    });
  };

  return (
    <div className={s.page} data-testid="nexa-page">
      <header className={s.header}>
        <PageHeaderButtons />
        <NexaAvatar size={24} />
        <span className={s.headerName}>Nexa</span>
        <OfficialBadge />
        <span className={s.headerSub}>{t("nexa.headerSub")}</span>
      </header>
      <div className={s.feed} ref={scroller} onScroll={onScroll}>
        {more ? (
          <div className={s.more}>
            <Button size="sm" variant="ghost" loading={loading} onClick={() => void loadOlder()}>
              {t("nexa.loadOlder")}
            </Button>
          </div>
        ) : (
          <div className={s.intro}>
            <NexaAvatar size={80} />
            <h1 className={s.introTitle}>
              Nexa <OfficialBadge />
            </h1>
            <p className={s.introText}>{t("nexa.intro")}</p>
          </div>
        )}
        {feed === null ? (
          <div className={s.more}>
            <Spinner label={t("chat.pins.loading")} />
          </div>
        ) : feed.length === 0 ? (
          <p className={s.empty}>{t("nexa.empty")}</p>
        ) : (
          feed.map((it) => <FeedEntry key={it.kind === "announcement" ? `a${it.announcement.id}` : `${it.kind}${it.case.id}`} item={it} people={people} onOpen={(id) => nav(`/channels/@me/nexa/cases/${id}`)} />)
        )}
      </div>
      <p className={s.systemFooter} role="note">
        <Info size={18} aria-hidden="true" />
        {t("nexa.footer")}
      </p>
    </div>
  );
}

function FeedEntry({ item, people, onOpen }: { item: FeedItem; people: People; onOpen: (caseId: string) => void }) {
  const ctx = useRenderCtx();
  const kind = item.kind === "announcement" ? t("nexa.kind.announcement") : item.kind === "lift" ? t("nexa.kind.update") : t("nexa.kind.notice");
  return (
    <article className={s.feedItem} data-kind={item.kind} data-testid={`nexa-item-${item.kind}`}>
      <NexaAvatar size={40} />
      <div className={s.feedBody}>
        <div className={s.feedHead}>
          <span className={s.lineName}>Nexa</span>
          <OfficialBadge compact />
          <span className={s.feedKind}>{kind}</span>
          <time className={s.lineTime} dateTime={new Date(item.at).toISOString()} title={fullDate(item.at)}>
            {formatTimestamp(item.at)}
          </time>
        </div>
        {item.kind === "notice" ? <NoticeCard c={item.case} people={people} perspective="member" onOpenThread={() => onOpen(item.case.id)} /> : null}
        {item.kind === "lift" ? (
          <div className={s.liftItem}>
            <LockOpen size={18} aria-hidden="true" />
            <span>{item.case.action === "ban" ? t("nexa.liftedBan", { number: item.case.number }) : t("nexa.liftedMute", { number: item.case.number })}</span>
            {item.case.lifted_by ? <PersonChip id={item.case.lifted_by} person={people[item.case.lifted_by]} size={16} /> : null}
            {item.case.lift_reason ? <span className={s.liftReason}>“{item.case.lift_reason}”</span> : null}
          </div>
        ) : null}
        {item.kind === "announcement" ? (
          <div className={s.announcement}>
            {item.announcement.title ? (
              <h3 className={s.announcementTitle}>
                <Megaphone size={18} aria-hidden="true" />
                {item.announcement.title}
              </h3>
            ) : null}
            <div className={s.announcementBody}>
              <Markdown source={item.announcement.body} ctx={ctx} />
            </div>
            <div className={s.announcementFoot}>
              {t("nexa.postedBy")} <PersonChip id={item.announcement.author_id} person={people[item.announcement.author_id]} size={18} withUsername />
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}
