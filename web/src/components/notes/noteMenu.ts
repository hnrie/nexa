import type { NavigateFunction } from "react-router-dom";
import { NOTE_EDITOR, NOTE_OWNER, NOTE_VIEWER, type NoteRole } from "@/api/types";
import { button, defineMenu } from "@/lib/contextMenus/registry";
import type { ContextMenuItem } from "@/stores/ui";
import type { NoteItem } from "@/stores/notes";
import { ReadableError } from "@/lib/readableError";
import { noteError } from "@/lib/notes/errors";
import { removeNote } from "@/lib/notes/share";
import { t } from "@/i18n";
import { noteName } from "./NoteParts";

export interface NoteMenuCtx {
  note: NoteItem;
  nav: NavigateFunction;
  openModal: (kind: string, props?: Record<string, unknown>) => void;
  /** On the note's own page: its history is opened there. */
  onHistory?: () => void;
  /** Called once the note is deleted or left. */
  onGone?: () => void;
  /** In the list, where opening it is the first thing to offer. */
  inList?: boolean;
}

/** Deletes the note (its owner) or leaves it (anyone else), after asking. */
function removeItem({ note, openModal, onGone }: NoteMenuCtx): ContextMenuItem {
  const owner = note.role === NOTE_OWNER;
  const title = noteName(note.head?.title);
  const remove = async () => {
    try {
      await removeNote(note);
    } catch (err) {
      // the dialog stays open, saying why
      throw new ReadableError(noteError(err));
    }
    onGone?.();
  };
  return owner
    ? { id: "delete", label: t("notes.menu.delete"), danger: true, onSelect: () => openModal("confirm", { title: t("notes.menu.deleteTitle"), body: t("notes.menu.deleteBody", { title }), confirmLabel: t("notes.menu.delete"), danger: true, onConfirm: remove }) }
    : { id: "leave", label: t("notes.menu.leave"), danger: true, onSelect: () => openModal("confirm", { title: t("notes.menu.leaveTitle"), body: t("notes.menu.leaveBody", { title }), confirmLabel: t("notes.menu.leave"), danger: true, onConfirm: remove }) };
}

/** What can be done with a note from its card's menu or the menu on its page. */
export const noteMenu = defineMenu<NoteMenuCtx>("note", [
  [
    button("openNote", ({ note, nav, inList }) => !!inList && { id: "open", label: t("notes.menu.open"), onSelect: () => nav(`/channels/@me/notes/${note.id}`) }),
    button("shareNote", ({ note, openModal }) => ({ id: "share", label: note.role === NOTE_OWNER ? t("notes.menu.share") : t("notes.menu.whoHasAccess"), onSelect: () => openModal("shareNote", { noteId: note.id }) })),
    button("noteHistory", ({ onHistory }) => !!onHistory && { id: "history", label: t("notes.menu.history"), onSelect: onHistory }),
  ],
  [button("deleteNote", (ctx) => removeItem(ctx))],
]);

/** A note member's role, chosen by the note's owner in Share. */
export const noteMemberRoleMenu = defineMenu<{ role: number; setRole: (role: NoteRole) => void; remove: () => void }>("noteMemberRole", [
  [
    button("noteMemberCanEdit", ({ role, setRole }) => ({ id: "edit", label: t("notes.share.canEdit"), checked: role === NOTE_EDITOR, onSelect: () => role !== NOTE_EDITOR && setRole(NOTE_EDITOR) })),
    button("noteMemberCanView", ({ role, setRole }) => ({ id: "view", label: t("notes.share.canView"), checked: role === NOTE_VIEWER, onSelect: () => role !== NOTE_VIEWER && setRole(NOTE_VIEWER) })),
  ],
  [button("removeNoteMember", ({ remove }) => ({ id: "remove", label: t("notes.share.removeFromNote"), danger: true, onSelect: remove }))],
]);

/** What a new share link lets its holders do. */
export const noteLinkRoleMenu = defineMenu<{ create: (role: NoteRole) => void }>("noteLinkRole", [
  [
    button("noteLinkCanView", ({ create }) => ({ id: "view", label: t("notes.share.linkCanView"), onSelect: () => create(NOTE_VIEWER) })),
    button("noteLinkCanEdit", ({ create }) => ({ id: "edit", label: t("notes.share.linkCanEdit"), onSelect: () => create(NOTE_EDITOR) })),
  ],
]);
