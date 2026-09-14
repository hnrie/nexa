import { MessageCircle, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { channels as channelsApi } from "@/api/channels";
import type { Channel } from "@/api/types";
import { Spinner } from "@/components/common/Spinner";
import { compareIds } from "@/lib/ids";
import { selectSubchats, useChannels } from "@/stores/channels";
import { isUnread, useReadStates } from "@/stores/readStates";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import s from "./Chat.module.css";
import { promptText } from "@/components/modals/PromptModal";

/** Menu for one subchat row: rename, or delete for everyone. */
export function subchatMenuItems(ch: Channel, ctx: { openModal: (k: string, p?: Record<string, unknown>) => void; nav: (p: string) => void }): ContextMenuItem[] {
  const toast = useUI.getState().toast;
  const rename = async (name: string) => {
    try {
      await channelsApi.patch(ch.id, { name });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not rename that subchat.", "error");
    }
  };
  const remove = async () => {
    try {
      await channelsApi.close(ch.id);
      useChannels.getState().remove(ch.id);
      if (ch.parent_id) ctx.nav(`/channels/@me/${ch.parent_id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not delete that subchat.", "error");
    }
  };
  return [
    {
      id: "rename",
      label: "Rename Subchat",
      onSelect: () =>
        void promptText("Rename Subchat", { label: "Subchat name", initial: ch.name, maxLength: 100 }, "Rename").then((value) => {
          const next = value?.trim();
          if (next && next !== ch.name) void rename(next);
        }),
    },
    {
      id: "delete",
      label: "Delete Subchat",
      danger: true,
      onSelect: () =>
        ctx.openModal("confirm", {
          title: `Delete '${ch.name}'`,
          body: "The subchat and every message in it are removed for everyone in this conversation. This cannot be undone.",
          confirmLabel: "Delete Subchat",
          danger: true,
          onConfirm: remove,
        }),
    },
  ];
}

interface Props {
  /** The DM or group the subchats belong to. */
  parent: Channel;
  activeId: string;
  onClose: () => void;
}

/** The list of side conversations inside a DM, with a box to start another. */
export function SubchatPanel({ parent, activeId, onClose }: Props) {
  const nav = useNavigate();
  const byId = useChannels((c) => c.byId);
  const upsert = useChannels((c) => c.upsert);
  const reads = useReadStates((r) => r.byChannel);
  const openModal = useUI((u) => u.openModal);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const toast = useUI((u) => u.toast);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = selectSubchats(byId, parent.id);

  useEffect(() => {
    let alive = true;
    channelsApi
      .subchats(parent.id)
      .then((rows) => {
        if (alive) upsert(rows);
      })
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [parent.id, upsert]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // the header's own Subchats button toggles the popup shut on its click
      if ((e.target as Element).closest?.('[data-pop-toggle="subchats"]')) return;
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const ch = await channelsApi.createSubchat(parent.id, trimmed);
      upsert([ch]);
      setName("");
      onClose();
      nav(`/channels/@me/${ch.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not start that subchat.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.subPanel} ref={box} role="dialog" aria-label="Subchats" data-testid="subchat-panel">
      <div className={s.subHead}>
        <MessageCircle size={16} />
        <span>Subchats</span>
        <button className={s.subClose} aria-label="Close subchats" onClick={onClose}><X size={16} /></button>
      </div>
      <p className={s.subHint}>Side conversations inside this chat. Everyone here can see them, and each one is encrypted under its own key.</p>
      <div className={s.subList}>
        {loading && list.length === 0 ? <div className={s.subEmpty}><Spinner size={18} /></div> : null}
        {!loading && list.length === 0 ? <div className={s.subEmpty}>No subchats yet.</div> : null}
        {list.map((ch) => {
          const rs = reads[ch.id];
          const unread = isUnread(rs, ch.last_message_id) && ch.id !== activeId;
          return (
            <button
              key={ch.id}
              className={s.subRow}
              data-selected={ch.id === activeId}
              data-unread={unread}
              data-subchat={ch.id}
              onClick={() => {
                onClose();
                nav(`/channels/@me/${ch.id}`);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                openContextMenu({ x: e.clientX, y: e.clientY, items: subchatMenuItems(ch, { openModal, nav }) });
              }}
            >
              <MessageCircle size={16} className={s.subIcon} />
              <span className={s.subName}>{ch.name}</span>
              {(rs?.mentions ?? 0) > 0 ? <span className={s.subBadge}>{rs?.mentions}</span> : null}
            </button>
          );
        })}
      </div>
      <form
        className={s.subNew}
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input
          ref={input}
          value={name}
          maxLength={48}
          placeholder="New subchat name"
          aria-label="New subchat name"
          data-testid="subchat-name"
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" aria-label="Create subchat" disabled={!name.trim() || busy} data-testid="subchat-create"><Plus size={16} /></button>
      </form>
    </div>
  );
}

/** Sorts subchats the way the panel does, for anywhere else that lists them. */
export function sortSubchats(list: Channel[]): Channel[] {
  return [...list].sort((a, b) => compareIds(b.last_message_id ?? b.id, a.last_message_id ?? a.id));
}
