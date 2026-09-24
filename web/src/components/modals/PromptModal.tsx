import { useState, type FormEvent } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/TextInput";
import { useUI } from "@/stores/ui";
import s from "./ServerModals.module.css";

import { t } from "@/i18n";
export interface PromptField {
  key: string;
  label: string;
  initial?: string;
  placeholder?: string;
  maxLength?: number;
  hint?: string;
}

interface PromptOptions {
  title: string;
  fields: PromptField[];
  confirmLabel?: string;
  /** Whether the first field may be left empty. */
  allowEmpty?: boolean;
}

/**
 * Asks for one or more lines of text in the app's own dialog. The browser's
 * window.prompt is not an option: the desktop app (Electron) has none and
 * answers every call with nothing, so buttons built on it did nothing there.
 * Resolves the values by key, or null when cancelled.
 */
export function promptFields(opts: PromptOptions): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    useUI.getState().openModal("prompt", { ...opts, resolve });
  });
}

/** One line of text, or null when cancelled. */
export async function promptText(title: string, field: Omit<PromptField, "key">, confirmLabel?: string): Promise<string | null> {
  const values = await promptFields({ title, fields: [{ key: "value", ...field }], ...(confirmLabel ? { confirmLabel } : {}) });
  return values ? (values["value"] ?? "") : null;
}

export function PromptModal({ onClose, title, fields, confirmLabel = t("chat.editMessage.save"), allowEmpty = false, resolve }: PromptOptions & { onClose: () => void; resolve: (values: Record<string, string> | null) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.initial ?? ""])));
  const first = fields[0]?.key ?? "";
  const ready = allowEmpty || !!values[first]?.trim();
  const cancel = () => {
    resolve(null);
    onClose();
  };
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!ready) return;
    resolve(values);
    onClose();
  };
  return (
    <Modal
      open
      onClose={cancel}
      title={title}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>{t("chat.editMessage.cancel")}</Button>
          <Button onClick={() => submit()} disabled={!ready} data-testid="prompt-confirm">{confirmLabel}</Button>
        </>
      }
    >
      <form className={s.form} onSubmit={submit}>
        {fields.map((f, i) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            <TextInput
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((cur) => ({ ...cur, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              maxLength={f.maxLength}
              autoFocus={i === 0}
              data-testid={`prompt-${f.key}`}
            />
          </Field>
        ))}
        {/* Enter in any field submits */}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
