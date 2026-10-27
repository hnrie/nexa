import { useMediaAnimation } from "@/lib/mediaAnimation";
import { Check } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { webhooks as webhooksApi } from "@/api/webhooks";
import type { PollTally } from "@/api/types";
import { emojiUrl } from "@/api/users";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { Twemoji } from "@/components/common/Twemoji";
import { portalRoot } from "@/hooks/usePortalRoot";
import { describeError } from "@/lib/errors";
import type { HookPoll as Poll, HookPollAnswer } from "@/lib/webhookMessage";
import { useMessages } from "@/stores/messages";
import { useUI } from "@/stores/ui";
import { displayName, fetchMissingUsers, useUsers } from "@/stores/users";
import s from "./Webhook.module.css";

import { t } from "@/i18n";

/** How long is left, in the largest whole unit: "2 days left", "5 hours left", "Ends soon". */
export function timeLeft(expiry: number, now: number): string {
  const ms = expiry - now;
  if (ms <= 60_000) return t("poll.endsSoon");
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return t("poll.minutesLeft", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("poll.hoursLeft", { count: hours });
  return t("poll.daysLeft", { count: Math.floor(hours / 24) });
}

/** Whole percents of the votes, for the bar and the number beside it. */
export function percents(tally: PollTally | undefined): Map<number, number> {
  const out = new Map<number, number>();
  const total = tally?.answer_counts.reduce((n, a) => n + a.count, 0) ?? 0;
  for (const a of tally?.answer_counts ?? []) out.set(a.id, total ? Math.round((a.count / total) * 100) : 0);
  return out;
}

function AnswerEmoji({ a }: { a: HookPollAnswer }) {
  useMediaAnimation();
  if (!a.emoji) return null;
  return (
    <span className={s.answerEmoji} aria-hidden="true">
      {a.emoji.id ? <img src={emojiUrl(a.emoji.id, !!a.emoji.animated, 22)} alt="" loading="lazy" /> : a.emoji.name ? <Twemoji text={a.emoji.name} /> : null}
    </span>
  );
}

/**
 * A poll: a webhook's, or a person's in the same shape (lib/poll.ts). Pick an
 * answer (or several, where the poll allows it) and vote; until then the
 * results stay hidden unless asked for. Once voted, or once it has closed,
 * each answer shows its share of the votes, and a click on the count lists
 * who picked it. A read-only poll (one still on its way to the server) takes
 * no votes yet.
 */
export function HookPoll({ poll, tally, channelId, messageId, readOnly = false }: { poll: Poll; tally: PollTally | undefined; channelId: string; messageId: string; readOnly?: boolean }) {
  const toast = useUI((u) => u.toast);
  const [now, setNow] = useState(() => Date.now());
  const [picked, setPicked] = useState<number[]>([]);
  const [peek, setPeek] = useState(false);
  const [busy, setBusy] = useState(false);
  const [voters, setVoters] = useState<{ answer: HookPollAnswer; anchor: HTMLElement } | null>(null);
  const expiry = tally?.expires_at ?? poll.expiry;
  const closed = !!tally?.is_finalized || (expiry > 0 && expiry <= now);
  const mine = new Set((tally?.answer_counts ?? []).filter((a) => a.me_voted).map((a) => a.id));
  const voted = mine.size > 0;
  const results = closed || voted || peek;
  const pct = percents(tally);
  const counts = new Map((tally?.answer_counts ?? []).map((a) => [a.id, a.count]));
  const top = Math.max(0, ...counts.values());
  const totalVoters = tally?.total_voters ?? 0;

  useEffect(() => {
    if (closed || !expiry) return;
    // the time left is shown to the minute
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [closed, expiry]);

  const send = async (ids: number[]) => {
    setBusy(true);
    try {
      const next = await webhooksApi.vote(channelId, messageId, ids);
      useMessages.getState().setPollResults(channelId, messageId, next);
      setPicked([]);
      setPeek(false);
    } catch (err) {
      toast(describeError(err, t("poll.voteFailed")), "error");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: number) => {
    if (results || busy || readOnly) return;
    setPicked((cur) => (poll.allow_multiselect ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : cur.includes(id) ? [] : [id]));
  };

  return (
    <div className={s.poll} role="group" aria-label={poll.question} data-testid="webhook-poll">
      <div className={s.question} dir="auto">{poll.question}</div>
      <div className={s.pollHint}>{closed ? t("poll.closed") : poll.allow_multiselect ? t("poll.selectMany") : t("poll.selectOne")}</div>
      <div className={s.answers} role={results ? undefined : poll.allow_multiselect ? "group" : "radiogroup"}>
        {poll.answers.map((a) => {
          const share = pct.get(a.answer_id) ?? 0;
          const count = counts.get(a.answer_id) ?? 0;
          const checked = picked.includes(a.answer_id);
          const win = closed && top > 0 && count === top;
          if (results) {
            return (
              <div key={a.answer_id} className={s.answer} data-results="true" data-mine={mine.has(a.answer_id)} data-win={win} data-testid="poll-answer">
                <span className={s.answerFill} style={{ width: `${share}%` }} aria-hidden="true" />
                <AnswerEmoji a={a} />
                <span className={s.answerText} dir="auto">{a.text}</span>
                <span className={s.answerStat}>
                  {mine.has(a.answer_id) ? <Check size={16} aria-label={t("poll.yourVote")} /> : null}
                  <button type="button" className={s.pollLink} onClick={(e) => setVoters({ answer: a, anchor: e.currentTarget })} aria-label={t("poll.votesFor", { count, answer: a.text })}>
                    {t("poll.percent", { percent: share })}
                  </button>
                </span>
              </div>
            );
          }
          return (
            <button
              key={a.answer_id}
              type="button"
              className={s.answer}
              role={poll.allow_multiselect ? "checkbox" : "radio"}
              aria-checked={checked}
              onClick={() => toggle(a.answer_id)}
              disabled={busy || readOnly}
              data-testid="poll-answer"
            >
              <AnswerEmoji a={a} />
              <span className={s.answerText} dir="auto">{a.text}</span>
              <span className={s.check} data-multi={poll.allow_multiselect} aria-hidden="true">{checked ? <Check size={14} strokeWidth={3} /> : null}</span>
            </button>
          );
        })}
      </div>
      <div className={s.pollFoot}>
        <span>{t("poll.votes", { count: totalVoters })}</span>
        <span aria-hidden="true">•</span>
        <span>{closed ? t("poll.closed") : expiry ? timeLeft(expiry, now) : ""}</span>
        <span className={s.pollActions}>
          {closed || readOnly ? null : voted ? (
            <button type="button" className={s.pollLink} disabled={busy} onClick={() => void send([])} data-testid="poll-remove-vote">
              {t("poll.removeVote")}
            </button>
          ) : peek ? (
            <button type="button" className={s.pollLink} onClick={() => setPeek(false)}>{t("poll.backToVoting")}</button>
          ) : (
            <>
              <button type="button" className={s.pollLink} onClick={() => setPeek(true)} data-testid="poll-show-results">{t("poll.showResults")}</button>
              <Button size="sm" disabled={!picked.length} loading={busy} onClick={() => void send(picked)} data-testid="poll-vote">{t("poll.vote")}</Button>
            </>
          )}
        </span>
      </div>
      {voters ? <Voters channelId={channelId} messageId={messageId} answer={voters.answer} anchor={voters.anchor} onClose={() => setVoters(null)} /> : null}
    </div>
  );
}

/** Who picked one answer, in a small card beside its count. */
function Voters({ channelId, messageId, answer, anchor, onClose }: { channelId: string; messageId: string; answer: HookPollAnswer; anchor: HTMLElement; onClose: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  const [ids, setIds] = useState<string[] | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const users = useUsers((u) => u.byId);
  useEffect(() => {
    let alive = true;
    webhooksApi
      .voters(channelId, messageId, answer.answer_id)
      .then((r) => {
        if (!alive) return;
        fetchMissingUsers(r.users);
        setIds(r.users);
      })
      .catch(() => alive && setIds([]));
    return () => {
      alive = false;
    };
  }, [channelId, messageId, answer.answer_id]);
  const place = useCallback(() => {
    const box = card.current?.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    if (!box) return;
    const top = a.bottom + 6 + box.height > window.innerHeight ? a.top - box.height - 6 : a.bottom + 6;
    setAt({ left: Math.max(4, Math.min(a.right - box.width, window.innerWidth - box.width - 4)), top: Math.max(4, top) });
  }, [anchor]);
  useLayoutEffect(place, [place, ids]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (card.current?.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={card} className={s.voters} role="dialog" aria-label={t("poll.votersFor", { answer: answer.text })} style={at ?? { left: -9999, top: -9999 }} data-testid="poll-voters">
      <div className={s.voterHead}>{answer.text}</div>
      {ids === null ? (
        <Spinner size={16} />
      ) : ids.length === 0 ? (
        <div className={s.votersEmpty}>{t("poll.noVotes")}</div>
      ) : (
        ids.map((id) => (
          <div key={id} className={s.voter}>
            <Avatar id={id} avatarId={users[id]?.avatar_id ?? null} name={displayName(users[id])} size={24} />
            <span dir="auto">{displayName(users[id])}</span>
          </div>
        ))
      )}
    </div>,
    portalRoot(),
  );
}
