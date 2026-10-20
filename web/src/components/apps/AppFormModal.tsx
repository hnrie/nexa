import { FileUp, LockOpen, X } from "lucide-react";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { apps as appsApi, type AppForm, type FormField, type FormPart, type InteractionFile } from "@/api/apps";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextArea, TextInput } from "@/components/common/TextInput";
import { HookTags } from "@/components/chat/webhook/HookHeader";
import { t } from "@/i18n";
import { formatBytes } from "@/lib/time";
import { describeError } from "@/lib/errors";
import { interact } from "@/lib/interactions";
import { findMembers } from "@/lib/pickables";
import { Markdown } from "@/markdown";
import { useRenderCtx } from "@/lib/markdownCtx";
import { displayName, useUsers } from "@/stores/users";
import { entityChoices, entityKindOfComponent, entityLabel } from "./entityChoices";
import { ChoiceGlyph, SelectBox } from "./SelectBox";
import s from "./AppForm.module.css";

// Field types, at the protocol's numbers.
const F_TEXT = 4;
const F_STRING_SELECT = 3;
const F_FILES = 19;
const F_RADIO = 21;
const F_CHECKBOXES = 22;
const F_CHECKBOX = 23;

/** What has been filled into one field. */
type Answer = { value?: string; values?: string[]; checked?: boolean; files?: InteractionFile[] };

function initialAnswer(f: FormField): Answer {
  switch (f.type) {
    case F_TEXT:
      return { value: f.value ?? "" };
    case F_RADIO:
      return { value: f.options?.find((o) => o.default)?.value ?? "" };
    case F_CHECKBOX:
      return { checked: !!f.default };
    case F_FILES:
      return { files: [] };
    case F_STRING_SELECT:
    case F_CHECKBOXES:
      return { values: (f.options ?? []).filter((o) => o.default).map((o) => o.value) };
    default:
      return { values: (f.default_values ?? []).map((d) => d.id) };
  }
}

/** What is wrong with a field's answer, in words, or null. */
function problem(f: FormField, a: Answer): string | null {
  const count = (n: number, defMin: number, defMax: number): string | null => {
    const min = f.min_values ?? defMin;
    const max = f.max_values ?? defMax;
    if (n === 0 && !f.required) return null;
    if (n < min || n > max) return min === max ? t("apps.form.pickExactly", { count: min }) : t("apps.form.pickBetween", { min, max });
    return null;
  };
  switch (f.type) {
    case F_TEXT: {
      const n = [...(a.value ?? "").trim()].length;
      if (n === 0) return f.required ? t("apps.form.required") : null;
      const min = f.min_length ?? 0;
      const max = f.max_length ?? 4000;
      if (n < min) return t("apps.form.tooShort", { count: min });
      if (n > max) return t("apps.form.tooLong", { count: max });
      return null;
    }
    case F_RADIO:
      return f.required && !a.value ? t("apps.form.pickOne") : null;
    case F_CHECKBOX:
      return null;
    case F_FILES:
      return count(a.files?.length ?? 0, 1, 1);
    case F_CHECKBOXES:
      return count(a.values?.length ?? 0, f.required ? 1 : 0, f.options?.length ?? 0);
    default:
      return count(a.values?.length ?? 0, 1, 1);
  }
}

/**
 * A form an app opened, for someone to fill in and send back to it. It says
 * which app asks, and that what is sent is not end-to-end encrypted, since the
 * app reads it as it is. Each field is drawn as the app asked: a line or a box
 * of text, a list to pick from, choices to tick, files.
 */
