import { translator } from "@/i18n";

const collators = new Map<string, Intl.Collator>();

/**
 * Sorts names the way the app's language does, not the browser's: someone
 * reading in Swedish on an English system expects å after z. One collator per
 * language, since building one is the slow part and a member list sorts
 * thousands of names.
 */
export function nameOrder(): Intl.Collator {
  const locale = translator().locale;
  let c = collators.get(locale);
  if (!c) {
    try {
      c = new Intl.Collator(locale, { sensitivity: "base" });
    } catch {
      c = new Intl.Collator(undefined, { sensitivity: "base" });
    }
    collators.set(locale, c);
  }
  return c;
}
