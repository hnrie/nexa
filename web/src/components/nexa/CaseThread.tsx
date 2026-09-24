import { CircleCheck, Clock, History, LockOpen, RotateCcw, SendHorizontal, ShieldAlert, type LucideIcon } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { CaseMessage, ModAction, People } from "@/api/moderation";
import { Avatar } from "@/components/common/Avatar";
import { describeError } from "@/lib/errors";
import { useRenderCtx } from "@/lib/markdownCtx";
import { personName, systemLineText } from "@/lib/moderation";
import { formatDateDivider, formatTime, formatTimestamp, sameDay } from "@/lib/time";
import { Markdown } from "@/markdown";
import { useUI } from "@/stores/ui";
import { t } from "@/i18n";
import { NexaAvatar, OfficialBadge } from "./NexaBits";
import s from "./Nexa.module.css";

/** The most a line can hold; the server refuses anything longer. */
export const MAX_CASE_MESSAGE = 2000;
/** Lines from the same writer this close together share one header. */
const GROUP_GAP = 7 * 60_000;

interface Props {
  messages: CaseMessage[];
  people: People;
  perspective: "member" | "staff";
  action: ModAction;
  /** Shown above the first line: the case itself. */
  header?: ReactNode;
  /** Sends a line; the composer is left out without it. */
  onSend?: (body: string) => Promise<void>;
  /** Said over the composer, about who reads what is written here. */
  composerNote?: ReactNode;
  /** Replaces the composer with this sentence when writing is not possible. */
  closedNote?: string;
  /** Called when the newest line is on screen, so it can be marked read. */
  onSeen?: () => void;
}

/**
 * A case's thread: the member, the staff (who write as Nexa, with their own
 * name shown), and a line for everything that happened to the case.
 */
export function CaseThread({ messages, people, perspective, action, header, onSend, composerNote, closedNote, onSeen }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const seenRef = useRef(onSeen);
  seenRef.current = onSeen;
  const last = messages[messages.length - 1]?.id;

  // Follow new lines while the reader is at the bottom; leave them alone when
  // they have scrolled up to read something earlier.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [last, header]);
  useEffect(() => {
    if (atBottom.current) seenRef.current?.();
  }, [last]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (bottom && !atBottom.current) seenRef.current?.();
    atBottom.current = bottom;
  };

  return (
    <div className={s.thread}>
      <div className={s.threadScroll} ref={scroller} onScroll={onScroll} data-testid="case-thread">
        {header ? <div className={s.threadHeader}>{header}</div> : null}
        {messages.length === 0 ? <p className={s.threadEmpty}>{perspective === "member" ? t("nexa.thread.emptyMember") : t("nexa.thread.emptyStaff")}</p> : null}
        <ol className={s.lines}>
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || !sameDay(prev.created_at, m.created_at);
            const grouped = !!prev && !newDay && m.kind !== "system" && prev.kind === m.kind && prev.author_id === m.author_id && m.created_at - prev.created_at < GROUP_GAP;
            return (
              <Fragment key={m.id}>
                {newDay ? (
                  <li className={s.dayDivider} role="separator">
                    <span>{formatDateDivider(m.created_at)}</span>
                  </li>
                ) : null}
                {m.kind === "system" ? (
                  <SystemLine m={m} people={people} action={action} perspective={perspective} />
                ) : (
                  <Line m={m} people={people} perspective={perspective} grouped={grouped} />
                )}
              </Fragment>
            );
          })}
        </ol>
      </div>
      {onSend ? <Composer onSend={onSend} note={composerNote} /> : closedNote ? <p className={s.threadClosed}>{closedNote}</p> : null}
    </div>
  );
}

