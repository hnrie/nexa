import { create } from "zustand";
import type { GatewayStatus } from "@/gateway/client";

export interface ModalState {
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
  modal: ModalState | null;
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
  closeModal: () => void;
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

export const useUI = create<UIState>()((set) => ({
  connection: "idle",
  leftOpen: false,
  rightOpen: false,
  membersOpen: true,
  modal: null,
  contextMenu: null,
  quickSwitcher: false,
  activeChannelId: null,
  replyTo: null,
  editing: null,
  jumpTo: null,
  toasts: [],
  focused: true,
  setConnection: (connection) => set({ connection }),
  setLeftOpen: (leftOpen) => set({ leftOpen, rightOpen: leftOpen ? false : undefined } as Partial<UIState>),
  setRightOpen: (rightOpen) => set({ rightOpen, leftOpen: rightOpen ? false : undefined } as Partial<UIState>),
  toggleMembers: () => set((s) => ({ membersOpen: !s.membersOpen })),
  openModal: (kind, props) => set({ modal: props ? { kind, props } : { kind } }),
  closeModal: () => set({ modal: null }),
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null }),
  setQuickSwitcher: (quickSwitcher) => set({ quickSwitcher }),
  setActiveChannel: (activeChannelId) => set({ activeChannelId, replyTo: null, editing: null }),
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
