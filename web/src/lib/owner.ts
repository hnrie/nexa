import { useNexa } from "@/stores/nexa";

/**
 * The instance owner's account, as built in. Hardcoded by id (never the
 * username, which can be renamed or re-registered by someone else): wherever
 * an identity badge or crown can appear, this account gets the RGB owner
 * treatment instead. The server names the owner it is set up with to every
 * account (its oldest admin, in the Nexa state), and that one is used when it
 * is known; this is for before then, and for servers too old to say.
 */
export const OWNER_ID = "92209128029552640";

/** The owner the server named, or the built-in one. */
function pick(named: string | null | undefined): string {
  return named && named !== "0" ? named : OWNER_ID;
}

/** The instance owner's account id. */
export function ownerId(): string {
  return pick(useNexa.getState().state?.owner_id);
}

export function isOwner(userId: string | null | undefined): boolean {
  return !!userId && userId === ownerId();
}

/** The instance owner's account id, for a component that redraws when it becomes known. */
export function useOwnerId(): string {
  return pick(useNexa((n) => n.state?.owner_id));
}
