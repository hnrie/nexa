import type { NavigateFunction } from "react-router-dom";
import { NOTE_OWNER } from "@/api/types";
import type { ContextMenuItem } from "@/stores/ui";
import type { NoteItem } from "@/stores/notes";
import { ReadableError } from "@/lib/readableError";
import { noteError } from "@/lib/notes/errors";
import { removeNote } from "@/lib/notes/share";
import { t } from "@/i18n";
import { noteName } from "./NoteParts";

interface Deps {
  nav: NavigateFunction;
  openModal: (kind: string, props?: Record<string, unknown>) => void;
  /** On the note's own page: its history is opened there. */
  onHistory?: () => void;
  /** Called once the note is deleted or left. */
  onGone?: () => void;
  /** In the list, where opening it is the first thing to offer. */
  inList?: boolean;
}

/** What can be done with a note from its card's menu or the menu on its page. */
export function noteMenuItems(note: NoteItem, d: Deps): ContextMenuItem[] {
  const owner = note.role === NOTE_OWNER;
  const title = noteName(note.head?.title);
  const items: ContextMenuItem[] = [];
  if (d.inList) items.push({ id: "open", label: t("notes.menu.open"), onSelect: () => d.nav(`/channels/@me/notes/${note.id}`) });
  items.push({ id: "share", label: owner ? t("notes.menu.share") : t("notes.menu.whoHasAccess"), onSelect: () => d.openModal("shareNote", { noteId: note.id }), separatorAfter: !d.onHistory });
  if (d.onHistory) items.push({ id: "history", label: t("notes.menu.history"), onSelect: d.onHistory, separatorAfter: true });
  const remove = async () => {
    try {
      await removeNote(note);
    } catch (err) {
      // the dialog stays open, saying why
      throw new ReadableError(noteError(err));
    }
    d.onGone?.();
  };
  items.push(
    owner
      ? {
          id: "delete",
          label: t("notes.menu.delete"),
          danger: true,
          onSelect: () => d.openModal("confirm", { title: t("notes.menu.deleteTitle"), body: t("notes.menu.deleteBody", { title }), confirmLabel: t("notes.menu.delete"), danger: true, onConfirm: remove }),
        }
      : {
          id: "leave",
          label: t("notes.menu.leave"),
          danger: true,
          onSelect: () => d.openModal("confirm", { title: t("notes.menu.leaveTitle"), body: t("notes.menu.leaveBody", { title }), confirmLabel: t("notes.menu.leave"), danger: true, onConfirm: remove }),
        },
  );
  return items;
}
