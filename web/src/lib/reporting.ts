import type { ReportKind } from "@/api/reports";
import type { DecryptedMessage } from "@/lib/decrypt";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { t } from "@/i18n";
export interface ReportEvidence {
  part: string;
  label: string;
  text: string;
}
export interface ReportContext {
  kind?: ReportKind;
  id?: string;
  serverId?: string;
  part?: string;
  evidence?: ReportEvidence[];
}
export function openReport(context: ReportContext = {}): void {
  useUI.getState().openModal("reportContent", { context });
}
export function reportItem(
  context: ReportContext,
  id = "report",
): ContextMenuItem {
  return {
    id,
    label:
      context.kind === "application"
        ? `${t("reports.report")}: ${t("reports.kind.application")}`
        : t("reports.report"),
    icon: "Flag",
    onSelect: () => openReport(context),
  };
}
/** Deliberately copy readable fields only. Attachment keys, encrypted envelopes and
 * conversation roots can never enter this evidence list. Nothing is selected yet. */
export function messageEvidence(msg: DecryptedMessage): ReportEvidence[] {
  const p = msg.payload;
  if (!p) return [];
  const out: ReportEvidence[] = [];
  const add = (
    part: string,
    text: string,
    label = t(`reports.part.${part}`),
  ) => {
    if (text.trim()) out.push({ part, label, text });
  };
  add("text", [p.fwd?.comment, p.t].filter(Boolean).join("\n"));
  for (const a of p.att ?? []) add("attachment", a.name, a.name);
  if (p.sticker) add("sticker", `${p.sticker.name} (${p.sticker.id})`);
  for (const e of p.embeds ?? []) {
    if (typeof e !== "object" || e === null) continue;
    const fields = e as Record<string, unknown>;
    add(
      "embed",
      [fields.title, fields.description, fields.url]
        .filter((v): v is string => typeof v === "string")
        .join("\n"),
    );
  }
  if (p.poll) add("poll", JSON.stringify(p.poll));
  return out;
}
