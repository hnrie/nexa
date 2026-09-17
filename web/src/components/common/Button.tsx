import type { ButtonHTMLAttributes, ReactNode } from "react";
import s from "./Button.module.css";

import { t } from "@/i18n";
type Variant = "primary" | "secondary" | "danger" | "positive" | "link" | "ghost";
type Size = "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
  children?: ReactNode;
}

export function Button({ variant = "primary", size = "md", loading = false, block = false, className, children, disabled, ...rest }: Props) {
  const cls = [s.btn, s[variant], s[size], block ? s.block : "", loading ? s.loading : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <span className={s.dots} aria-hidden="true"><i /><i /><i /></span> : null}
      <span className={s.label}>{children}</span>
    </button>
  );
}
