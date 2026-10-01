import { Bell, BellOff, CheckCheck, FolderPlus, LogOut } from "lucide-react";
import type { PickAction } from "@/components/common/Pick";
import { leaveServer, markServerRead } from "@/components/sidebar/serverMenu";
import { addToFolder, foldersOf, isPinned, pinEntry, unpinEntry } from "@/lib/railLayout";
import { useAuth } from "@/stores/auth";
import { usePick } from "@/stores/pick";
import { useServers } from "@/stores/servers";
import { useSettings } from "@/stores/settings";
import type { ContextMenuItem } from "@/stores/ui";
import { changeRail, currentRail, folderName } from "./railActions";

import { formatList, t } from "@/i18n";

interface Ctx {
  nav: (path: string) => void;
  openModal: (kind: string, props?: Record<string, unknown>) => void;
}

function setMuted(ids: string[], on: boolean): void {
  const n = useSettings.getState().settings.notifications;
  const muted = on ? [...new Set([...n.muted, ...ids])] : n.muted.filter((x) => !ids.includes(x));
  useSettings.getState().patch({ notifications: { ...n, muted } });
}

/** Leaves the picked servers, after asking once. A server you own cannot be left, and is said to stay. */
function leaveAll(ids: string[], ctx: Ctx): void {
  const me = useAuth.getState().me?.id;
  const byId = useServers.getState().byId;
  const leaving = ids.filter((id) => byId[id] && byId[id]!.server.owner_id !== me);
  const owned = ids.length - leaving.length;
  if (!leaving.length) return;
  const names = formatList(leaving.map((id) => byId[id]!.server.name));
  ctx.openModal("confirm", {
    title: t("pick.leaveServersTitle", { count: leaving.length }),
    body: owned ? `${t("pick.leaveServersBody", { names })} ${t("pick.ownedStay", { count: owned })}` : t("pick.leaveServersBody", { names }),
    confirmLabel: t("pick.leaveServers", { count: leaving.length }),
    danger: true,
    onConfirm: async () => {
      usePick.getState().clear();
      for (const id of leaving) await leaveServer(id, ctx.nav);
    },
  });
}

/**
 * What can be done to several servers of the rail at once: read them, mute
 * them, put them in a folder (a new one or one there is), pin them, leave them.
 */
export function railBulk(ids: string[], ctx: Ctx): { bar: PickAction[]; menu: () => ContextMenuItem[] } {
  const muted = useSettings.getState().settings.notifications.muted;
  const allMuted = ids.every((id) => muted.includes(id));
  const layout = currentRail();
  const allPinned = ids.every((id) => isPinned(layout, id));
  const me = useAuth.getState().me?.id;
  const leavable = ids.filter((id) => useServers.getState().byId[id]?.server.owner_id !== me).length;
  const read = () => ids.forEach(markServerRead);
  const folder = () => ctx.openModal("folderSettings", { serverIds: ids });
  const bar: PickAction[] = [
    { id: "read", icon: CheckCheck, label: t("sidebar.dmMenu.markAsRead"), onSelect: read },
    { id: "mute", icon: allMuted ? Bell : BellOff, label: allMuted ? t("pick.unmute") : t("pick.mute"), onSelect: () => setMuted(ids, !allMuted) },
    { id: "folder", icon: FolderPlus, label: t("pick.newFolder"), onSelect: folder },
    { id: "leave", icon: LogOut, label: t("pick.leaveServers", { count: Math.max(1, leavable) }), danger: true, disabled: leavable === 0, onSelect: () => leaveAll(ids, ctx) },
  ];
  const menu = (): ContextMenuItem[] => {
    const folders = foldersOf(currentRail());
    const items: ContextMenuItem[] = [
      { id: "read", label: t("sidebar.dmMenu.markAsRead"), onSelect: read, separatorAfter: true },
      { id: "pin", label: allPinned ? t("pick.unpin") : t("pick.pin"), onSelect: () => changeRail((l) => ids.reduce((acc, id) => (allPinned ? unpinEntry(acc, id) : isPinned(acc, id) ? acc : pinEntry(acc, id)), l)) },
      {
        id: "folder",
        label: t("organize.rail.addToFolder"),
        submenu: [
          ...folders.map((f, i): ContextMenuItem => ({
            id: `folder-${f.id}`,
            label: folderName(f),
            separatorAfter: i === folders.length - 1,
            onSelect: () => changeRail((l) => ids.reduce((acc, id) => addToFolder(acc, id, f.id), l)),
          })),
          { id: "new-folder", label: t("organize.rail.newFolder"), onSelect: folder },
        ],
      },
      { id: "mute", label: allMuted ? t("pick.unmute") : t("pick.mute"), onSelect: () => setMuted(ids, !allMuted), separatorAfter: true },
    ];
    if (leavable) items.push({ id: "leave", label: t("pick.leaveServers", { count: leavable }), danger: true, onSelect: () => leaveAll(ids, ctx) });
    return items;
  };
  return { bar, menu };
}
