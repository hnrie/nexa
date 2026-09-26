import { promptText } from "@/components/modals/PromptModal";
import { t } from "@/i18n";
import {
  addToGroup,
  createGroup,
  deleteGroup,
  forgetDM,
  groupOf,
  GROUP_NAME_MAX,
  isPinnedDM,
  NEXA_ID,
  pinDM,
  pruneDMs,
  removeFromGroup,
  renameGroup,
  setGroupCollapsed,
  unpinDM,
  type DMGroup,
  type DMListLayout,
} from "@/lib/dmLayout";
import { useChannels } from "@/stores/channels";
import { useNexa } from "@/stores/nexa";
import { isUnread, useReadStates } from "@/stores/readStates";
import { useSettings } from "@/stores/settings";
import type { ContextMenuItem } from "@/stores/ui";

/**
 * Whether the Nexa conversation is in the list: Nexa has said something, and
 * something newer than what there was when it was last closed.
 */
export function nexaListed(latest: number | undefined, closed: number): boolean {
  return !!latest && latest > 0 && latest > closed;
}

/** Whether a conversation of the layout is still there to show. */
function known(id: string): boolean {
  if (id === NEXA_ID) return true;
  const ch = useChannels.getState().byId[id];
  return ch?.type === "dm" || ch?.type === "group_dm";
}

/**
 * Changes how the DM list is arranged and saves it with the account. The
 * conversations that have gone since (deleted, or left on another device) are
 * dropped on the way; every conversation is loaded by the time anyone can
 * arrange anything.
 */
export function changeDMList(change: (layout: DMListLayout) => DMListLayout): boolean {
  // not before the account's settings are in: a list arranged from the defaults would replace theirs
  if (!useSettings.getState().loaded) return false;
  const now = useSettings.getState().settings.dmList;
  const next = change(now);
  if (next === now) return false;
  useSettings.getState().patch({ dmList: pruneDMs(next, known) });
  return true;
}

/** A closed or left conversation is not pinned or in a group any more; one that comes back comes back to the main list. */
export function forgetConversation(id: string): void {
  if (!useSettings.getState().loaded) return;
  const now = useSettings.getState().settings.dmList;
  const next = forgetDM(now, id);
  if (next !== now) useSettings.getState().patch({ dmList: next });
}

/**
 * Closes the Nexa conversation until Nexa has something new: a notice, an
 * announcement or a reply from the staff. What was waiting in it counts as
 * seen, so nothing is left counting towards a conversation that is not there.
 */
export function closeNexa(nav?: (path: string) => void): void {
  if (nav && window.location.pathname.startsWith("/channels/@me/nexa")) nav("/channels/@me");
  const nexa = useNexa.getState();
  nexa.markSeen();
  const settings = useSettings.getState();
  if (!settings.loaded) return;
  const dmList = forgetDM(settings.settings.dmList, NEXA_ID);
  settings.patch({ nexaClosed: nexa.state?.latest || Date.now(), ...(dmList !== settings.settings.dmList ? { dmList } : {}) });
}

/** Asks for a name and makes a group, with `ids` in it. */
export async function newGroup(ids: string[] = []): Promise<void> {
  const name = await promptText(t("organize.dm.newGroupTitle"), { label: t("organize.dm.groupName"), maxLength: GROUP_NAME_MAX, hint: t("organize.dm.groupHint") }, t("organize.dm.createGroup"));
  if (name === null || !name.trim()) return;
  changeDMList((l) => createGroup(l, name, ids).layout);
}

/** What a group is called; a name is asked for, so an empty one only comes from elsewhere. */
export function groupName(g: DMGroup): string {
  return g.name.trim() || t("organize.dm.unnamedGroup");
}

/**
 * What a conversation's menu offers for arranging the list: pin it, put it in
 * a group or take it out, and move a pinned one. The only way on a touch
 * screen, which cannot drag.
 */
