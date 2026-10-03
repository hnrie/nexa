/**
 * The server rail as the person arranged it: servers, folders of servers, and
 * which of them are pinned to the top.
 *
 * It is kept in the synced settings, so every device of the account shows the
 * same rail. What is stored can still name servers the account has left, and
 * does not know the servers joined since it was saved; `resolveRail` turns it
 * into what the rail shows, and every change here starts from that, so each
 * save also forgets what has gone.
 */

/** A folder of servers in the rail. */
export interface ServerFolder {
  /** "f" and a few letters or digits: never a server's id, which is all digits. */
  id: string;
  /** What the person called it; empty shows its servers' names instead. */
  name: string;
  /** "#rrggbb", or null for the accent colour. */
  color: string | null;
  /** Its servers, top first. */
  servers: string[];
  /** Whether it shows its servers under it. */
  open?: boolean;
}

/** One entry of the rail: a server's id, or a folder. */
export type RailEntry = string | ServerFolder;

export interface RailLayout {
  /** At the top, above everything else. Nothing new ever lands above these. */
  pinned: RailEntry[];
  /** Everything else, top first. A server joined since lands at the top of these. */
  rest: RailEntry[];
}

export type RailSection = "pinned" | "rest";

/** Where an entry is: its section, its place there, and the folder it is in. */
export interface RailPlace {
  section: RailSection;
  /** Its index in the section, or its folder's index when it is in one. */
  index: number;
  folder: ServerFolder | null;
  /** Its index in the folder, or -1. */
  inFolder: number;
}

/** Where a dragged server or folder is dropped: beside an entry, or on it (a new folder, or into one). */
export interface RailDrop {
  id: string;
  where: "before" | "after" | "combine";
}

/** How long a folder's name may be. */
export const FOLDER_NAME_MAX = 40;

const SERVER_ID = /^\d{1,20}$/;
const FOLDER_ID = /^f[a-z0-9]{1,16}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const SECTIONS: RailSection[] = ["pinned", "rest"];

export function isFolder(e: RailEntry | undefined): e is ServerFolder {
  return typeof e === "object" && e !== null;
}

export function entryId(e: RailEntry): string {
  return typeof e === "string" ? e : e.id;
}

/** Servers in the order chosen before folders existed (settings.serverPositions), then in join order. */
export function orderedServerIds(order: string[], positions: string[]): string[] {
  const known = new Set(order);
  const out = positions.filter((id) => known.has(id));
  for (const id of order) if (!out.includes(id)) out.push(id);
  return out;
}

/** The layout the order chosen before folders existed becomes: the same order, nothing pinned. */
export function fromPositions(ids: string[]): RailLayout {
  return { pinned: [], rest: [...ids] };
}

/**
 * A stored layout, read defensively: it comes from a blob any version of the
 * app may have written. Anything malformed is left out, and each server is
 * kept once, where it first appears.
 */
export function sanitizeRail(x: unknown): RailLayout | null {
  if (!x || typeof x !== "object") return null;
  const raw = x as { pinned?: unknown; rest?: unknown };
  const seen = new Set<string>();
  const folderIds = new Set<string>();
  const server = (id: unknown): id is string => typeof id === "string" && SERVER_ID.test(id) && !seen.has(id);
  const entries = (list: unknown): RailEntry[] => {
    if (!Array.isArray(list)) return [];
    const out: RailEntry[] = [];
    for (const e of list) {
      if (typeof e === "string") {
        if (server(e)) {
          seen.add(e);
          out.push(e);
        }
        continue;
      }
      if (!e || typeof e !== "object") continue;
      const f = e as Partial<Record<keyof ServerFolder, unknown>>;
      if (typeof f.id !== "string" || !FOLDER_ID.test(f.id) || folderIds.has(f.id)) continue;
      folderIds.add(f.id);
      const servers: string[] = [];
      for (const id of Array.isArray(f.servers) ? f.servers : []) {
        if (!server(id)) continue;
        seen.add(id);
        servers.push(id);
      }
      const folder: ServerFolder = {
        id: f.id,
        name: typeof f.name === "string" ? f.name.slice(0, FOLDER_NAME_MAX) : "",
        color: typeof f.color === "string" && COLOR.test(f.color) ? f.color.toLowerCase() : null,
        servers,
      };
      if (f.open === true) folder.open = true;
      out.push(folder);
    }
    return out;
  };
  return { pinned: entries(raw.pinned), rest: entries(raw.rest) };
}

/**
 * What the rail shows: the servers still joined, each once, without the
 * folders left empty, and the servers the layout does not know yet at the top
 * of the unpinned ones, the newest first. `joined` is in join order. With no
 * layout yet, it is the order chosen before folders existed.
 */
