/**
 * The searches the search box offers again.
 *
 * They live in the account's settings, which are encrypted on this device
 * before they are saved (lib/settingsCrypto.ts), so what someone searched for
 * reaches their other devices and never the server in a form it can read. A
 * few short ones only: the whole settings blob is sealed and sent again on
 * every change.
 */
import { useSettings } from "@/stores/settings";

export const MAX_RECENT = 8;
const MAX_LENGTH = 200;

export function rememberSearch(raw: string): void {
  const q = raw.trim().replace(/\s+/g, " ");
  if (!q || q.length > MAX_LENGTH) return;
  const { settings, loaded, patch } = useSettings.getState();
  // before the account's settings arrive there is nothing to add to
  if (!loaded) return;
  const rest = settings.searchRecent.filter((r) => r.toLowerCase() !== q.toLowerCase());
  const next = [q, ...rest].slice(0, MAX_RECENT);
  if (next.join("\n") === settings.searchRecent.join("\n")) return;
  patch({ searchRecent: next });
}

export function forgetSearch(raw: string): void {
  const { settings, patch } = useSettings.getState();
  const next = settings.searchRecent.filter((r) => r !== raw);
  if (next.length !== settings.searchRecent.length) patch({ searchRecent: next });
}

export function clearRecentSearches(): void {
  const { settings, patch } = useSettings.getState();
  if (settings.searchRecent.length) patch({ searchRecent: [] });
}
