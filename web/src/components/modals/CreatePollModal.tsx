import { Plus, SmilePlus, Trash2, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { emojiUrl } from "@/api/users";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Select } from "@/components/common/Select";
import { Field, TextInput } from "@/components/common/TextInput";
import { Twemoji } from "@/components/common/Twemoji";
import { sendPoll } from "@/components/composer/send";
import { ExpressionPicker } from "@/components/pickers/ExpressionPicker";
import { POLL_ANSWER_MAX, POLL_ANSWERS_MAX, POLL_ANSWERS_MIN, POLL_QUESTION_MAX, type PollEmoji, type PollPayload } from "@/crypto/message";
import { DEFAULT_POLL_HOURS, POLL_DURATIONS } from "@/lib/poll";
import { useChannels } from "@/stores/channels";
import s from "./CreatePollModal.module.css";

import { t } from "@/i18n";

interface Row {
  key: number;
  text: string;
  emoji?: PollEmoji;
}

/** A poll's length as the dialog lists it: in weeks, days or hours, whichever is whole. */
export function durationLabel(hours: number): string {
  if (hours % 168 === 0) return t("nexa.span.weeks", { count: hours / 168 });
  if (hours % 24 === 0) return t("nexa.span.days", { count: hours / 24 });
  return t("nexa.span.hours", { count: hours });
}

/**
 * The poll the dialog would post, or null while it cannot be posted: it
 * needs a question and two answers. An answer left empty is left out.
 */
export function pollFromForm(question: string, rows: { text: string; emoji?: PollEmoji | undefined }[], hours: number, multiselect: boolean): PollPayload | null {
  const q = question.trim();
  const answers = rows
    .filter((r) => r.text.trim())
    .slice(0, POLL_ANSWERS_MAX)
    .map((r) => ({ text: r.text.trim(), ...(r.emoji ? { emoji: r.emoji } : {}) }));
  if (!q || answers.length < POLL_ANSWERS_MIN) return null;
  return { question: q, answers, hours, multiselect };
}

/**
 * Asks a poll in a channel: a question, two to ten answers (each with an
 * emoji, if wanted), how long it runs, and whether more than one answer may
 * be picked. Posting sends it like a message, sealed, and closes the dialog;
 * the poll shows in the list at once and settles there.
 */
