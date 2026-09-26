import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { idTime } from "@/lib/ids";
import { useInterrupt } from "@/lib/interrupt";
import { onTermsAccepted, termsAccepted } from "@/lib/legal";
import { laterRelease, parseRelease, releaseDate, unseenReleases, type Release } from "@/lib/whatsNew";
import { useAuth } from "@/stores/auth";
import { useSettings } from "@/stores/settings";
import { t, useLocale } from "@/i18n";
import s from "./WhatsNew.module.css";

/**
 * Marks these releases as seen for the account. The marker only moves
 * forward, so a device still on an older build cannot bring a newer release
 * back for the others.
 */
export function markSeen(releases: Release[]): void {
  const newest = releases[0]?.id ?? null;
  const settings = useSettings.getState();
  const now = settings.settings.whatsNewSeen;
  const next = laterRelease(now, newest);
  if (next !== now) settings.patch({ whatsNewSeen: next });
}

/**
 * Releases of one day ("2026-09-26", then "2026-09-26.2") read as that day's
 * list under one date, newest first, rather than as two headings saying the
 * same thing.
 */
function byDay(releases: Release[]): Release[] {
  const out: Release[] = [];
  for (const r of releases) {
    const last = out[out.length - 1];
    const day = parseRelease(r.id)?.day;
    if (last && day !== undefined && parseRelease(last.id)?.day === day) out[out.length - 1] = { id: last.id, items: [...last.items, ...r.items] };
    else out.push(r);
  }
  return out;
}

/** The releases' features, newest release first. `intro` says Nexa has just been updated. */
export function WhatsNewDialog({ releases, intro = false, onClose }: { releases: Release[]; intro?: boolean; onClose: () => void }) {
  const locale = useLocale();
  const baseId = useId();
  const content = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const days = useMemo(() => byDay(releases), [releases]);
  // the dialog's body is what scrolls; once it has, a line sets the title apart from what passes under it
  useEffect(() => {
    const body = content.current?.parentElement;
    if (!body) return;
    const look = () => setScrolled(body.scrollTop > 2);
    body.addEventListener("scroll", look, { passive: true });
    return () => body.removeEventListener("scroll", look);
  }, []);
  return (
    <Modal
      open
      centered
      onClose={onClose}
      title={t("whatsNew.title")}
      width={560}
      footer={
        <Button onClick={onClose} className={s.done} data-testid="whats-new-done">
          {t("whatsNew.gotIt")}
        </Button>
      }
    >
      <div ref={content} data-testid="whats-new">
        <div className={s.edge} data-on={scrolled || undefined} aria-hidden="true" />
        {intro ? <p className={s.intro}>{t("whatsNew.intro")}</p> : null}
        {days.map((r) => (
          <section key={r.id} className={s.release} aria-labelledby={`${baseId}-${r.id}`} data-release={r.id}>
            <h3 className={s.date} id={`${baseId}-${r.id}`}>
              {releaseDate(r.id, locale)}
            </h3>
            <ul className={s.items}>
              {r.items.map(({ icon: Icon, title, body }) => (
                <li key={title} className={s.item}>
                  <span className={s.icon} aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <div className={s.text}>
                    <h4 className={s.itemTitle}>{t(title)}</h4>
                    <p className={s.itemBody}>{t(body)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}

/**
 * Shows an account what changed, once, the first time it opens the app after
 * an update: only releases it has not seen on any device, only those newer
 * than the account itself, never over the Terms and never while someone is
 * writing or reading another dialog.
 */
export function WhatsNew() {
  const me = useAuth((a) => a.me);
  const loaded = useSettings((st) => st.loaded);
  const seen = useSettings((st) => st.settings.whatsNewSeen);
  const agreed = useSyncExternalStore(onTermsAccepted, () => !!me && termsAccepted(me.id));
  // Before the account's settings arrive, what it has seen is not known yet.
  const due = useMemo(() => (me && loaded && agreed ? unseenReleases(seen, idTime(me.id)) : []), [me, loaded, agreed, seen]);
  const [shown, setShown] = useState<Release[] | null>(null);
  const open = useInterrupt("whatsNew", due.length > 0 || shown !== null);
  // What opens is fixed as it opens, so it stays put while it is read,
  // whatever another device marks as seen meanwhile.
  if (open && !shown && due.length > 0) setShown(due);
  if (!open || !shown) return null;
  const close = () => {
    markSeen(shown);
    setShown(null);
  };
  return <WhatsNewDialog releases={shown} intro onClose={close} />;
}
