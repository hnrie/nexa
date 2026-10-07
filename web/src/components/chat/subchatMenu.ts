import { ApiError } from "@/api/client";
import { channels as channelsApi } from "@/api/channels";
import type { Channel } from "@/api/types";
import { t } from "@/i18n";
import { about, button, defineMenu } from "@/lib/contextMenus/registry";
import { copyIdItem, developerMode } from "@/lib/copyId";
import { useChannels } from "@/stores/channels";
import { useUI } from "@/stores/ui";

export interface SubchatMenuCtx {
  channel: Channel;
  openModal: (k: string, p?: Record<string, unknown>) => void;
  nav: (p: string) => void;
  /** Where the reader is, when not the page's own address (tests). */
  path?: string;
}

async function removeSubchat({ channel: ch, nav, path }: SubchatMenuCtx): Promise<void> {
  try {
    await channelsApi.close(ch.id);
    useChannels.getState().remove(ch.id);
    // only someone in the subchat is taken back to its conversation; anywhere else they stay put
    if (ch.parent_id && (path ?? window.location.pathname).split("/").includes(ch.id)) nav(`/channels/@me/${ch.parent_id}`);
  } catch (err) {
    useUI.getState().toast(err instanceof ApiError ? err.message : t("chat.subchat.couldNotDeleteThatSubchat"), "error");
  }
}

/** Menu for one subchat row: edit its name and password, or delete for everyone. */
export const subchatMenu = defineMenu<SubchatMenuCtx>("subchat", [
  [
    button("editSubchat", ({ channel, openModal }) => ({ id: "edit", label: t("chat.subchat.editSubchat"), onSelect: () => openModal("subchat", { channel }) })),
    button("deleteSubchat", (ctx) => ({
      id: "delete",
      label: t("chat.subchat.deleteSubchat"),
      danger: true,
      onSelect: () =>
        ctx.openModal("confirm", {
          title: t("chat.subchat.deleteNamed", { name: ctx.channel.name }),
          body: t("chat.subchat.theSubchatAndEveryMessageIn"),
          confirmLabel: t("chat.subchat.deleteSubchat"),
          danger: true,
          onConfirm: () => removeSubchat(ctx),
        }),
    })),
  ],
  [button("copySubchatId", ({ channel }) => developerMode() && copyIdItem("copy", t("sidebar.dmMenu.copyChannelId"), channel.id))],
]);
about(subchatMenu, ({ channel }) => ({ channelId: channel.id }));