export function AppFormModal({ form, appId, channelId, interactionId, onClose }: { form: AppForm; appId: string; channelId: string; interactionId: string; onClose: () => void }) {
  const bot = useUsers((u) => u.byId[appId]);
  const appName = displayName(bot, t("apps.anApp"));
  const fields = useMemo(() => form.components.filter((p): p is FormPart & { component: FormField } => !!p.component), [form]);
  const [answers, setAnswers] = useState<Record<string, Answer>>(() => Object.fromEntries(fields.map((p) => [p.component.custom_id, initialAnswer(p.component)])));
  const [shown, setShown] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (id: string, a: Answer) => {
    setAnswers((cur) => ({ ...cur, [id]: a }));
    setShown((cur) => (cur[id] ? { ...cur, [id]: null } : cur));
  };
  const submit = async () => {
    if (busy) return;
    const problems: Record<string, string | null> = {};
    for (const p of fields) problems[p.component.custom_id] = problem(p.component, answers[p.component.custom_id] ?? {});
    setShown(problems);
    if (Object.values(problems).some(Boolean)) return;
    setBusy(true);
    setError(null);
    const out = fields.map((p) => {
      const f = p.component;
      const a = answers[f.custom_id] ?? {};
      if (f.type === F_TEXT || f.type === F_RADIO) return { custom_id: f.custom_id, value: a.value ?? "" };
      if (f.type === F_CHECKBOX) return { custom_id: f.custom_id, checked: !!a.checked };
      if (f.type === F_FILES) return { custom_id: f.custom_id, values: (a.files ?? []).map((x) => x.id) };
      return { custom_id: f.custom_id, values: a.values ?? [] };
    });
    const res = await interact({ type: 5, application_id: appId, channel_id: channelId, modal_of: interactionId, data: { custom_id: form.custom_id, fields: out } }, { quiet: true });
    setBusy(false);
    if (res.ok) onClose();
    else setError(res.error);
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={480}
      closeOnOverlay={false}
      onSubmit={() => void submit()}
      title={
        <span className={s.head}>
          <span className={s.who}>
            <Avatar id={appId} avatarId={bot?.avatar_id ?? null} name={appName} size={20} />
            <span className={s.whoName} dir="auto">{appName}</span>
            <HookTags app />
          </span>
          <span className={s.title} dir="auto">{form.title}</span>
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t("apps.cancel")}</Button>
          <Button loading={busy} onClick={() => void submit()} data-testid="app-form-submit">{t("apps.form.submit")}</Button>
        </>
      }
    >
      <div className={s.form} data-testid="app-form">
        {form.components.map((p) => (p.component ? <FormFieldView key={p.id} part={p as FormPart & { component: FormField }} channelId={channelId} answer={answers[p.component.custom_id] ?? {}} onAnswer={(a) => set(p.component!.custom_id, a)} error={shown[p.component.custom_id] ?? null} /> : p.content ? <FormText key={p.id} text={p.content} /> : null))}
        {error ? <p className={s.error} role="alert">{error}</p> : null}
        <p className={s.note}>
          <LockOpen size={14} aria-hidden="true" />
          <span>{t("apps.form.notEncrypted", { app: appName })}</span>
        </p>
      </div>
    </Modal>
  );
}

function FormText({ text }: { text: string }) {
  const ctx = useRenderCtx();
  return (
    <div className={s.text} dir="auto">
      <Markdown source={text} ctx={ctx} />
    </div>
  );
}

