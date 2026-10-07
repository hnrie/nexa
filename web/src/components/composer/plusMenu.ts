import type { Channel } from "@/api/types";
import { P } from "@/lib/perms";
import { canI, type ServerState } from "@/stores/servers";
import { button, defineMenu } from "@/lib/contextMenus/registry";
import { t } from "@/i18n";

/** What the composer's plus button can do: upload a file, or ask a poll. */
export type PlusOption = "upload" | "poll";

/**
 * What a tap on the plus button does: there is no button when it could do
 * nothing, a single thing it does at once, and only a choice of several opens
 * a menu (a menu of one is a tap wasted).
 */
export type PlusButton = { kind: "none" } | { kind: "direct"; option: PlusOption } | { kind: "menu"; options: PlusOption[] };

export function plusButton(can: { attach: boolean; poll: boolean }): PlusButton {
  const options: PlusOption[] = [];
  if (can.attach) options.push("upload");
  if (can.poll) options.push("poll");
  if (options.length === 0) return { kind: "none" };
  if (options.length === 1) return { kind: "direct", option: options[0]! };
  return { kind: "menu", options };
}

/**
 * Whether this account may ask a poll in a channel: anywhere in a
 * conversation, and in a server channel where it has Create Polls and Send
 * Messages (both of which an owner can take away, per role or channel).
 */
export function canCreatePoll(st: ServerState | undefined, channel: Pick<Channel, "id" | "server_id">): boolean {
  if (!channel.server_id) return true;
  return canI(st, P.SEND_MESSAGES, channel.id) && canI(st, P.CREATE_POLLS, channel.id);
}

/** What a plus button option is called, on the button and in its menu. */
export function plusLabel(o: PlusOption): string {
  return o === "upload" ? t("composer.composer.uploadAFile") : t("poll.create.title");
}

/** The plus button's menu, when there is a choice: each option it offers, and what choosing one does. */
export const plusMenu = defineMenu<{ options: PlusOption[]; run: (o: PlusOption) => void }>("composerPlus", [
  [
    button("uploadFile", ({ options, run }) => options.includes("upload") && { id: "upload", label: plusLabel("upload"), onSelect: () => run("upload") }),
    button("createPoll", ({ options, run }) => options.includes("poll") && { id: "poll", label: plusLabel("poll"), onSelect: () => run("poll") }),
  ],
]);

/** The phone's one button for formatting, the preview and emoji, opening a menu above it. */
export const composerToolsMenu = defineMenu<{ preview: boolean; openFormatting: () => void; togglePreview: () => void; openEmoji: () => void }>("composerTools", [
  [
    button("formattingEditor", ({ openFormatting }) => ({ id: "formatting", label: t("composer.more.formatting"), onSelect: openFormatting })),
    button("messagePreview", ({ preview, togglePreview }) => ({ id: "preview", label: t("composer.preview.show"), checked: preview, toggle: true, onSelect: togglePreview })),
    button("emojiPicker", ({ openEmoji }) => ({ id: "emoji", label: t("composer.more.emoji"), onSelect: openEmoji })),
  ],
]);