export function resolveRail(layout: RailLayout | null, joined: string[], positions: string[] = []): RailLayout {
  if (!layout) return fromPositions(orderedServerIds(joined, positions));
  const live = new Set(joined);
  const placed = new Set<string>();
  const keep = (list: RailEntry[]): RailEntry[] => {
    const out: RailEntry[] = [];
    for (const e of list) {
      if (typeof e === "string") {
        if (live.has(e) && !placed.has(e)) {
          placed.add(e);
          out.push(e);
        }
        continue;
      }
      const servers: string[] = [];
      for (const id of e.servers) {
        if (!live.has(id) || placed.has(id)) continue;
        placed.add(id);
        servers.push(id);
      }
      if (servers.length > 0) out.push({ ...e, servers });
    }
    return out;
  };
  const pinned = keep(layout.pinned);
  const rest = keep(layout.rest);
  const fresh = joined.filter((id) => !placed.has(id)).reverse();
  return { pinned, rest: [...fresh, ...rest] };
}

/** Where the server or folder with this id is, or null. */
export function findPlace(layout: RailLayout, id: string): RailPlace | null {
  for (const section of SECTIONS) {
    const list = layout[section];
    for (let i = 0; i < list.length; i++) {
      const e = list[i]!;
      if (entryId(e) === id) return { section, index: i, folder: null, inFolder: -1 };
      if (isFolder(e)) {
        const j = e.servers.indexOf(id);
        if (j >= 0) return { section, index: i, folder: e, inFolder: j };
      }
    }
  }
  return null;
}

/** Whether this server or folder is pinned itself (a server in a pinned folder is not). */
export function isPinned(layout: RailLayout, id: string): boolean {
  const at = findPlace(layout, id);
  return !!at && at.section === "pinned" && !at.folder;
}

/** The folder a server is in, or null. */
export function folderOf(layout: RailLayout, serverId: string): ServerFolder | null {
  return findPlace(layout, serverId)?.folder ?? null;
}

/** Every folder, top first. */
export function foldersOf(layout: RailLayout): ServerFolder[] {
  return [...layout.pinned, ...layout.rest].filter(isFolder);
}

/** The ids an entry moves among: its folder's servers, or its section's entries. */
export function siblingIds(layout: RailLayout, id: string): string[] {
  const at = findPlace(layout, id);
  if (!at) return [];
  return at.folder ? [...at.folder.servers] : layout[at.section].map(entryId);
}

/** The servers top to bottom, folders' servers included: the order the rail draws them in. */
export function railServerIds(layout: RailLayout): string[] {
  return [...layout.pinned, ...layout.rest].flatMap((e) => (typeof e === "string" ? [e] : e.servers));
}

/** A copy to change: the sections and each folder in them. */
function clone(layout: RailLayout): RailLayout {
  const copy = (list: RailEntry[]) => list.map((e) => (typeof e === "string" ? e : { ...e, servers: [...e.servers] }));
  return { pinned: copy(layout.pinned), rest: copy(layout.rest) };
}

/** Takes an entry out, with the folder it leaves empty, and returns it. */
function take(layout: RailLayout, id: string): RailEntry | null {
  const at = findPlace(layout, id);
  if (!at) return null;
  const list = layout[at.section];
  if (at.folder) {
    at.folder.servers.splice(at.inFolder, 1);
    if (at.folder.servers.length === 0) list.splice(at.index, 1);
    return id;
  }
  return list.splice(at.index, 1)[0] ?? null;
}

/** A folder id nothing in the layout has. */
export function newFolderId(layout: RailLayout, random: () => number = Math.random): string {
  const used = new Set(foldersOf(layout).map((f) => f.id));
  for (;;) {
    const id = `f${Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0")}`;
    if (!used.has(id)) return id;
  }
}

/** Pins a server or folder: to the bottom of the pinned ones, out of its folder if it was in one. */
export function pinEntry(layout: RailLayout, id: string): RailLayout {
  const at = findPlace(layout, id);
  if (!at || (at.section === "pinned" && !at.folder)) return layout;
  const next = clone(layout);
  const e = take(next, id);
  if (e === null) return layout;
  next.pinned.push(e);
  return next;
}

/** Unpins a server or folder: to the top of the rest, just under the pinned ones. */
export function unpinEntry(layout: RailLayout, id: string): RailLayout {
  const at = findPlace(layout, id);
  if (!at || at.section !== "pinned" || at.folder) return layout;
  const next = clone(layout);
  const e = take(next, id);
  if (e === null) return layout;
  next.rest.unshift(e);
  return next;
}

/** Moves an entry `delta` places among its siblings (see siblingIds); unchanged when there is no room. */
export function moveEntry(layout: RailLayout, id: string, delta: number): RailLayout {
  const next = clone(layout);
  const at = findPlace(next, id);
  if (!at) return layout;
  const list: RailEntry[] = at.folder ? at.folder.servers : next[at.section];
  const from = at.folder ? at.inFolder : at.index;
  const to = from + delta;
  if (to < 0 || to >= list.length) return layout;
  const [e] = list.splice(from, 1);
  list.splice(to, 0, e!);
  return next;
}

/**
 * Where a dragged server or folder lands. Beside an entry it takes that
 * entry's place in its list, a folder's servers included; on a server it makes
 * a folder of the two; on a folder it goes in at the end. Folders do not go
 * inside folders: one dropped among a folder's servers goes beside the folder.
 * The section it lands in decides whether it is pinned.
 */
