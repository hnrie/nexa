import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { NexaWordmark } from "../components/common/Brand";
import { Button } from "@/components/common/Button";
import { useUI } from "@/stores/ui";
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

/**
 * Names the tab after the page ("Log In · Nexa") and gives the plain name back
 * when the page goes. The app's own title only takes over once the app is
 * running, so a title left behind here followed someone from page to page.
 *
 * `when` is false while the page shows another page in its place (the lock
 * screen over an invite, say): a parent's effect runs after its child's, so
 * it would otherwise put its own name over the one on screen.
 */
export function usePageTitle(title: string | null | undefined, when = true): void {
  useEffect(() => {
    if (!when || typeof document === "undefined") return;
    document.title = title ? `${title} · Nexa` : "Nexa";
    return () => {
      document.title = "Nexa";
    };
  }, [title, when]);
}

/**
 * A recovery key as it is shown to be written down: it may only break between
 * its groups, never inside one, and it still copies as the one string.
 */
export function RecoveryKey({ value, testId }: { value: string; testId?: string }) {
  const groups = value.split("-");
  return (
    <div className={s.recovery} data-testid={testId}>
      {groups.map((g, i) => (
        <Fragment key={i}>
          {i ? "-" : null}
          {i ? <wbr /> : null}
          {g}
        </Fragment>
      ))}
    </div>
  );
}

/** Copies a recovery key, and says so: a copy that answers nothing leaves people unsure it worked. */
export function CopyKeyButton({ text }: { text: string }) {
  const toast = useUI((u) => u.toast);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const h = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(h);
  }, [copied]);
  const copy = () => {
    const failed = () => toast(t("register.copyFailed"), "error");
    if (!navigator.clipboard) {
      failed();
      return;
    }
    navigator.clipboard.writeText(text).then(() => setCopied(true), failed);
  };
  return (
    <Button variant="secondary" block onClick={copy} data-copied={copied || undefined}>
      {copied ? <><Check size={16} aria-hidden="true" style={{ verticalAlign: "-3px" }} />{" "}</> : null}
      <span aria-live="polite">{copied ? t("modals.groupInvite.copied") : t("modals.groupInvite.copy")}</span>
    </Button>
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
