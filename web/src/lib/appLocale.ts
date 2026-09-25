import { useEffect } from "react";
import { useSettings } from "@/stores/settings";
import { storage } from "./storage";

const KEY = "ec:locale";

/**
 * The language to draw the app in: the account's choice once its settings are
 * here, and until then — or once they are put away — the choice this device
 * last saw. The settings are encrypted and only arrive with the connection,
 * and locking the app or signing out forgets them, so the passcode screen and
 * the sign-in page used to come up in the browser's language instead of the
 * one the person reads.
 */
export function useAppLocale(): string | null {
  const loaded = useSettings((s) => s.loaded);
  const chosen = useSettings((s) => s.settings.locale);
  useEffect(() => {
    if (!loaded) return;
    if (chosen) storage.set(KEY, chosen);
    else storage.remove(KEY);
  }, [loaded, chosen]);
  return loaded ? chosen : storage.get(KEY);
}