function Line({ m, people, perspective, grouped }: { m: CaseMessage; people: People; perspective: "member" | "staff"; grouped: boolean }) {
  const ctx = useRenderCtx();
  const openModal = useUI((u) => u.openModal);
  const author = people[m.author_id];
  const staff = m.kind === "staff";
  // The member reads staff replies as Nexa's, with the name of whoever wrote
  // them; the staff see each other as themselves.
  const asNexa = staff && perspective === "member";
  const name = asNexa ? "Nexa" : personName(author);
  const openAuthor = () => author && !author.deleted && openModal("profile", { userId: m.author_id });
  return (
    <li className={s.line} data-grouped={grouped || undefined} data-kind={m.kind} data-testid={`case-line-${m.kind}`}>
      {grouped ? (
        <time className={s.lineGutter} dateTime={new Date(m.created_at).toISOString()} title={formatTimestamp(m.created_at)}>
          {formatTime(m.created_at)}
        </time>
      ) : (
        <span className={s.lineAvatar}>
          {asNexa ? (
            <NexaAvatar size={36} />
          ) : (
            <button type="button" className={s.bare} onClick={openAuthor} aria-label={name}>
              <Avatar id={m.author_id} avatarId={author?.avatar_id ?? null} name={name} size={36} />
            </button>
          )}
        </span>
      )}
      <div className={s.lineBody}>
        {!grouped ? (
          <div className={s.lineHead}>
            {asNexa ? (
              <>
                <span className={s.lineName}>Nexa</span>
                <OfficialBadge compact />
                <span className={s.staffCredit}>
                  {t("nexa.thread.sentBy")}{" "}
                  <button type="button" className={s.inlineLink} onClick={openAuthor}>
                    {personName(author)}
                  </button>
                </span>
              </>
            ) : (
              <>
                <button type="button" className={[s.lineName, s.inlineLink].join(" ")} onClick={openAuthor}>
                  {name}
                </button>
                {staff ? <span className={s.staffTag}>{t("nexa.thread.asNexa")}</span> : null}
              </>
            )}
            <time className={s.lineTime} dateTime={new Date(m.created_at).toISOString()}>
              {formatTimestamp(m.created_at)}
            </time>
          </div>
        ) : null}
        <div className={s.lineText}>
          <Markdown source={m.body} ctx={ctx} />
        </div>
      </div>
    </li>
  );
}

const SYSTEM_ICONS: Record<string, LucideIcon> = { lifted: LockOpen, closed: CircleCheck, reopened: RotateCcw, expired: Clock, replaced: ShieldAlert };

function SystemLine({ m, people, action, perspective }: { m: CaseMessage; people: People; action: ModAction; perspective: "member" | "staff" }) {
  const Icon = SYSTEM_ICONS[m.event] ?? History;
  const icon = <Icon size={16} />;
  const text = systemLineText(m, people, action, perspective);
  return (
    <li className={s.systemLine} data-event={m.event}>
      <span className={s.systemIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={s.systemText}>{text}</span>
      <time className={s.lineTime} dateTime={new Date(m.created_at).toISOString()}>
        {formatTimestamp(m.created_at)}
      </time>
    </li>
  );
}

function Composer({ onSend, note }: { onSend: (body: string) => Promise<void>; note?: ReactNode }) {
  const toast = useUI((u) => u.toast);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const length = [...text].length;
  const over = length > MAX_CASE_MESSAGE;

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const send = async () => {
    const body = text.trim();
    if (!body || over || busy) return;
    setBusy(true);
    try {
      await onSend(body);
      setText("");
    } catch (err) {
      toast(describeError(err, t("nexa.thread.couldNotSend")), "error");
    } finally {
      setBusy(false);
      area.current?.focus();
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className={s.composer}>
      {note ? <p className={s.composerNote}>{note}</p> : null}
      <div className={s.composerBox} data-over={over || undefined}>
        <textarea
          ref={area}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          placeholder={t("nexa.thread.placeholder")}
          aria-label={t("nexa.thread.placeholder")}
          data-testid="case-composer"
          disabled={busy}
        />
        {length > MAX_CASE_MESSAGE - 200 ? <span className={s.counter} data-over={over || undefined}>{MAX_CASE_MESSAGE - length}</span> : null}
        <button type="button" className={s.send} onClick={() => void send()} disabled={!text.trim() || over || busy} aria-label={t("nexa.thread.send")} data-testid="case-send">
          <SendHorizontal size={20} />
        </button>
      </div>
    </div>
  );
}
