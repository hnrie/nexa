import { ApiError } from "@/api/client";
import { t } from "@/i18n";
import { describeError } from "@/lib/errors";

/**
 * What a failure with a note says, in the reader's language. The server's
 * sentences for these are English, and each is about something the person
 * can do, so the app says them itself.
 */
export function noteError(err: unknown, fallback?: string): string {
  if (err instanceof ApiError) {
    const said: Record<string, string> = {
      note_role: t("notes.errors.role"),
      note_full: t("notes.errors.full"),
      already_member: t("notes.errors.alreadyMember"),
      blocked: t("notes.errors.blocked"),
      user_not_found: t("notes.errors.userNotFound"),
      self: t("notes.errors.self"),
      too_many_links: t("notes.errors.tooManyLinks"),
      too_many_notes: t("notes.errors.tooManyNotes"),
      note_files_full: t("notes.errors.filesFull"),
      note_file: t("notes.errors.file"),
      no_link: t("notes.errors.noLink"),
      no_invite: t("notes.errors.noInvite"),
      note_owner: t("notes.errors.owner"),
      bad_note: t("notes.errors.bad"),
      not_found: t("notes.errors.gone"),
    };
    const mine = said[err.code];
    if (mine) return mine;
    if (err.status === 404) return t("notes.errors.gone");
  }
  return describeError(err, fallback);
}
