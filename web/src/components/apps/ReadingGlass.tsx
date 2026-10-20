import { CornerDownRight, Eye, Lock, TriangleAlert } from "lucide-react";
import { useId } from "react";
import { t } from "@/i18n";
import s from "./ReadingGlass.module.css";

/**
 * What an app can read, shown rather than told: four lines of a
 * conversation, where what the app cannot open is sealed and what is meant
 * for it (a mention of it, a reply to it) is plain. An app that reads every
 * message (the Message Content intent) unseals them all, and the glass says
 * what that costs: the server opens those messages for it, so they are not
 * end-to-end encrypted from it.
 *
 * With `onChange` it is the choice itself, in the Developer Portal; without,
 * it states how an app is, wherever someone decides about it.
 */
export function ReadingGlass({ name, everything, onChange, compact = false }: { name: string; everything: boolean; onChange?: (everything: boolean) => void; compact?: boolean }) {
  const group = useId();
  const lines: { who: string; tone: number; text: string; addressed: boolean; reply?: boolean }[] = [
    { who: t("apps.glass.personA"), tone: 1, text: t("apps.glass.line1"), addressed: false },
    { who: t("apps.glass.personB"), tone: 2, text: t("apps.glass.line2", { app: name }), addressed: true },
    { who: t("apps.glass.personA"), tone: 1, text: t("apps.glass.line3"), addressed: false },
    { who: t("apps.glass.personB"), tone: 2, text: t("apps.glass.line4"), addressed: true, reply: true },
  ];
  return (
    <div className={s.glass} data-everything={everything || undefined} data-compact={compact || undefined} data-testid="reading-glass">
      {onChange ? (
        <div className={s.choices} role="radiogroup" aria-label={t("apps.glass.title", { app: name })}>
          <label className={s.choice} data-on={!everything || undefined}>
            <input type="radio" name={group} checked={!everything} onChange={() => onChange(false)} />
            <span className={s.choiceText}>
              <span className={s.choiceLabel}>{t("apps.glass.addressed")}</span>
              <span className={s.choiceDesc}>{t("apps.glass.addressedDesc")}</span>
            </span>
          </label>
          <label className={s.choice} data-on={everything || undefined} data-warn="">
            <input type="radio" name={group} checked={everything} onChange={() => onChange(true)} data-testid="reads-everything" />
            <span className={s.choiceText}>
              <span className={s.choiceLabel}>{t("apps.glass.everything")}</span>
              <span className={s.choiceDesc}>{t("apps.glass.everythingDesc")}</span>
            </span>
          </label>
        </div>
      ) : (
        <div className={s.state}>
          {everything ? <TriangleAlert size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          <span>{everything ? t("apps.glass.readsEverything", { app: name }) : t("apps.glass.readsAddressed", { app: name })}</span>
        </div>
      )}
      <div className={s.convo} aria-hidden="true">
        {lines.map((l, i) => {
          const open = everything || l.addressed;
          return (
            <div key={i} className={s.line} data-open={open || undefined}>
              <span className={s.dot} data-tone={l.tone} />
              <span className={s.who}>{l.who}</span>
              {l.reply ? <CornerDownRight size={13} className={s.replyMark} /> : null}
              <span className={s.words}>{l.text}</span>
              {open ? null : <Lock size={12} className={s.lock} />}
            </div>
          );
        })}
      </div>
      <p className={s.note}>{everything ? t("apps.glass.everythingNote", { app: name }) : t("apps.glass.addressedNote", { app: name })}</p>
    </div>
  );
}
