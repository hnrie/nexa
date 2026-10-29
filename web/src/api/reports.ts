import { api } from "./client";
import type { BugFile } from "./bugs";
import type { Person } from "./moderation";

export const REPORT_KINDS = [
  "user",
  "server",
  "channel",
  "message",
  "emoji",
  "sticker",
  "pack",
  "note",
  "application",
  "role",
  "other",
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_REASONS = [
  "harassment",
  "hate",
  "sexual",
  "violence",
  "child_safety",
  "spam",
  "scam",
  "privacy",
  "illegal",
  "other",
] as const;
export const REPORT_STATUSES = [
  "open",
  "in_review",
  "actioned",
  "dismissed",
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export interface ReportTarget {
  kind: ReportKind;
  id: string;
  subject_id: string;
  server_id: string;
  parts: string[];
  snapshot: Record<string, unknown>;
}
export interface SafetyReport {
  id: string;
  reporter_id: string;
  target_kind: ReportKind;
  target_id: string;
  subject_id: string;
  server_id: string;
  part: string;
  custom_part: string;
  reason: string;
  description: string;
  excerpt: string;
  snapshot: Record<string, unknown>;
  status: ReportStatus;
  assigned_to: string;
  version: number;
  created_at: number;
  updated_at: number;
}
export interface ReportEvent {
  id: string;
  actor_id: string;
  status: ReportStatus;
  assigned_to: string;
  note: string;
  created_at: number;
}
export interface ReportDetail {
  report: SafetyReport;
  events: ReportEvent[];
  files: BugFile[];
  people: Record<string, Person>;
}
export interface ReportList {
  reports: SafetyReport[];
  counts: Record<ReportStatus, number>;
  has_more: boolean;
}
export interface ReportedMessage {
  content: Record<string, unknown>;
  attachments: {
    blob_id: string;
    name: string;
    type: string;
    size: number;
    key: string;
    preview?: boolean;
  }[];
  edited_at: number | null;
}
export interface ReportSubmission {
  request_id: string;
  message?: ReportedMessage;
  target_kind: ReportKind;
  target_id: string;
  server_id?: string;
  part: string;
  custom_part: string;
  reason: string;
  description: string;
  excerpt: string;
  files: { id: string; name: string }[];
}
export const reports = {
  target: (
    kind: ReportKind,
    id: string,
    serverId?: string,
    signal?: AbortSignal,
  ) =>
    api.request<ReportTarget>("GET", "/reports/target", undefined, {
      query: { kind, id, server_id: serverId },
      ...(signal ? { signal } : {}),
    }),
  send: (body: ReportSubmission) =>
    api.request<{ report: SafetyReport }>("POST", "/reports", body),
  mine: () =>
    api.request<{ reports: SafetyReport[]; has_more: boolean }>(
      "GET",
      "/reports",
    ),
  upload: (file: File, signal?: AbortSignal) =>
    api.upload<BugFile>(
      `/reports/attachments?name=${encodeURIComponent(file.name)}`,
      file,
      signal ? { signal } : undefined,
    ),
  list: (query: Record<string, string | undefined>) =>
    api.request<ReportList>("GET", "/moderation/reports", undefined, { query }),
  detail: (id: string) =>
    api.request<ReportDetail>("GET", `/moderation/reports/${id}`),
  review: (
    id: string,
    body: {
      version: number;
      status: ReportStatus;
      note: string;
      assigned_to: string;
    },
  ) => api.request<ReportDetail>("PATCH", `/moderation/reports/${id}`, body),
  removeMessage: (id: string, version: number, reason: string) =>
    api.request("POST", `/moderation/reports/${id}/remove-message`, {
      version,
      reason,
    }),
  fileUrl: (id: string) => api.url(`/media/reports/${id}`),
};
