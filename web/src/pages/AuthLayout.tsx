import type { ReactNode } from "react";
import { NexaLockup } from "../components/common/Brand";
import s from "./Auth.module.css";

export function AuthLayout({ title, subtitle, children, width = 480 }: { title: string; subtitle?: string; children: ReactNode; width?: number }) {
  return (
    <div className={s.page}>
      <div className={s.brand}><NexaLockup size={34} /></div>
      <div className={s.card} style={{ width }}>
        <h1 className={s.title}>{title}</h1>
        {subtitle ? <p className={s.subtitle}>{subtitle}</p> : null}
        {children}
      </div>
    </div>
  );
}

export function passwordStrength(pw: string): { score: number; label: string } {
  if (pw.length < 8) return { score: 0, label: "Too short" };
  let score = 1;
  if (pw.length >= 12) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^\w\s]/.test(pw)) score += 1;
  const capped = Math.min(4, score);
  const labels = ["Too short", "Weak", "Okay", "Good", "Strong"];
  return { score: capped, label: labels[capped] ?? "Weak" };
}

export const USERNAME_RE = /^[a-z0-9_.]{2,32}$/;

export function usernameProblem(u: string): string | null {
  if (u.length < 2) return "At least 2 characters.";
  if (u.length > 32) return "At most 32 characters.";
  if (!USERNAME_RE.test(u)) return "Only a-z, 0-9, _ and . are allowed.";
  if (u.startsWith(".") || u.endsWith(".") || u.includes("..")) return "Dots can't lead, trail or repeat.";
  return null;
}
