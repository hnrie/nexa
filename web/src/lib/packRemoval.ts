import { ApiError } from "@/api/client";
import { expressions as expressionsApi } from "@/api/expressions";
import type { StickerPack } from "@/api/types";
import { useExpressions } from "@/stores/expressions";
import { useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";

import { t } from "@/i18n";
/**
 * Packs someone installed can be removed by them. Their own packs are deleted
 * instead, and a pack of a server they are in stays for as long as they do.
 */
export function canRemovePack(pack: StickerPack, meId: string | undefined): boolean {
  if (!pack.installed || pack.owner_user_id === meId) return false;
  return !(pack.server_id && useServers.getState().byId[pack.server_id]);
}

/** What to ask before removing a pack. */
export function removePackQuestion(pack: StickerPack): { title: string; body: string; confirmLabel: string } {
  const count = pack.stickers.length;
  const leaving =
    count === 0
      ? t("packRemoval.itLeavesYourPicker")
      : pack.kind === "emoji"
        ? t("packRemoval.itsEmojiLeaveYourPicker", { count })
        : t("packRemoval.itsStickersLeaveYourPicker", { count });
  return { title: t("packRemoval.removePackNamed", { name: pack.name }), body: `${leaving} ${t("packRemoval.youCanInstallItAgain")}`, confirmLabel: t("pickers.stickerPicker.removePack") };
}

/** Uninstalls the pack and takes it out of the pickers. Says what went wrong if it could not. */
export async function removePack(pack: StickerPack): Promise<boolean> {
  const { toast } = useUI.getState();
  try {
    await expressionsApi.uninstall(pack.id);
  } catch (err) {
    toast(err instanceof ApiError ? err.message : t("packRemoval.couldNotRemoveThePack"), "error");
    return false;
  }
  const expressions = useExpressions.getState();
  const current = expressions.packs[pack.id];
  // the server says the same over the gateway; this just does not wait for it
  if (current?.server_id && useServers.getState().byId[current.server_id]) expressions.upsertPack({ ...current, installed: false });
  else expressions.removePack(pack.id);
  toast(`Removed '${pack.name}'.`, "success");
  return true;
}

/** Asks first, in the app's dialog, then removes the pack. */
export function confirmRemovePack(pack: StickerPack, onRemoved?: () => void): void {
  useUI.getState().openModal("confirm", {
    ...removePackQuestion(pack),
    danger: true,
    onConfirm: async () => {
      if (await removePack(pack)) onRemoved?.();
    },
  });
}
