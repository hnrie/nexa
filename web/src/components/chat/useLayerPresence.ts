import { useEffect } from "react";
import { layersChanged } from "@/components/shell/backLayers";

/**
 * Tells the back gesture a layer drawn in place has opened, and again when it
 * closes. The gesture closes whatever is open over the page, and it notices
 * dialogs and menus by the body's children, where they are portalled; the
 * emoji picker over the message box and the subchat panel under the header
 * are drawn inside the page, so back went to the previous page behind them.
 */
export function useLayerPresence(open = true): void {
  useEffect(() => {
    if (!open) return;
    layersChanged();
    return layersChanged;
  }, [open]);
}
