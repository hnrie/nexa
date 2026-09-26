import { Bug } from "lucide-react";
import { Tooltip } from "@/components/common/Tooltip";
import type { ContextMenuItem } from "@/stores/ui";
import { useUI } from "@/stores/ui";
import { t } from "@/i18n";
import type { BugFrom } from "./ReportBugModal";
import s from "./Bugs.module.css";

/** Opens the Report a Bug dialog, saying where it was opened from. */
export function openReportBug(from: BugFrom): void {
  useUI.getState().openModal("reportBug", { from });
}

/** The same, as an item for a menu (a phone's header keeps its buttons in one). */
export function reportBugMenuItem(from: BugFrom): ContextMenuItem {
  return { id: "report-bug", label: t("bugs.report"), onSelect: () => openReportBug(from) };
}

/**
 * The bug button in a header: an icon where the header has others like it,
 * or the icon with its name where there is room for it and it is the header's
 * only action (`labelled`).
 */
export function ReportBugButton({ from, className, labelled = false }: { from: BugFrom; className?: string | undefined; labelled?: boolean }) {
  const label = t("bugs.report");
  if (labelled) {
    return (
      <button type="button" className={s.headerButton} onClick={() => openReportBug(from)} data-testid="report-bug">
        <Bug size={18} aria-hidden="true" />
        <span>{label}</span>
      </button>
    );
  }
  return (
    <Tooltip text={label} side="bottom">
      <button type="button" className={className} aria-label={label} onClick={() => openReportBug(from)} data-testid="report-bug">
        <Bug size={22} />
      </button>
    </Tooltip>
  );
}
