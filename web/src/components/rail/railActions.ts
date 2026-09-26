import { formatList, t } from "@/i18n";
import { isUnread, useReadStates } from "@/stores/readStates";
import { useChannels } from "@/stores/channels";
import { useServers } from "@/stores/servers";
import { useSettings } from "@/stores/settings";
import type { ContextMenuItem } from "@/stores/ui";
import {
  addToFolder,
  deleteFolder,
  findPlace,
  foldersOf,
  isPinned,
  pinEntry,
  removeFromFolder,
  resolveRail,
  unpinEntry,
  updateFolder,
  type RailLayout,
  type ServerFolder,
} from "@/lib/railLayout";
import { markServerRead } from "@/components/sidebar/serverMenu";

/** The rail as it shows now: the account's layout, resolved against the servers it is in. */
export function currentRail(): RailLayout {
  const { settings } = useSettings.getState();
  return resolveRail(settings.rail, useServers.getState().order, settings.serverPositions);
}

/**
 * Changes the rail and saves it with the account; nothing is saved when
 * nothing changed. Returns whether it changed. Not before the account's
 * settings are in: a rail arranged from the defaults would replace theirs.
 */
export function changeRail(change: (layout: RailLayout) => RailLayout): boolean {
  if (!useSettings.getState().loaded) return false;
  const now = currentRail();
  const next = change(now);
  if (next === now) return false;
  useSettings.getState().patch({ rail: next });
  return true;
}

/**
 * The first time an account is loaded after folders came in, the order its
 * rail had becomes its layout, so nothing moves. From then on a server the
 * layout does not know is one joined since, and it lands under the pinned ones.
 * Only once the account's settings are in: they arrive after its servers.
 */
export function adoptRail(): void {
  const st = useSettings.getState();
  if (!st.loaded || !st.key || st.settings.rail !== null) return;
  st.patch({ rail: resolveRail(null, useServers.getState().order, st.settings.serverPositions) });
}

/** What a folder is called: its name, or its servers' names when it has none. */
export function folderName(f: ServerFolder): string {
  const name = f.name.trim();
  if (name) return name;
  const byId = useServers.getState().byId;
  const names = f.servers.map((id) => byId[id]?.server.name ?? "").filter(Boolean);
  return names.length ? formatList(names) : t("organize.rail.folder");
}

/** Marks every server in a folder read. */
export function markFolderRead(f: ServerFolder): void {
  for (const id of f.servers) markServerRead(id);
}

/** Whether anything in these servers is waiting to be read. */
function anyUnread(serverIds: string[]): boolean {
  const channels = useChannels.getState().byId;
  const reads = useReadStates.getState().byChannel;
  const inFolder = new Set(serverIds);
  return Object.values(channels).some((ch) => !!ch.server_id && inFolder.has(ch.server_id) && ch.type === "text" && (isUnread(reads[ch.id], ch.last_message_id) || (reads[ch.id]?.mentions ?? 0) > 0));
}

interface Ctx {
  openModal: (kind: string, props?: Record<string, unknown>) => void;
  /** Move up and Move down, where there is room: the same moves Alt and an arrow key make. */
  moves: ContextMenuItem[];
}

/**
 * What a server's menu in the rail offers for arranging it: pin it, put it in
 * a folder or take it out of one, move it. A touch screen has no dragging, so
 * this is how every move is made there.
 */
export function serverArrangeItems(serverId: string, ctx: Ctx): ContextMenuItem[] {
  const layout = currentRail();
  const at = findPlace(layout, serverId);
  if (!at) return [];
  const folder = at.folder;
  const pinned = isPinned(layout, serverId);
  const folders = foldersOf(layout);
  const items: ContextMenuItem[] = [
    {
      id: "pin",
      label: pinned ? t("organize.rail.unpinServer") : t("organize.rail.pinServer"),
      onSelect: () => changeRail((l) => (pinned ? unpinEntry(l, serverId) : pinEntry(l, serverId))),
    },
    {
      id: "add-to-folder",
      label: t("organize.rail.addToFolder"),
      submenu: [
        ...folders.map((f, i): ContextMenuItem => ({
          id: `folder-${f.id}`,
          label: folderName(f),
          // the folder it is in shows ticked; choosing it again does nothing
          ...(f.id === folder?.id ? { checked: true } : {}),
          separatorAfter: i === folders.length - 1,
          onSelect: () => changeRail((l) => addToFolder(l, serverId, f.id)),
        })),
        { id: "new-folder", label: t("organize.rail.newFolder"), onSelect: () => ctx.openModal("folderSettings", { serverIds: [serverId] }) },
      ],
    },
  ];
  if (folder) {
    const name = folder.name.trim();
    items.push({
      id: "remove-from-folder",
      label: name ? t("organize.rail.removeFromNamed", { name }) : t("organize.rail.removeFromFolder"),
      onSelect: () => changeRail((l) => removeFromFolder(l, serverId)),
    });
  }
  items.push(...ctx.moves);
  items[items.length - 1]!.separatorAfter = true;
  return items;
}

/** A folder's menu: read, its settings, pin, move, delete. */
export function folderMenuItems(folderId: string, ctx: Ctx): ContextMenuItem[] {
  const layout = currentRail();
  const f = foldersOf(layout).find((x) => x.id === folderId);
  if (!f) return [];
  const pinned = isPinned(layout, folderId);
  const items: ContextMenuItem[] = [
    { id: "read", label: t("sidebar.dmMenu.markAsRead"), disabled: !anyUnread(f.servers), onSelect: () => markFolderRead(f), separatorAfter: true },
    { id: "settings", label: t("organize.rail.folderSettings"), onSelect: () => ctx.openModal("folderSettings", { folderId }) },
    {
      id: "pin",
      label: pinned ? t("organize.rail.unpinFolder") : t("organize.rail.pinFolder"),
      onSelect: () => changeRail((l) => (pinned ? unpinEntry(l, folderId) : pinEntry(l, folderId))),
    },
    ...ctx.moves,
  ];
  items[items.length - 1]!.separatorAfter = true;
  items.push({
    id: "delete",
    label: t("organize.rail.deleteFolder"),
    onSelect: () =>
      ctx.openModal("confirm", {
        title: t("organize.rail.deleteNamed", { name: folderName(f) }),
        body: t("organize.rail.deleteBody"),
        confirmLabel: t("organize.rail.deleteFolder"),
        onConfirm: () => changeRail((l) => deleteFolder(l, folderId)),
      }),
  });
  return items;
}

/** Opens or closes a folder where it is. */
export function toggleFolder(f: ServerFolder): void {
  changeRail((l) => updateFolder(l, f.id, { open: !f.open }));
}
