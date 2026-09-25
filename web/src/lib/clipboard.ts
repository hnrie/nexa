import { t } from "@/i18n";
import { useUI } from "@/stores/ui";

/**
 * The old way, for where `navigator.clipboard` is missing (a page served over
 * plain http, some embedded web views): a hidden box, selected and copied. It
 * only works inside the click that asked for it, which is where this runs.
 */
function copyTheOldWay(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.position = "fixed";
  box.style.opacity = "0";
  box.style.pointerEvents = "none";
  document.body.appendChild(box);
  const had = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  try {
    box.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    box.remove();
    had?.focus({ preventScroll: true });
  }
}

/**
 * Puts text on the clipboard and says so, or says that it could not.
 *
 * Copying used to be fire and forget: nothing showed that it worked, and when
 * the browser refused (Safari outside a click, a denied permission, no
 * clipboard at all) nothing showed that either, so the next paste quietly put
 * whatever was on the clipboard before into another conversation.
 */
export async function copyText(text: string, done?: string): Promise<boolean> {
  const ui = useUI.getState();
  try {
    if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
    await navigator.clipboard.writeText(text);
  } catch {
    if (!copyTheOldWay(text)) {
      ui.toast(t("clipboard.couldNotCopy"), "error");
      return false;
    }
  }
  ui.toast(done ?? t("clipboard.copied"), "success");
  return true;
}
