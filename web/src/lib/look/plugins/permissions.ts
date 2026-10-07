/**
 * What a v2 plugin can ask to do. The person grants them when the plugin is
 * added (the prompt is step 5 of the plugin plan; until then a plugin is
 * granted what it asks for) and can take any of them away later. Every v2
 * method checks its permission as it is called, against the grants as they
 * are at that moment.
 */

export const PERMISSIONS = [
  "users.read",
  "users.self.read",
  "users.self.write",
  "users.relationships.read",
  "users.relationships.write",
  "directmessages.read",
  "directmessages.write",
  "servers.read",
  "servers.write",
  "servers.members.read",
  "servers.members.write",
  "servers.channels.read",
  "servers.channels.write",
  "servers.messages.read",
  "servers.messages.write",
  "styles.write",
  "events.read",
  "events.write",
  "keybinds.read",
  "keybinds.write",
  "commands.write",
  "storage.read",
  "storage.write",
  "ui.write",
  "stores",
] as const;

export type PermissionName = (typeof PERMISSIONS)[number];

/** Marked as dangerous wherever permissions are shown: the app's own state, past what any other permission gives. */
export const DANGEROUS_PERMISSIONS: readonly PermissionName[] = ["stores"];

const KNOWN = new Set<string>(PERMISSIONS);

export function isPermission(x: unknown): x is PermissionName {
  return typeof x === "string" && KNOWN.has(x);
}

/** A list of permissions as a plugin or the saved settings give it: the known ones, each once, in the list's order. */
export function cleanPermissions(v: unknown): PermissionName[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: PermissionName[] = [];
  for (const p of v) {
    if (!isPermission(p) || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}
