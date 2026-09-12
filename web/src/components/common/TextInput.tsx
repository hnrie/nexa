import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import s from "./TextInput.module.css";

interface FieldProps {
  label?: string;
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ label, error, hint, required, children, className }: FieldProps) {
  return (
    <label className={[s.field, error ? s.hasError : "", className ?? ""].join(" ")}>
      {label ? (
        <span className={s.label}>
          {label}
          {required ? <span className={s.req}> *</span> : null}
          {error ? <span className={s.errorText}> — {error}</span> : null}
        </span>
      ) : null}
      {children}
      {hint && !error ? <span className={s.hint}>{hint}</span> : null}
    </label>
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
