/**
 * Puts `window.evilionDesktop` on nexa's pages, and on nothing else.
 * Only named calls cross over; the page never gets ipcRenderer itself.
 * web/src/lib/desktopBridge.ts describes this object to the page.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC, type DesktopSettings, type DisplaySourceRequest, type Identity, type RpcActivity, type RpcState, type UpdateState, type WindowState } from "../shared/bridge";

const arg = (name: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";
const origin = arg("evilion-origin");
const version = arg("evilion-version");
const shareAudioMode = arg("evilion-share-audio");
const shareAudio = shareAudioMode === "own" || shareAudioMode === "all";
const windowAudio = arg("evilion-window-audio") === "1";

function listen<T>(channel: string) {
  return (cb: (payload: T) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: T) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

if (origin && location.origin === origin) {
  contextBridge.exposeInMainWorld("evilionDesktop", {
    version,
    platform: process.platform,
    shareAudio,
    shareAudioMode,
    windowAudio,
    rpc: {
      getState: (): Promise<RpcState> => ipcRenderer.invoke(IPC.rpcGetState),
      setEnabled: (on: boolean): Promise<void> => ipcRenderer.invoke(IPC.rpcSetEnabled, !!on),
      setRelay: (on: boolean): Promise<void> => ipcRenderer.invoke(IPC.rpcSetRelay, !!on),
      setHidden: (clientId: string, hidden: boolean): Promise<void> => ipcRenderer.invoke(IPC.rpcSetHidden, String(clientId), !!hidden),
      restartDiscord: (): Promise<boolean> => ipcRenderer.invoke(IPC.rpcRestartDiscord),
      onState: listen<RpcState>(IPC.rpcState),
    },
    onActivities: listen<RpcActivity[]>(IPC.activities),
    setIdentity: (user: Identity | null): void => ipcRenderer.send(IPC.setIdentity, user ? { id: String(user.id), username: String(user.username), global_name: String(user.global_name), avatar: user.avatar ? String(user.avatar) : null } : null),
    updates: {
      getState: (): Promise<UpdateState> => ipcRenderer.invoke(IPC.updateGetState),
      check: (): Promise<void> => ipcRenderer.invoke(IPC.updateCheck),
      restart: (): Promise<void> => ipcRenderer.invoke(IPC.updateRestart),
      onState: listen<UpdateState>(IPC.updateState),
    },
    settings: {
      get: (): Promise<DesktopSettings> => ipcRenderer.invoke(IPC.settingsGet),
      set: (patch: Partial<DesktopSettings>): Promise<DesktopSettings> => ipcRenderer.invoke(IPC.settingsSet, patch),
    },
    setBadge: (count: number): void => ipcRenderer.send(IPC.setBadge, Number(count) || 0),
    setCallActive: (active: boolean): void => ipcRenderer.send(IPC.setCallActive, !!active),
    onDisplaySources: listen<DisplaySourceRequest>(IPC.displaySources),
    chooseDisplaySource: (requestId: string, sourceId: string | null, withAudio: boolean): void => ipcRenderer.send(IPC.displayChoose, String(requestId), sourceId === null ? null : String(sourceId), !!withAudio),
    onTrayAction: listen<"mute" | "deafen">(IPC.trayAction),
    focusWindow: (): void => ipcRenderer.send(IPC.focusWindow),
    requestAttention: (): void => ipcRenderer.send(IPC.requestAttention),
    getWindowState: (): Promise<WindowState> => ipcRenderer.invoke(IPC.windowGetState),
    shareAudioFailed: (): Promise<boolean> => ipcRenderer.invoke(IPC.shareAudioFailed),
    onWindowState: listen<WindowState>(IPC.windowState),
  });
}
