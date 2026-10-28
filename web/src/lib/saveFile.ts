/** Ask before fetching, while the click still grants permission to open a picker. */
import { t } from "@/i18n";
import { desktopBridge } from "./desktopBridge";

export interface SaveFileHandle {
  createWritable(): Promise<FileWriter>;
}
export interface FileWriter extends WritableStream<Uint8Array> {
  write(data: Blob | Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

/** undefined uses the browser/Electron download flow; null means the person cancelled. */
export async function pickSaveFile(name: string): Promise<SaveFileHandle | null | undefined> {
  // Electron's download manager already has a native Save As dialog.
  if (desktopBridge()) return undefined;
  const picker = (window as Window & { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<SaveFileHandle> }).showSaveFilePicker;
  if (!picker) return undefined;
  try {
    return await picker.call(window, { suggestedName: name });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
}

/** Save a ready file, using the chosen location or the platform's download/share UI. */
export async function saveBlob(blob: Blob, name: string, handle: SaveFileHandle | undefined): Promise<void> {
  if (handle) {
    const out = await handle.createWritable();
    try {
      await out.write(blob);
      await out.close();
    } catch (err) {
      await out.abort(err).catch(() => undefined);
      throw err;
    }
    return;
  }
  const file = new File([blob], name, { type: blob.type });
  if (!desktopBridge() && navigator.canShare?.({ files: [file] })) {
    const share = async (): Promise<void> => {
      try {
        await navigator.share({ files: [file] });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        throw err;
      }
    };
    if (navigator.userActivation?.isActive) await share();
    else {
      // A slow fetch outlives the original tap's permission. One tap on the
      // ready file opens the system sheet, including Save to Files on iOS.
      const { useUI } = await import("@/stores/ui");
      useUI.getState().openModal("confirm", {
        title: t("chat.attachments.download"), body: name,
        confirmLabel: t("chat.attachments.download"), onConfirm: share,
      });
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
