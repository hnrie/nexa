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
import { usePick } from "@/stores/pick";
import type { ContextMenuItem } from "@/stores/ui";
import { button, defineMenu, type MenuButton } from "@/lib/contextMenus/registry";

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

export interface NexaMenuCtx {
  nav: (path: string) => void;
  /** Where the list is there to arrange: the moves it offers. Absent in the server rail. */
  arrange?: { moves: ContextMenuItem[] };
  /** Offer picking more conversations, as the DM list does. */
  select?: boolean;
}

/**
 * The Nexa conversation's menu: read it, arrange it (where the list is there
 * to arrange, with the moves it offers), and close it.
 */
export const nexaMenu = defineMenu<NexaMenuCtx>("nexa", [
  [
    button("markNexaRead", () => ({ id: "read", label: t("sidebar.dmMenu.markAsRead"), disabled: !((useNexa.getState().state?.unread ?? 0) > 0), onSelect: () => useNexa.getState().markSeen() })),
    button("selectNexa", ({ select }) => !!select && { id: "select", label: t("pick.select"), onSelect: () => usePick.getState().start("dms", NEXA_ID) }),
  ],
  dmArrangeButtons<NexaMenuCtx>({ pin: "pinNexa", add: "addNexaToGroup", remove: "removeNexaFromGroup", move: "moveNexa" }, (c) => (c.arrange ? { id: NEXA_ID, moves: c.arrange.moves } : null)),
  [button("closeNexa", ({ nav }) => ({ id: "close", label: t("sidebar.dMSidebar.closeDm"), onSelect: () => closeNexa(nav) }))],
]);

/** The Direct Messages heading's menu: picking from the list. */
export const dmListMenu = defineMenu<null>("dmList", [[button("selectConversationsInList", () => ({ id: "select", label: t("pick.selectConversations"), onSelect: () => usePick.getState().start("dms") }))]]);

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
 * screen, which cannot drag. `ids` names the buttons in the menu they are in;
 * `which` says which conversation, with the moves the list offers for its row
 * (among the pins, or a list sorted by hand), or null where it does not apply.
 */
export function dmArrangeButtons<C>(ids: { pin: string; add: string; remove: string; move: string }, which: (ctx: C) => { id: string; moves?: ContextMenuItem[] } | null): MenuButton<C>[] {
  const layout = () => useSettings.getState().settings.dmList;
  return [
    button(ids.pin, (ctx) => {
      const w = which(ctx);
      if (!w) return null;
      const pinned = isPinnedDM(layout(), w.id);
      return { id: "pin", label: pinned ? t("organize.dm.unpinConversation") : t("organize.dm.pinConversation"), onSelect: () => changeDMList((l) => (pinned ? unpinDM(l, w.id) : pinDM(l, w.id))) };
    }),
    button(ids.add, (ctx) => {
      const w = which(ctx);
      if (!w) return null;
      const l = layout();
      const group = groupOf(l, w.id);
      return {
        id: "add-to-group",
        label: t("organize.dm.addToGroup"),
        submenu: [
          ...l.groups.map((g, i): ContextMenuItem => ({
            id: `group-${g.id}`,
            label: groupName(g),
            // the group it is in shows ticked
            ...(g.id === group?.id ? { checked: true } : {}),
            separatorAfter: i === l.groups.length - 1,
            onSelect: () => changeDMList((next) => addToGroup(next, w.id, g.id)),
          })),
          { id: "new-group", label: t("organize.dm.newGroup"), onSelect: () => void newGroup([w.id]) },
        ],
      };
    }),
    button(ids.remove, (ctx) => {
      const w = which(ctx);
      const group = w && groupOf(layout(), w.id);
      return !!w && !!group && { id: "remove-from-group", label: t("organize.dm.removeFromNamed", { name: groupName(group) }), onSelect: () => changeDMList((l) => removeFromGroup(l, w.id)) };
    }),
    button(ids.move, (ctx) => which(ctx)?.moves),
  ];
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

export interface DMGroupMenuCtx {
  group: DMGroup;
  openModal: (kind: string, props?: Record<string, unknown>) => void;
  /** Whether anything in it is waiting to be read. */
  unread: boolean;
  /** Move up and Move down among the pinned ones, for a pinned group. */
  moves?: ContextMenuItem[];
}

/** A group's own menu, from its header. */
export const dmGroupMenu = defineMenu<DMGroupMenuCtx>("dmGroup", [
  [button("markDmGroupRead", ({ group, unread }) => ({ id: "read", label: t("sidebar.dmMenu.markAsRead"), disabled: !unread, onSelect: () => markGroupRead(group) }))],
  [
    button("collapseDmGroup", ({ group: g }) => ({ id: "collapse", label: g.collapsed ? t("organize.dm.expandGroup") : t("organize.dm.collapseGroup"), onSelect: () => changeDMList((l) => setGroupCollapsed(l, g.id, !g.collapsed)) })),
    button("renameDmGroup", ({ group: g }) => ({
      id: "rename",
      label: t("organize.dm.renameGroup"),
      onSelect: () =>
        void promptText(t("organize.dm.renameGroup"), { label: t("organize.dm.groupName"), initial: g.name, maxLength: GROUP_NAME_MAX }, t("chat.editMessage.save")).then((next) => {
          if (next !== null && next.trim()) changeDMList((l) => renameGroup(l, g.id, next));
        }),
    })),
    button("pinDmGroup", ({ group: g }) => {
      const pinned = isPinnedDM(useSettings.getState().settings.dmList, g.id);
      return { id: "pin", label: pinned ? t("organize.dm.unpinGroup") : t("organize.dm.pinGroup"), onSelect: () => changeDMList((l) => (pinned ? unpinDM(l, g.id) : pinDM(l, g.id))) };
    }),
    button("moveDmGroup", ({ group: g, moves }) => isPinnedDM(useSettings.getState().settings.dmList, g.id) && moves),
  ],
  [button("deleteDmGroup", ({ group: g, openModal }) => ({
    id: "delete",
    label: t("organize.dm.deleteGroup"),
    onSelect: () =>
      openModal("confirm", {
        title: t("organize.dm.deleteNamed", { name: groupName(g) }),
        body: t("organize.dm.deleteBody"),
        confirmLabel: t("organize.dm.deleteGroup"),
        onConfirm: () => changeDMList((l) => deleteGroup(l, g.id)),
      }),
  }))],
]);
