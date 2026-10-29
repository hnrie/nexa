import type { ReportKind, ReportedMessage } from "@/api/reports";
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
/** Readable preview of the complete message. File keys travel only in the
 * mandatory attachment descriptors, never in previews or conversation metadata. */
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
  for (const e of p.embeds ?? []) add("embed", JSON.stringify(e, null, 2));
  if (msg.hook) add("embed", JSON.stringify(msg.hook, null, 2));
  if (p.poll) add("poll", JSON.stringify(p.poll));
  return out;
}

/** Full message only: no caller-selected fields and no channel or identity keys. */
export function fullReportedMessage(
  msg: DecryptedMessage,
): ReportedMessage | null {
  if (
    msg.decryptError ||
    (!msg.payload && !msg.hook && !msg.call && !msg.type?.startsWith("system_"))
  )
    return null;
  const p = msg.payload;
  const attachments = (p?.att ?? []).flatMap((a) => [
    {
      blob_id: a.blob_id,
      name: a.name,
      type: a.type,
      size: a.size,
      key: a.key,
    },
    ...(a.preview
      ? [
          {
            blob_id: a.preview.blob_id,
            name: a.name,
            type: a.preview.type,
            size: a.preview.size,
            key: a.preview.key,
            preview: true,
          },
        ]
      : []),
  ]);
  // A malformed or unsupported payload must not silently omit a source file.
  if (
    (msg.attachments ?? []).some(
      (a) => !attachments.some((f) => f.blob_id === a.blob_id),
    )
  )
    return null;
  const content = JSON.parse(
    JSON.stringify(
      {
        ...p,
        type: msg.type,
        ...(msg.hook ? { hook: msg.hook } : {}),
        ...(msg.call ? { call: msg.call } : {}),
      },
      (key, value) => (key === "key" ? undefined : value),
    ),
  ) as Record<string, unknown>;
  return { content, attachments, edited_at: msg.edited_at ?? null };
}