export function CreatePollModal({ onClose, channelId }: { onClose: () => void; channelId: string }) {
  const serverId = useChannels((c) => c.byId[channelId]?.server_id ?? null);
  const [question, setQuestion] = useState("");
  const [rows, setRows] = useState<Row[]>([
    { key: 1, text: "" },
    { key: 2, text: "" },
  ]);
  const nextKey = useRef(3);
  const [hours, setHours] = useState<number>(DEFAULT_POLL_HOURS);
  const [multi, setMulti] = useState(false);
  const [picker, setPicker] = useState<{ key: number; anchor: DOMRect } | null>(null);
  // The picker closes itself on any press outside it, its own button included,
  // before the click lands: remember it was open, so that click closes it.
  const pickerWasOpen = useRef(false);
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const poll = pollFromForm(question, rows, hours, multi);

  const post = () => {
    if (!poll) return;
    onClose();
    // a poll that fails to go stays in the list, with Retry, as a message does
    void sendPoll(channelId, poll).catch(() => undefined);
  };
  const setRow = (key: number, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const focusRow = (key: number | undefined) => requestAnimationFrame(() => (key === undefined ? undefined : inputs.current.get(key)?.focus()));
  const addRow = () => {
    if (rows.length >= POLL_ANSWERS_MAX) return;
    const key = nextKey.current++;
    setRows((list) => [...list, { key, text: "" }]);
    focusRow(key);
  };
  const removeRow = (i: number) => {
    const next = rows.filter((_, j) => j !== i);
    setRows(next);
    // the next answer up, or the one that took this one's place
    focusRow((next[i] ?? next[i - 1])?.key);
  };
  const onEnter = (e: KeyboardEvent<HTMLInputElement>, then: () => void) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    then();
  };
  const withoutEmoji = ({ emoji: _, ...rest }: Row): Row => rest;

  return (
    <Modal
      open
      onClose={onClose}
      title={t("poll.create.title")}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("chat.editMessage.cancel")}</Button>
          <Button onClick={post} disabled={!poll} data-testid="poll-post">{t("poll.create.post")}</Button>
        </>
      }
    >
      <div className={s.form}>
        <Field label={t("poll.create.question")} required>
          <TextInput
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t("poll.create.questionPlaceholder")}
            maxLength={POLL_QUESTION_MAX}
            enterKeyHint="next"
            onKeyDown={(e) => onEnter(e, () => focusRow(rows[0]?.key))}
            data-testid="poll-question"
          />
        </Field>
        <Field as="div" label={t("poll.create.answers")}>
          <div className={s.answers}>
            {rows.map((r, i) => (
              <div key={r.key} className={s.answer} data-testid="poll-answer-row">
                <div className={s.emojiPick}>
                  <button
                    type="button"
                    className={s.emojiBtn}
                    aria-label={r.emoji ? t("poll.create.changeEmoji", { number: i + 1 }) : t("poll.create.addEmoji", { number: i + 1 })}
                    aria-haspopup="dialog"
                    data-picker-toggle={picker?.key === r.key ? true : undefined}
                    onMouseDown={() => {
                      pickerWasOpen.current = picker?.key === r.key;
                    }}
                    onClick={(e) => {
                      const wasOpen = pickerWasOpen.current || picker?.key === r.key;
                      pickerWasOpen.current = false;
                      setPicker(wasOpen ? null : { key: r.key, anchor: e.currentTarget.getBoundingClientRect() });
                    }}
                  >
                    {r.emoji ? (
                      r.emoji.id ? <img className={s.emojiImg} src={emojiUrl(r.emoji.id, !!r.emoji.animated, 24)} alt="" /> : <Twemoji text={r.emoji.name} className={s.emojiImg} title="" />
                    ) : (
                      <SmilePlus size={20} />
                    )}
                  </button>
                  {r.emoji ? (
                    <button type="button" className={s.emojiClear} aria-label={t("poll.create.removeEmoji", { number: i + 1 })} onClick={() => setRows((list) => list.map((x) => (x.key === r.key ? withoutEmoji(x) : x)))}>
                      <X size={12} />
                    </button>
                  ) : null}
                </div>
                <TextInput
                  ref={(el) => {
                    if (el) inputs.current.set(r.key, el);
                    else inputs.current.delete(r.key);
                  }}
                  className={s.answerInput}
                  value={r.text}
                  onChange={(e) => setRow(r.key, { text: e.target.value })}
                  placeholder={t("poll.create.answerPlaceholder")}
                  aria-label={t("poll.create.answerNumber", { number: i + 1 })}
                  maxLength={POLL_ANSWER_MAX}
                  enterKeyHint={i < rows.length - 1 ? "next" : "done"}
                  onKeyDown={(e) => onEnter(e, () => (i < rows.length - 1 ? focusRow(rows[i + 1]?.key) : post()))}
                  data-testid="poll-answer-input"
                />
                {rows.length > POLL_ANSWERS_MIN ? (
                  <button type="button" className={s.remove} aria-label={t("poll.create.removeAnswer", { number: i + 1 })} onClick={() => removeRow(i)}>
                    <Trash2 size={16} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {rows.length < POLL_ANSWERS_MAX ? (
            <Button variant="ghost" size="sm" className={s.add} onClick={addRow} data-testid="poll-add-answer">
              <Plus size={16} aria-hidden="true" /> {t("poll.create.addAnswer")}
            </Button>
          ) : null}
        </Field>
        <Field label={t("poll.create.duration")}>
          <Select value={hours} onChange={(e) => setHours(Number(e.target.value))} data-testid="poll-duration">
            {POLL_DURATIONS.map((h) => (
              <option key={h} value={h}>{durationLabel(h)}</option>
            ))}
          </Select>
        </Field>
        <label className={s.check}>
          <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} data-testid="poll-multi" />
          <span>{t("poll.create.multiselect")}</span>
        </label>
      </div>
      {picker ? (
        <ExpressionPicker
          anchor={picker.anchor}
          serverId={serverId}
          // an answer is seen by everyone who can read the channel: nothing from elsewhere
          onlyServer
          onClose={() => setPicker(null)}
          onEmoji={(e) => {
            const emoji: PollEmoji = e.custom ? { id: e.custom.id, name: e.custom.name, ...(e.custom.animated ? { animated: true } : {}) } : { name: e.unicode };
            setRow(picker.key, { emoji });
            setPicker(null);
          }}
        />
      ) : null}
    </Modal>
  );
}
