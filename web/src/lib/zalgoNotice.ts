import { t } from "@/i18n";
import { useUI } from "@/stores/ui";

let last = 0;

/** Says why zalgo did not go in: once, not again for every key pressed after. */
export function refuseZalgo(): void {
  const now = Date.now();
  if (now - last < 2500) return;
  last = now;
  useUI.getState().toast(t("zalgo.refused"), "error");
}
