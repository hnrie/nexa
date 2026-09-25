import { AlertTriangle, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import s from "./Look.module.css";

/**
 * The warning at the top of Custom CSS and Plugins, and in every dialog that
 * adds one: what comes from other people, and what it can do. Plugins get the
 * stronger one, since they can do anything the person can.
 */
export function Caution({ level = "warning", children, testId }: { level?: "warning" | "danger"; children: ReactNode; testId?: string }) {
  return (
    <div className={s.caution} data-level={level} role="note" data-testid={testId}>
      {level === "danger" ? <ShieldAlert size={20} aria-hidden="true" /> : <AlertTriangle size={20} aria-hidden="true" />}
      <div>{children}</div>
    </div>
  );
}
