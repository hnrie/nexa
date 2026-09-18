import type { ReactNode } from "react";
import { NexaWordmark } from "../components/common/Brand";
import s from "./Auth.module.css";

import { t } from "@/i18n";
export function AuthLayout({ title, subtitle, children, width = 480 }: { title: string; subtitle?: string; children: ReactNode; width?: number }) {
  return (
    <div className={s.page}>
      <div className={s.brand}><NexaWordmark height={38} /></div>
      {/* One landmark, so a screen reader has somewhere to skip to rather than
          reading the page from the top every time. */}
      <main className={s.card} style={{ width }}>
        <h1 className={s.title}>{title}</h1>
        {subtitle ? <p className={s.subtitle}>{subtitle}</p> : null}
        {children}
      </main>
    </div>
  );
}

export function passwordStrength(pw: string): { score: number; label: string } {
  if (pw.length < 8) return { score: 0, label: t("authLayout.tooShort") };
  let score = 1;
  if (pw.length >= 12) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^\w\s]/.test(pw)) score += 1;
  const capped = Math.min(4, score);
  const labels = [t("authLayout.tooShort"), t("authLayout.weak"), t("authLayout.okay"), t("authLayout.good"), t("authLayout.strong")];
  return { score: capped, label: labels[capped] ?? t("authLayout.weak") };
}

export const USERNAME_RE = /^[a-z0-9_.]{2,32}$/;

export function usernameProblem(u: string): string | null {
  if (u.length < 2) return t("authLayout.atLeast2Characters");
  if (u.length > 32) return t("authLayout.atMost32Characters");
  if (!USERNAME_RE.test(u)) return t("authLayout.onlyAZ09And");
  if (u.startsWith(".") || u.endsWith(".") || u.includes("..")) return t("authLayout.dotsCanTLeadTrailOr");
  return null;
}