export function dropEntry(layout: RailLayout, dragId: string, drop: RailDrop, makeId: (l: RailLayout) => string = newFolderId): RailLayout {
  if (dragId === drop.id) return layout;
  const from = findPlace(layout, dragId);
  const onto = findPlace(layout, drop.id);
  if (!from || !onto) return layout;
  const dragged = from.folder ? dragId : layout[from.section][from.index]!;
  let target = drop;
  if (isFolder(dragged)) {
    if (onto.folder) target = { id: onto.folder.id, where: drop.where === "before" ? "before" : "after" };
    else if (drop.where === "combine") target = { id: drop.id, where: "after" };
    if (target.id === dragId) return layout;
  }
  const next = clone(layout);
  const e = take(next, dragId);
  if (e === null) return layout;
  const at = findPlace(next, target.id);
  if (!at) {
    // The target went with it: the last server of a folder, dropped beside
    // its own folder, which taking it out emptied. Out of the folder is what
    // was asked, and where the folder stood is where that is. Dropped on its
    // own folder, there is nowhere else for it to go.
    if (from.folder && target.id === from.folder.id && target.where !== "combine") {
      next[from.section].splice(from.index, 0, e);
      return next;
    }
    return layout;
  }
  if (target.where === "combine") {
    const server = e as string;
    if (at.folder) {
      at.folder.servers.splice(at.inFolder + 1, 0, server);
      return next;
    }
    const list = next[at.section];
    const t = list[at.index]!;
    if (isFolder(t)) t.servers.push(server);
    else list[at.index] = { id: makeId(next), name: "", color: null, servers: [t, server] };
    return next;
  }
  const off = target.where === "after" ? 1 : 0;
  if (at.folder) at.folder.servers.splice(at.inFolder + off, 0, e as string);
  else next[at.section].splice(at.index + off, 0, e);
  return next;
}

/**
 * A new folder of these servers, where the first of them was (just after its
 * folder, when it was in one). Returns the layout and the new folder's id.
 */
export function createFolder(layout: RailLayout, serverIds: string[], opts: { name?: string; color?: string | null } = {}, makeId: (l: RailLayout) => string = newFolderId): { layout: RailLayout; id: string | null } {
  const first = serverIds[0];
  const at = first ? findPlace(layout, first) : null;
  if (!at || serverIds.some((id) => !SERVER_ID.test(id))) return { layout, id: null };
  const next = clone(layout);
  const id = makeId(next);
  const folder: ServerFolder = { id, name: (opts.name ?? "").trim().slice(0, FOLDER_NAME_MAX), color: opts.color ?? null, servers: [] };
  next[at.section].splice(at.folder ? at.index + 1 : at.index, 0, folder);
  for (const sid of serverIds) if (!folder.servers.includes(sid) && take(next, sid) !== null) folder.servers.push(sid);
  return { layout: next, id };
}

/** Moves a server into a folder, at its end. */
export function addToFolder(layout: RailLayout, serverId: string, folderId: string): RailLayout {
  const from = findPlace(layout, serverId);
  const into = findPlace(layout, folderId);
  if (!from || !into || into.folder || !isFolder(layout[into.section][into.index]) || from.folder?.id === folderId) return layout;
  const next = clone(layout);
  if (take(next, serverId) === null) return layout;
  const at = findPlace(next, folderId);
  const f = at ? next[at.section][at.index] : undefined;
  if (!isFolder(f)) return layout;
  f.servers.push(serverId);
  return next;
}

/** Takes a server out of its folder, to just under the folder (or where the folder was, when it was the last one in it). */
export function removeFromFolder(layout: RailLayout, serverId: string): RailLayout {
  const at = findPlace(layout, serverId);
  if (!at?.folder) return layout;
  const folderId = at.folder.id;
  const next = clone(layout);
  take(next, serverId);
  const f = findPlace(next, folderId);
  if (f) next[f.section].splice(f.index + 1, 0, serverId);
  else next[at.section].splice(at.index, 0, serverId);
  return next;
}

/** Deletes a folder; its servers take its place, in their order. */
export function deleteFolder(layout: RailLayout, folderId: string): RailLayout {
  const at = findPlace(layout, folderId);
  if (!at || at.folder) return layout;
  const next = clone(layout);
  const list = next[at.section];
  const f = list[at.index];
  if (!isFolder(f)) return layout;
  list.splice(at.index, 1, ...f.servers);
  return next;
}

/** Changes a folder's name, colour or whether it is open. */
export function updateFolder(layout: RailLayout, folderId: string, change: Partial<Pick<ServerFolder, "name" | "color" | "open">>): RailLayout {
  const at = findPlace(layout, folderId);
  if (!at || at.folder) return layout;
  const next = clone(layout);
  const f = next[at.section][at.index];
  if (!isFolder(f)) return layout;
  if (change.name !== undefined) f.name = change.name.trim().slice(0, FOLDER_NAME_MAX);
  if (change.color !== undefined) f.color = change.color && COLOR.test(change.color) ? change.color.toLowerCase() : null;
  if (change.open !== undefined) {
    if (change.open) f.open = true;
    else delete f.open;
  }
  return next;
}
