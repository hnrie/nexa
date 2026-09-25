import { t } from "@/i18n";
import { useUI } from "@/stores/ui";

/**
 * Puts text on the clipboard and says whether it got there.
 *
 * `navigator.clipboard.writeText` is missing altogether on a page served over
 * plain http, and rejects when the document is not focused or the browser
 * refuses the permission. Called as `navigator.clipboard?.writeText(x).then(ok)`
 * every one of those was a Copy button that did nothing and said nothing, which
 * matters most for the things only ever shown once — a recovery key, a set of
 * backup codes. This never throws: it tries the clipboard, falls back to the
 * old selection-and-copy command, and answers false only when neither worked,
 * so the caller can say so.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // refused or unfocused: the selection route below may still work
  }
  return copyBySelection(text);
}

/**
 * Copies and says how it went in a toast — for a menu item, which is gone by
 * the time the copy finishes and so has nowhere of its own to show it.
 */
export function copyAndSay(text: string, done: string = t("chat.groupMemberMenu.copied")): void {
  void copyText(text).then((ok) => useUI.getState().toast(ok ? done : t("common.copyFailed"), ok ? "success" : "error"));
}

function copyBySelection(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  // on screen, or some browsers will not select it; invisible and out of the way
  Object.assign(area.style, { position: "fixed", inset: "0", width: "1px", height: "1px", opacity: "0", pointerEvents: "none" });
  const before = document.activeElement as HTMLElement | null;
  document.body.append(area);
  try {
    area.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    before?.focus?.({ preventScroll: true });
  }
}
