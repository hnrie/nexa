import { create } from "zustand";
import type { RpcState, UpdateState } from "@/lib/desktopBridge";

/** What the desktop app last said about Rich Presence and updates (nothing in a browser). */
interface DesktopState {
  rpc: RpcState | null;
  update: UpdateState | null;
  setRpc: (rpc: RpcState) => void;
  setUpdate: (update: UpdateState) => void;
}

export const useDesktop = create<DesktopState>()((set) => ({
  rpc: null,
  update: null,
  setRpc: (rpc) => set({ rpc }),
  setUpdate: (update) => set({ update }),
}));
