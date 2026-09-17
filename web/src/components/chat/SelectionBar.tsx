import { Trash2, X } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/common/Button";
import cs from "@/components/composer/Composer.module.css";
import { useMessages } from "@/stores/messages";
import { useSelection } from "@/stores/selection";
import { useUI } from "@/stores/ui";
import { canPick, deleteMessagesNow } from "./messageMenu";
import s from "./Chat.module.css";

import { t as tr_ } from "@/i18n";
/** Takes the composer's place while picking messages to delete. */
export function SelectionBar({ channelId }: { channelId: string }) {
  const picked = useSelection((x) => x.picked);
  const clear = useSelection((x) => x.clear);
  const loaded = useMessages((m) => m.channels[channelId]?.byId);
  const openModal = useUI((u) => u.openModal);
  // A picked message deleted by someone else meanwhile no longer counts, nor
  // does one this account may no longer delete (a moderator who lost the
  // role): sent along, it would get the whole batch refused.
  const ids = Object.keys(picked).filter((id) => {
    const m = loaded?.[id];
    return !!m && canPick(m);
  });
  const count = ids.length;

  // Escape stops picking, but only once every layer that wants it first
  // (menus, dialogs, the lightbox, a field, full screen) has had its turn:
  // those listen on the document or stop it there, and this listens after, on the window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const ui = useUI.getState();
      if (ui.contextMenu || ui.quickSwitcher || document.querySelector("[data-modal-layer], [role=dialog]")) return;
      clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clear]);

  const confirm = () =>
    openModal("confirm", {
      title: tr_("chat.selectionBar.deleteMessages", { count }),
      body: tr_("chat.selectionBar.areYouSureDeleteMessages", { count }),
      confirmLabel: tr_("chat.messageItem.delete"),
      danger: true,
      onConfirm: async () => {
        await deleteMessagesNow(channelId, ids);
        useSelection.getState().clear();
      },
    });

  return (
    <div className={cs.wrap}>
      <div className={s.selectBar} data-testid="selection-bar">
        <button type="button" className={s.selectCancel} aria-label={tr_("chat.selectionBar.stopSelecting")} title={tr_("chat.selectionBar.stopSelectingEsc")} onClick={clear}>
          <X size={20} />
        </button>
        <span className={s.selectCount} aria-live="polite">
          {count === 0 ? tr_("chat.selectionBar.selectMessagesToDelete") : tr_("chat.selectionBar.messagesSelected", { count })}
        </span>
        <Button variant="danger" size="sm" className={s.selectDelete} disabled={count === 0} onClick={confirm} data-testid="delete-selected">
          <Trash2 size={16} /> {tr_("chat.messageItem.delete")}
        </Button>
      </div>
    </div>
  );
}