function FormFieldView({ part, channelId, answer, onAnswer, error }: { part: FormPart & { component: FormField }; channelId: string; answer: Answer; onAnswer: (a: Answer) => void; error: string | null }) {
  const f = part.component;
  const label = part.label ?? "";
  const hint = part.description || undefined;
  const id = useId();
  const [, rerender] = useState(0);
  const kind = entityKindOfComponent(f.type);
  const search = useCallback((q: string) => void findMembers(channelId, q).then(() => rerender((n) => n + 1)), [channelId]);
  switch (f.type) {
    case F_TEXT: {
      const common = { value: answer.value ?? "", placeholder: f.placeholder, maxLength: f.max_length ?? 4000, invalid: !!error, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onAnswer({ value: e.target.value }) };
      return (
        <Field label={label} required={f.required} error={error} hint={hint}>
          {f.style === 2 ? <TextArea {...common} rows={4} /> : <TextInput {...common} />}
        </Field>
      );
    }
    case F_CHECKBOX:
      return (
        <label className={s.check}>
          <input type="checkbox" checked={!!answer.checked} onChange={(e) => onAnswer({ checked: e.target.checked })} />
          <span className={s.checkText}>
            <span>{label}</span>
            {hint ? <span className={s.checkHint}>{hint}</span> : null}
          </span>
        </label>
      );
    case F_RADIO:
    case F_CHECKBOXES: {
      const radio = f.type === F_RADIO;
      const picked = radio ? (answer.value ? [answer.value] : []) : (answer.values ?? []);
      return (
        <Field label={label} required={f.required} error={error} hint={hint} as="div">
          <div className={s.choices} role={radio ? "radiogroup" : "group"}>
            {(f.options ?? []).map((o) => {
              const on = picked.includes(o.value);
              return (
                <label key={o.value} className={s.choice} data-on={on || undefined}>
                  <input
                    type={radio ? "radio" : "checkbox"}
                    name={id}
                    checked={on}
                    onChange={() => (radio ? onAnswer({ value: o.value }) : onAnswer({ values: on ? picked.filter((v) => v !== o.value) : [...picked, o.value] }))}
                  />
                  {o.emoji ? <ChoiceGlyph e={o.emoji} size={20} /> : null}
                  <span className={s.choiceText}>
                    <span className={s.choiceLabel} dir="auto">{o.label}</span>
                    {o.description ? <span className={s.choiceDesc} dir="auto">{o.description}</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
        </Field>
      );
    }
    case F_FILES:
      return (
        <Field label={label} required={f.required} error={error} hint={hint} as="div">
          <FileField f={f} files={answer.files ?? []} onFiles={(files) => onAnswer({ files })} />
        </Field>
      );
    default: {
      const options = f.options ?? [];
      const min = f.min_values ?? (f.required ? 1 : 0);
      const max = Math.max(1, f.max_values ?? 1);
      return (
        <Field label={label} required={f.required} error={error} hint={hint} as="div">
          <SelectBox
            id={id}
            placeholder={f.placeholder || t("apps.select.placeholder")}
            picked={answer.values ?? []}
            labelOf={(v) => (kind ? entityLabel(channelId, v) : (options.find((o) => o.value === v)?.label ?? v))}
            choicesFor={(q) =>
              kind
                ? entityChoices(kind, channelId, q, f.channel_types)
                : options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase())).map((o) => ({ value: o.value, label: o.label, ...(o.description ? { description: o.description } : {}), ...(o.emoji ? { emoji: o.emoji } : {}) }))
            }
            min={Math.min(min, max)}
            max={max}
            searchable={!!kind || options.length > 8}
            onSearch={kind ? search : undefined}
            onCommit={(values) => onAnswer({ values })}
            invalid={!!error}
          />
        </Field>
      );
    }
  }
}

/** Files for a form's file field: chosen, sent up as they are chosen, listed with a way to take each back. */
function FileField({ f, files, onFiles }: { f: FormField; files: InteractionFile[]; onFiles: (files: InteractionFile[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const max = Math.max(1, f.max_values ?? 1);
  const accept = f.file_types?.join(",") || undefined;
  const add = async (list: FileList) => {
    setBusy(true);
    setError(null);
    const next = [...files];
    try {
      for (const file of [...list].slice(0, max - next.length)) next.push(await appsApi.sendFile(file));
    } catch (err) {
      setError(describeError(err, t("apps.form.fileFailed")));
    }
    onFiles(next);
    setBusy(false);
  };
  return (
    <div className={s.files}>
      {files.map((x) => (
        <div key={x.id} className={s.file}>
          <FileUp size={16} aria-hidden="true" />
          <span className={s.fileName} dir="auto">{x.filename}</span>
          <span className={s.fileSize}>{formatBytes(x.size)}</span>
          <button type="button" className={s.fileRemove} aria-label={t("apps.form.removeFile", { name: x.filename })} onClick={() => onFiles(files.filter((y) => y.id !== x.id))}>
            <X size={16} />
          </button>
        </div>
      ))}
      {files.length < max ? (
        <Button type="button" size="sm" variant="secondary" loading={busy} onClick={() => input.current?.click()}>
          <FileUp size={16} aria-hidden="true" /> {max > 1 ? t("apps.form.chooseFiles") : t("apps.form.chooseFile")}
        </Button>
      ) : null}
      {error ? <span className={s.fileError} role="alert">{error}</span> : null}
      <input
        ref={input}
        type="file"
        hidden
        multiple={max > 1}
        accept={accept}
        onChange={(e) => {
          if (e.target.files?.length) void add(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
