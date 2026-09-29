/**
 * The whole of what the picker window can reach.
 *
 * Three messages, one direction each. No file system, no network, no Node —
 * the page it serves loads nothing and has nothing to be tricked into.
 */
import { contextBridge, ipcRenderer } from "electron";

interface Source {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnail: string;
  icon?: string;
}

interface Offer {
  sources: Source[];
  audio: boolean;
  dark: boolean;
}

contextBridge.exposeInMainWorld("picker", {
  /** Tells the main process the page is up, and takes the list it answers with. */
  ready(onOffer: (offer: Offer) => void): void {
    ipcRenderer.once("picker:ready", (_event, offer: Offer) => onOffer(offer));
    ipcRenderer.send("picker:ready");
  },
  choose(sourceId: string, withAudio: boolean): void {
    ipcRenderer.send("picker:choose", { sourceId, withAudio });
  },
  cancel(): void {
    ipcRenderer.send("picker:cancel");
  },
});