export function dmArrangeItems(id: string, moves: ContextMenuItem[] = []): ContextMenuItem[] {
  const layout = useSettings.getState().settings.dmList;
  const pinned = isPinnedDM(layout, id);
  const group = groupOf(layout, id);
  const items: ContextMenuItem[] = [
    {
      id: "pin",
      label: pinned ? t("organize.dm.unpinConversation") : t("organize.dm.pinConversation"),
      onSelect: () => changeDMList((l) => (pinned ? unpinDM(l, id) : pinDM(l, id))),
    },
    {
      id: "add-to-group",
      label: t("organize.dm.addToGroup"),
      submenu: [
        ...layout.groups.map((g, i): ContextMenuItem => ({
          id: `group-${g.id}`,
          label: groupName(g),
          // the group it is in shows ticked
          ...(g.id === group?.id ? { checked: true } : {}),
          separatorAfter: i === layout.groups.length - 1,
          onSelect: () => changeDMList((l) => addToGroup(l, id, g.id)),
        })),
        { id: "new-group", label: t("organize.dm.newGroup"), onSelect: () => void newGroup([id]) },
      ],
    },
  ];
  if (group) items.push({ id: "remove-from-group", label: t("organize.dm.removeFromNamed", { name: groupName(group) }), onSelect: () => changeDMList((l) => removeFromGroup(l, id)) });
  if (pinned) items.push(...moves);
  items[items.length - 1]!.separatorAfter = true;
  return items;
}

/** Marks every conversation of a group read. */
export function markGroupRead(g: DMGroup): void {
  const byId = useChannels.getState().byId;
  const reads = useReadStates.getState();
  for (const id of g.ids) {
    if (id === NEXA_ID) {
      useNexa.getState().markSeen();
      continue;
    }
    const ch = byId[id];
    if (ch?.last_message_id && isUnread(reads.byChannel[id], ch.last_message_id)) void reads.ack(id, ch.last_message_id);
  }
}

interface GroupMenuCtx {
  openModal: (kind: string, props?: Record<string, unknown>) => void;
  /** Whether anything in it is waiting to be read. */
  unread: boolean;
  /** Move up and Move down among the pinned ones, for a pinned group. */
  moves?: ContextMenuItem[];
}

/** A group's own menu, from its header. */
export function dmGroupMenuItems(g: DMGroup, ctx: GroupMenuCtx): ContextMenuItem[] {
  const layout = useSettings.getState().settings.dmList;
  const pinned = isPinnedDM(layout, g.id);
  const name = groupName(g);
  const items: ContextMenuItem[] = [
    { id: "read", label: t("sidebar.dmMenu.markAsRead"), disabled: !ctx.unread, onSelect: () => markGroupRead(g), separatorAfter: true },
    {
      id: "collapse",
      label: g.collapsed ? t("organize.dm.expandGroup") : t("organize.dm.collapseGroup"),
      onSelect: () => changeDMList((l) => setGroupCollapsed(l, g.id, !g.collapsed)),
    },
    {
      id: "rename",
      label: t("organize.dm.renameGroup"),
      onSelect: () =>
        void promptText(t("organize.dm.renameGroup"), { label: t("organize.dm.groupName"), initial: g.name, maxLength: GROUP_NAME_MAX }, t("chat.editMessage.save")).then((next) => {
          if (next !== null && next.trim()) changeDMList((l) => renameGroup(l, g.id, next));
        }),
    },
    {
      id: "pin",
      label: pinned ? t("organize.dm.unpinGroup") : t("organize.dm.pinGroup"),
      onSelect: () => changeDMList((l) => (pinned ? unpinDM(l, g.id) : pinDM(l, g.id))),
    },
    ...(pinned ? (ctx.moves ?? []) : []),
  ];
  items[items.length - 1]!.separatorAfter = true;
  items.push({
    id: "delete",
    label: t("organize.dm.deleteGroup"),
    onSelect: () =>
      ctx.openModal("confirm", {
        title: t("organize.dm.deleteNamed", { name }),
        body: t("organize.dm.deleteBody"),
        confirmLabel: t("organize.dm.deleteGroup"),
        onConfirm: () => changeDMList((l) => deleteGroup(l, g.id)),
      }),
  });
  return items;
}
