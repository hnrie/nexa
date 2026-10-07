import { formatList, t } from "@/i18n";
import { isUnread, useReadStates } from "@/stores/readStates";
import { useChannels } from "@/stores/channels";
import { useServers } from "@/stores/servers";
import { useSettings } from "@/stores/settings";
import type { ContextMenuItem } from "@/stores/ui";
import { button, defineMenu, type MenuButton } from "@/lib/contextMenus/registry";
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
import { markServerRead } from "@/components/sidebar/serverActions";

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

/** What the server menu is handed when it opens from the rail, where servers are arranged. */
export interface RailServerCtx {
  serverId: string;
  openModal: (kind: string, props?: Record<string, unknown>) => void;
  /** Set only in the rail: Move up and Move down where there is room, the same moves Alt and an arrow key make. */
  rail?: { moves: ContextMenuItem[] };
}

/** The server's place in the rail, when the menu opened there and it has one. */
function railPlace(ctx: RailServerCtx) {
  if (!ctx.rail) return null;
  const layout = currentRail();
  const at = findPlace(layout, ctx.serverId);
  return at ? { layout, folder: at.folder } : null;
}

/**
 * What a server's menu in the rail offers for arranging it: pin it, put it in
 * a folder or take it out of one, move it. A touch screen has no dragging, so
 * this is how every move is made there.
 */
export const serverArrangeButtons: MenuButton<RailServerCtx>[] = [
  button("pinServer", (ctx) => {
    const place = railPlace(ctx);
    if (!place) return null;
    const pinned = isPinned(place.layout, ctx.serverId);
    return {
      id: "pin",
      label: pinned ? t("organize.rail.unpinServer") : t("organize.rail.pinServer"),
      onSelect: () => changeRail((l) => (pinned ? unpinEntry(l, ctx.serverId) : pinEntry(l, ctx.serverId))),
    };
  }),
  button("addServerToFolder", (ctx) => {
    const place = railPlace(ctx);
    if (!place) return null;
    const folders = foldersOf(place.layout);
    return {
      id: "add-to-folder",
      label: t("organize.rail.addToFolder"),
      submenu: [
        ...folders.map((f, i): ContextMenuItem => ({
          id: `folder-${f.id}`,
          label: folderName(f),
          // the folder it is in shows ticked; choosing it again does nothing
          ...(f.id === place.folder?.id ? { checked: true } : {}),
          separatorAfter: i === folders.length - 1,
          onSelect: () => changeRail((l) => addToFolder(l, ctx.serverId, f.id)),
        })),
        { id: "new-folder", label: t("organize.rail.newFolder"), onSelect: () => ctx.openModal("folderSettings", { serverIds: [ctx.serverId] }) },
      ],
    };
  }),
  button("removeServerFromFolder", (ctx) => {
    const folder = railPlace(ctx)?.folder;
    if (!folder) return null;
    const name = folder.name.trim();
    return {
      id: "remove-from-folder",
      label: name ? t("organize.rail.removeFromNamed", { name }) : t("organize.rail.removeFromFolder"),
      onSelect: () => changeRail((l) => removeFromFolder(l, ctx.serverId)),
    };
  }),
  button("moveServer", (ctx) => railPlace(ctx) && ctx.rail?.moves),
];

export interface FolderMenuCtx {
  folderId: string;
  openModal: (kind: string, props?: Record<string, unknown>) => void;
  /** Move up and Move down, where there is room. */
  moves: ContextMenuItem[];
}

const folderOf = (folderId: string) => foldersOf(currentRail()).find((x) => x.id === folderId);

/** A folder's menu: read, its settings, pin, move, delete. */
export const folderMenu = defineMenu<FolderMenuCtx>("folder", [
  [button("markFolderRead", ({ folderId }) => {
    const f = folderOf(folderId);
    return f && { id: "read", label: t("sidebar.dmMenu.markAsRead"), disabled: !anyUnread(f.servers), onSelect: () => markFolderRead(f) };
  })],
  [
    button("folderSettings", ({ folderId, openModal }) => !!folderOf(folderId) && { id: "settings", label: t("organize.rail.folderSettings"), onSelect: () => openModal("folderSettings", { folderId }) }),
    button("pinFolder", ({ folderId }) => {
      if (!folderOf(folderId)) return null;
      const pinned = isPinned(currentRail(), folderId);
      return { id: "pin", label: pinned ? t("organize.rail.unpinFolder") : t("organize.rail.pinFolder"), onSelect: () => changeRail((l) => (pinned ? unpinEntry(l, folderId) : pinEntry(l, folderId))) };
    }),
    button("moveFolder", ({ folderId, moves }) => !!folderOf(folderId) && moves),
  ],
  [button("deleteFolder", ({ folderId, openModal }) => {
    const f = folderOf(folderId);
    return f && {
      id: "delete",
      label: t("organize.rail.deleteFolder"),
      onSelect: () =>
        openModal("confirm", {
          title: t("organize.rail.deleteNamed", { name: folderName(f) }),
          body: t("organize.rail.deleteBody"),
          confirmLabel: t("organize.rail.deleteFolder"),
          onConfirm: () => changeRail((l) => deleteFolder(l, folderId)),
        }),
    };
  })],
]);

/** Opens or closes a folder where it is. */
export function toggleFolder(f: ServerFolder): void {
  changeRail((l) => updateFolder(l, f.id, { open: !f.open }));
}
