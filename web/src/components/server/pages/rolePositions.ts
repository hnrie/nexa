import { canManageRole } from "@/lib/perms";

interface Positioned {
  id: string;
  position: number;
}

/**
 * The positions to send when a role is dropped next to another one. `roles` is
 * sorted top (highest position) first and excludes @everyone. The owner renumbers
 * the whole list. Anyone else may only send roles below their own highest role,
 * so only those are moved, and they swap the positions they already hold: that
 * keeps every one of them below the actor's highest role, as the server requires.
 * Returns null when the drop is not allowed.
 */
export function rolePositionsAfterDrop(roles: Positioned[], movingId: string, targetId: string, after: boolean, actorHighest: number, actorIsOwner: boolean): Positioned[] | null {
  const pool = actorIsOwner ? roles : roles.filter((r) => canManageRole(actorHighest, false, r.position));
  const moving = pool.find((r) => r.id === movingId);
  if (!moving || movingId === targetId || !pool.some((r) => r.id === targetId)) return null;
  const list = pool.filter((r) => r.id !== movingId);
  const idx = list.findIndex((r) => r.id === targetId) + (after ? 1 : 0);
  list.splice(idx, 0, moving);
  // top of the list = highest position
  if (actorIsOwner) return list.map((r, i) => ({ id: r.id, position: list.length - i }));
  const slots = pool.map((r) => r.position).sort((a, b) => b - a);
  return list.map((r, i) => ({ id: r.id, position: slots[i]! }));
}
