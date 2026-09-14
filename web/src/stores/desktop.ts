import { create } from "zustand";
import type { RpcState, UpdateState, WindowState } from "@/lib/desktopBridge";

/** What the desktop app last said about Rich Presence and updates (nothing in a browser). */
interface DesktopState {
  rpc: RpcState | null;
  update: UpdateState | null;
  /** Where the app's window is (null in a browser, or an app too old to say). */
  window: WindowState | null;
  setRpc: (rpc: RpcState) => void;
  setUpdate: (update: UpdateState) => void;
  setWindow: (window: WindowState) => void;
}

export const useDesktop = create<DesktopState>()((set) => ({
  rpc: null,
  update: null,
  window: null,
  setRpc: (rpc) => set({ rpc }),
  setUpdate: (update) => set({ update }),
  setWindow: (window) => set({ window }),
}));
