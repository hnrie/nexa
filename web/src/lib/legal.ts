/**
 * Platform legal info: single source for the consent gate, the Settings →
 * About page, and the public /terms /privacy /about routes.
 *
 * The full texts live in docs/legal/*.txt for review; this file carries the
 * same substance in a shape the UI can render. Keep them in sync — the .txt
 * files are the canonical wording.
 *
 * Legal text stays in English on purpose (like the law-enforcement report):
 * a translated Terms is a different Terms.
 */

/** Bump when the wording changes so every account is asked again. */
export const LEGAL_VERSION = "2026-09-20";

export const CONTACT_EMAIL = "evilionx3@proton.me";

/** In-app owner account for contact / reports. */
export const OWNER_USERNAME = "nora";

export function termsKey(userId: string): string {
  return `nexa.terms-accepted.${userId}`;
}

export function termsAccepted(userId: string): boolean {
  try {
    return localStorage.getItem(termsKey(userId)) === LEGAL_VERSION;
  } catch {
    return false;
  }
}

export function acceptTerms(userId: string): void {
  try {
    localStorage.setItem(termsKey(userId), LEGAL_VERSION);
  } catch {
    /* private window: the gate shows again next visit, which is the safe side */
  }
}
