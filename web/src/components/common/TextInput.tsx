import { Eye, EyeOff } from "lucide-react";
import { cloneElement, forwardRef, isValidElement, useId, useState, type InputHTMLAttributes, type ReactElement, type ReactNode, type TextareaHTMLAttributes } from "react";
import { t } from "@/i18n";
import { Select } from "./Select";
import s from "./TextInput.module.css";

interface FieldProps {
  label?: string;
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
  /** "div" for a field wrapping a group of radios: a label would pass a stray tap on its caption or gaps to the first radio. */
  as?: "label" | "div";
}

export function Field({ label, error, hint, required, children, className, as }: FieldProps) {
  const Tag = as ?? "label";
  const id = useId();
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  // The error used to sit inside the `<label>`, which is where an input takes
  // its accessible name from, so the name became "Server name * — Name is
  // taken" and changed on every keystroke. Naming the input from the caption
  // alone keeps it stable, and the error becomes a description instead — which
  // is also the only way `aria-invalid` means anything.
  // Only something that can carry a name gets one: a `<div>` wrapping a link
  // row or a hash prefix would be a generic element with an aria-labelledby on
  // it, which is both prohibited and useless.
  const only = isValidElement(children) ? (children as ReactElement<Record<string, unknown>>) : null;
  const nameable = !!only && (only.type === "input" || only.type === "textarea" || only.type === "select" || only.type === TextInput || only.type === TextArea || only.type === Select);
  const field =
    Tag === "label" && only && nameable
      ? cloneElement(only, {
          ...(label ? { "aria-labelledby": labelId } : {}),
          ...(describedBy ? { "aria-describedby": [only.props["aria-describedby"], describedBy].filter(Boolean).join(" ") } : {}),
          ...(error ? { "aria-invalid": true } : {}),
        })
      : children;
  return (
    <Tag
      className={[s.field, error ? s.hasError : "", className ?? ""].join(" ")}
      // A group of radios is wrapped in a `div`, not a label; the caption is
      // the group's name rather than any one option's.
      {...(Tag === "div" && label ? { role: "group", "aria-labelledby": labelId } : {})}
    >
      {label ? (
        <span className={s.label}>
          <span id={labelId}>
            {label}
            {required ? <span className={s.req}> *</span> : null}
          </span>
          {error ? <><span className={s.errorText} aria-hidden="true"> · </span><span className={s.errorText} id={errorId} role="alert">{error}</span></> : null}
        </span>
      ) : null}
      {field}
      {hint && !error ? <span className={s.hint} id={hintId}>{hint}</span> : null}
    </Tag>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
  /**
   * On a password box, an eye that shows what was typed. A password here is
   * also what unlocks the keys, so a typo reads as a wrong password; on a
   * phone it was typed blind with no way to check it.
   */
  reveal?: boolean;
};

export const TextInput = forwardRef<HTMLInputElement, InputProps>(function TextInput({ invalid, className, reveal = false, type, ...rest }, ref) {
  const [shown, setShown] = useState(false);
  const input = <input ref={ref} className={[s.input, invalid ? s.invalid : "", reveal ? s.withReveal : "", className ?? ""].join(" ")} type={reveal && shown ? "text" : type} {...(reveal && shown ? { autoCorrect: "off", autoCapitalize: "none", spellCheck: false } : {})} {...rest} />;
  if (!reveal || type !== "password") return input;
  return (
    <span className={s.revealWrap}>
      {input}
      <button type="button" className={s.reveal} aria-pressed={shown} aria-label={shown ? t("common.hidePassword") : t("common.showPassword")} title={shown ? t("common.hidePassword") : t("common.showPassword")} onClick={() => setShown((v) => !v)} onMouseDown={(e) => e.preventDefault()}>
        {shown ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
      </button>
    </span>
  );
});

type AreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export const TextArea = forwardRef<HTMLTextAreaElement, AreaProps>(function TextArea({ invalid, className, ...rest }, ref) {
  return <textarea ref={ref} className={[s.input, s.area, invalid ? s.invalid : "", className ?? ""].join(" ")} {...rest} />;
});
