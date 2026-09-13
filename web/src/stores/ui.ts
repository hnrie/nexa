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
  /** Makes the item a slider that takes effect as it moves, and leaves the menu open. */
  slider?: { value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void };
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
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
  setJumpTo: (j: UIState["jumpTo"]) => void;
  toast: (text: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
  setFocused: (v: boolean) => void;
}

let toastSeq = 0;
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
      const modals = [...s.modals, entry];
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
  // Re-activating the open channel keeps a reply or edit in progress; only
  // one that belongs to another channel is dropped.
  setActiveChannel: (id) =>
    set((s) =>
      s.activeChannelId === id
        ? s
        : { activeChannelId: id, replyTo: s.replyTo?.channelId === id ? s.replyTo : null, editing: s.editing?.channelId === id ? s.editing : null },
    ),
  setReplyTo: (replyTo) => set({ replyTo }),
  setEditing: (editing) => set({ editing }),
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
