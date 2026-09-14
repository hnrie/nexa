import { useEffect, useState } from "react";
import { fullscreenElement, onFullscreenChange } from "@/lib/fullscreen";

/** Where a floating layer mounts right now; see usePortalRoot. */
export function portalRoot(): HTMLElement {
  const el = fullscreenElement();
  return el instanceof HTMLElement ? el : document.body;
}

/**
 * Where floating layers (dialogs, menus, tooltips, toasts) mount. While a
 * call or a stream is full screen, the browser draws nothing outside that
 * element, so they mount inside it instead of on the body.
 */
export function usePortalRoot(): HTMLElement {
  const [root, setRoot] = useState<HTMLElement>(portalRoot);
  useEffect(() => onFullscreenChange(() => setRoot(portalRoot())), []);
  return root;
}
