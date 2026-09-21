/**
 * The instance owner's account. Hardcoded by id (never the username, which can
 * be renamed or re-registered by someone else): wherever an identity badge or
 * crown can appear, this account gets the RGB owner treatment instead.
 */
export const OWNER_ID = "92209128029552640";

export function isOwner(userId: string | null | undefined): boolean {
  return userId === OWNER_ID;
}
