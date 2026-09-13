import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
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
  return (
    <Tag className={[s.field, error ? s.hasError : "", className ?? ""].join(" ")}>
      {label ? (
        <span className={s.label}>
          {label}
          {required ? <span className={s.req}> *</span> : null}
          {error ? <span className={s.errorText}> — {error}</span> : null}
        </span>
      ) : null}
      {children}
      {hint && !error ? <span className={s.hint}>{hint}</span> : null}
    </Tag>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export const TextInput = forwardRef<HTMLInputElement, InputProps>(function TextInput({ invalid, className, ...rest }, ref) {
  return <input ref={ref} className={[s.input, invalid ? s.invalid : "", className ?? ""].join(" ")} {...rest} />;
});

type AreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export const TextArea = forwardRef<HTMLTextAreaElement, AreaProps>(function TextArea({ invalid, className, ...rest }, ref) {
  return <textarea ref={ref} className={[s.input, s.area, invalid ? s.invalid : "", className ?? ""].join(" ")} {...rest} />;
});
