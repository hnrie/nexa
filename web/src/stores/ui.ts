import { create } from "zustand";
import type { GatewayStatus } from "@/gateway/client";

export interface ModalState {
  /** Stack entry id; closeModal(id) removes exactly this modal. */
  id?: number;
  kind: string;
  props?: Record<string, unknown>;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  icon?: string;
  onSelect?: () => void;
  separatorAfter?: boolean;
  /** Marks the chosen one of a set of choices, such as the microphone in use. */
  checked?: boolean;
  /** A small title over the items that follow it; not an item itself. */
  heading?: boolean;
  /** Makes the item a slider that takes effect as it moves, and leaves the menu open. */
  slider?: { value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void };
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
  /** Opens upwards, its bottom edge at y: for a button along the bottom of the screen. */
  above?: boolean;
}

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error" | "success";
}

interface UIState {
  connection: GatewayStatus;
  leftOpen: boolean;
  rightOpen: boolean;
  membersOpen: boolean;
  /** The topmost open modal (kept for readers that only care whether one is open). */
  modal: ModalState | null;
  /** Every open modal, bottom to top; a modal opened from inside another stacks above it. */
  modals: ModalState[];
  contextMenu: ContextMenuState | null;
  quickSwitcher: boolean;
  activeChannelId: string | null;
  replyTo: { channelId: string; messageId: string; ping: boolean } | null;
  editing: { channelId: string; messageId: string } | null;
  /**
   * Edits in progress, by channel: the message and what has been typed so far.
   * Going to another conversation parks the edit here, and coming back opens it
   * again with the same text; saving or cancelling ends it.
   */
  editDrafts: Record<string, { messageId: string; text: string | null }>;
  jumpTo: { channelId: string; messageId: string } | null;
  toasts: Toast[];
  focused: boolean;
  setConnection: (s: GatewayStatus) => void;
  setLeftOpen: (v: boolean) => void;
  setRightOpen: (v: boolean) => void;
  toggleMembers: () => void;
  openModal: (kind: string, props?: Record<string, unknown>) => void;
  /** Closes the modal with that id, or the topmost one. */
  closeModal: (id?: number) => void;
  closeAllModals: () => void;
  openContextMenu: (m: ContextMenuState) => void;
  closeContextMenu: () => void;
  setQuickSwitcher: (v: boolean) => void;
  setActiveChannel: (id: string | null) => void;
  setReplyTo: (r: UIState["replyTo"]) => void;
  setEditing: (e: UIState["editing"]) => void;
  setEditDraft: (channelId: string, messageId: string, text: string) => void;
  /** Ends the edit of that one message: its kept text goes, and the open edit closes only if it is this one. */
  endEdit: (channelId: string, messageId: string) => void;
  setJumpTo: (j: UIState["jumpTo"]) => void;
  toast: (text: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
  setFocused: (v: boolean) => void;
}

let toastSeq = 0;
/** Modals that replace themselves rather than stacking. */
const ONE_AT_A_TIME = new Set(["profile", "serverProfile", "memberAction"]);

let modalSeq = 0;

export const useUI = create<UIState>()((set) => ({
  connection: "idle",
  leftOpen: false,
  rightOpen: false,
  membersOpen: true,
  modal: null,
  modals: [],
  contextMenu: null,
  quickSwitcher: false,
  activeChannelId: null,
  replyTo: null,
  editing: null,
  editDrafts: {},
  jumpTo: null,
  toasts: [],
  focused: true,
  setConnection: (connection) => set({ connection }),
  setLeftOpen: (leftOpen) => set(leftOpen ? { leftOpen: true, rightOpen: false } : { leftOpen: false }),
  setRightOpen: (rightOpen) => set(rightOpen ? { rightOpen: true, leftOpen: false } : { rightOpen: false }),
  toggleMembers: () => set((s) => ({ membersOpen: !s.membersOpen })),
  openModal: (kind, props) =>
    set((s) => {
      modalSeq += 1;
      const entry: ModalState = props ? { id: modalSeq, kind, props } : { id: modalSeq, kind };
      // A profile leads to another profile — mutual friends, a group's member
      // list — and stacking them leaves a pile to close one at a time. One of
      // these is open at once: the one being looked at.
      const kept = ONE_AT_A_TIME.has(kind) ? s.modals.filter((m) => m.kind !== kind) : s.modals;
      const modals = [...kept, entry];
      return { modals, modal: entry };
    }),
  closeModal: (id) =>
    set((s) => {
      if (s.modals.length === 0) return s;
      const modals = id === undefined ? s.modals.slice(0, -1) : s.modals.filter((m) => m.id !== id);
      return { modals, modal: modals[modals.length - 1] ?? null };
    }),
  closeAllModals: () => set({ modals: [], modal: null }),
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null }),
  setQuickSwitcher: (quickSwitcher) => set({ quickSwitcher }),
  // Re-activating the open channel keeps a reply or edit in progress; a reply
  // that belongs to another channel is dropped, and an edit waits in
  // editDrafts until its channel is opened again.
  setActiveChannel: (id) =>
    set((s) => {
      if (s.activeChannelId === id) return s;
      // an edit being left behind is kept, even one nothing was typed into yet (null: the message's own text)
      let editDrafts = s.editDrafts;
      if (s.editing && s.editing.channelId !== id && editDrafts[s.editing.channelId]?.messageId !== s.editing.messageId) {
        editDrafts = { ...editDrafts, [s.editing.channelId]: { messageId: s.editing.messageId, text: null } };
      }
      const parked = id ? editDrafts[id] : undefined;
      const editing = s.editing?.channelId === id ? s.editing : id && parked ? { channelId: id, messageId: parked.messageId } : null;
      return { activeChannelId: id, replyTo: s.replyTo?.channelId === id ? s.replyTo : null, editing, editDrafts };
    }),
  setReplyTo: (replyTo) => set({ replyTo }),
  // ending an edit (or starting another in the same channel) forgets the text kept for the old one
  setEditing: (editing) =>
    set((s) => {
      const channelId = editing?.channelId ?? s.editing?.channelId;
      if (!channelId || s.editDrafts[channelId]?.messageId === editing?.messageId) return { editing };
      const editDrafts = { ...s.editDrafts };
      delete editDrafts[channelId];
      return { editing, editDrafts };
    }),
  setEditDraft: (channelId, messageId, text) => set((s) => ({ editDrafts: { ...s.editDrafts, [channelId]: { messageId, text } } })),
  // a save that finishes after its channel was left must not close another channel's edit, or leave its own text to come back
  endEdit: (channelId, messageId) =>
    set((s) => {
      const editing = s.editing?.channelId === channelId && s.editing.messageId === messageId ? null : s.editing;
      if (s.editDrafts[channelId]?.messageId !== messageId) return editing === s.editing ? s : { editing };
      const editDrafts = { ...s.editDrafts };
      delete editDrafts[channelId];
      return { editing, editDrafts };
    }),
  setJumpTo: (jumpTo) => set({ jumpTo }),
  toast: (text, kind = "info") => {
    toastSeq += 1;
    const id = toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setFocused: (focused) => set({ focused }),
}));
