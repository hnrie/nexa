/**
 * How the person arranged their direct messages: conversations pinned to the
 * top, and groups (named sections they made) that can be pinned as well.
 *
 * It is kept in the synced settings. A conversation is in one place at most:
 * pinned, in a group, or neither, in the main list. What is stored can still
 * name conversations that were closed or deleted since; `dmListView` leaves
 * those out, and every change here can drop them for good (`pruneDMs`).
 */

/** A group of conversations in the DM list. */
export interface DMGroup {
  /** "g" and a few letters or digits: never a channel's id, which is all digits. */
  id: string;
  name: string;
  /** Its conversations: channel ids, and NEXA_ID for the Nexa conversation. */
  ids: string[];
  /** Showing only its name, with a count of what is waiting in it. */
  collapsed?: boolean;
}

export interface DMListLayout {
  /** The pinned conversations and groups, top first. */
  pins: string[];
  groups: DMGroup[];
  /**
   * "custom" once the main list has been put in an order by hand (dragged
   * about, or Sort Manually chosen): it keeps `order`, with anything not in
   * it yet (a conversation that just started) at the top, newest first.
   * Without it the main list goes by activity.
   */
  sort?: "custom";
  /** The main list's order, top first, while it is sorted by hand: conversations and groups. */
  order?: string[];
}

/** The Nexa conversation's id in the layout: it has no channel. */
export const NEXA_ID = "nexa";

/** How long a group's name may be. */
export const GROUP_NAME_MAX = 40;

/** One row of the DM list: a conversation, or a group with the conversations shown in it. */
export type DMRow = { kind: "conversation"; id: string } | { kind: "group"; group: DMGroup; ids: string[] };

export interface DMListView {
  /** The pinned conversations and groups, in the order they were pinned. */
  pinned: DMRow[];
  /** The rest, the most recently active first: conversations and the groups not pinned. */
  rest: DMRow[];
}

/** Where a dragged conversation or group lands. */
export type DMDrop =
  | { kind: "pinned"; index: number }
  | { kind: "group"; groupId: string }
  /**
   * The main list. With `at`, beside that row of it, which puts the list in
   * an order of its own; `rest` is the main list as it is shown, to start
   * that order from.
   */
  | { kind: "main"; at?: string; where?: "before" | "after"; rest?: string[] };

const CONVERSATION_ID = /^(\d{1,20}|nexa)$/;
const GROUP_ID = /^g[a-z0-9]{1,16}$/;

export const EMPTY_DM_LIST: DMListLayout = { pins: [], groups: [] };

export function isGroupId(id: string): boolean {
  return GROUP_ID.test(id);
}

/**
 * A stored layout, read defensively: anything malformed is left out, and each
 * conversation is kept once, pinned before grouped.
 */
export function sanitizeDMList(x: unknown): DMListLayout {
  if (!x || typeof x !== "object") return { pins: [], groups: [] };
  const raw = x as { pins?: unknown; groups?: unknown };
  const groups: DMGroup[] = [];
  const groupIds = new Set<string>();
  const seen = new Set<string>();
  const rawPins = Array.isArray(raw.pins) ? raw.pins.filter((id): id is string => typeof id === "string") : [];
  for (const id of rawPins) if (CONVERSATION_ID.test(id)) seen.add(id);
  for (const g of Array.isArray(raw.groups) ? raw.groups : []) {
    if (!g || typeof g !== "object") continue;
    const r = g as Partial<Record<keyof DMGroup, unknown>>;
    if (typeof r.id !== "string" || !GROUP_ID.test(r.id) || groupIds.has(r.id)) continue;
    groupIds.add(r.id);
    const ids: string[] = [];
    for (const id of Array.isArray(r.ids) ? r.ids : []) {
      if (typeof id !== "string" || !CONVERSATION_ID.test(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    const group: DMGroup = { id: r.id, name: typeof r.name === "string" ? r.name.slice(0, GROUP_NAME_MAX) : "", ids };
    if (r.collapsed === true) group.collapsed = true;
    groups.push(group);
  }
  const pins: string[] = [];
  for (const id of rawPins) if ((CONVERSATION_ID.test(id) || groupIds.has(id)) && !pins.includes(id)) pins.push(id);
  const out: DMListLayout = { pins, groups };
  if ((x as { sort?: unknown }).sort === "custom") {
    const rawOrder = (x as { order?: unknown }).order;
    const order: string[] = [];
    for (const id of Array.isArray(rawOrder) ? rawOrder : []) if (typeof id === "string" && (CONVERSATION_ID.test(id) || groupIds.has(id)) && !order.includes(id)) order.push(id);
    out.sort = "custom";
    out.order = order;
  }
  return out;
}

/** The group a conversation is in, or null. */
export function groupOf(layout: DMListLayout, id: string): DMGroup | null {
  return layout.groups.find((g) => g.ids.includes(id)) ?? null;
}

export function isPinnedDM(layout: DMListLayout, id: string): boolean {
  return layout.pins.includes(id);
}

/**
 * What the list shows. `known` says whether a conversation is there to show;
 * `activity` gives its most recent activity as a snowflake, compared by
 * `compare`. A group's activity is its most recent conversation's, and a group
 * with nothing in it goes to the end of the list, where it can still be seen
 * and deleted.
 */
export function dmListView(layout: DMListLayout, conversations: string[], known: (id: string) => boolean, activity: (id: string) => string, compare: (a: string, b: string) => number): DMListView {
  const placed = new Set<string>();
  const newest = (a: string, b: string) => compare(activity(b), activity(a));
  const groups = new Map(layout.groups.map((g) => [g.id, g]));
  const pinnedIds = new Set(layout.pins);
  const pinned: DMRow[] = [];
  for (const id of layout.pins) {
    if (isGroupId(id)) continue;
    if (known(id)) placed.add(id);
  }
  const groupRow = (g: DMGroup): DMRow => {
    const ids = g.ids.filter((id) => known(id) && !placed.has(id) && !pinnedIds.has(id)).sort(newest);
    for (const id of ids) placed.add(id);
    return { kind: "group", group: g, ids };
  };
  // groups are filled before the loose conversations, so a conversation that is somehow in two is shown once
  const groupRows = new Map<string, DMRow>();
  for (const g of layout.groups) groupRows.set(g.id, groupRow(g));
  for (const id of layout.pins) {
    if (isGroupId(id)) {
      const row = groups.has(id) ? groupRows.get(id) : undefined;
      if (row) pinned.push(row);
    } else if (known(id)) pinned.push({ kind: "conversation", id });
  }
  const rest: { row: DMRow; at: string }[] = [];
  for (const g of layout.groups) {
    if (pinnedIds.has(g.id)) continue;
    const row = groupRows.get(g.id)!;
    const ids = row.kind === "group" ? row.ids : [];
    rest.push({ row, at: ids.length ? activity(ids[0]!) : "0" });
  }
  for (const id of conversations) {
    if (placed.has(id) || !known(id)) continue;
    placed.add(id);
    rest.push({ row: { kind: "conversation", id }, at: activity(id) });
  }
  rest.sort((a, b) => compare(b.at, a.at));
  if (layout.sort === "custom") {
    // put in order by hand: that order, after whatever is new since, which comes first by activity
    const place = new Map((layout.order ?? []).map((id, i) => [id, i]));
    const key = (r: DMRow) => place.get(r.kind === "group" ? r.group.id : r.id) ?? -1;
    const fresh = rest.filter((r) => key(r.row) < 0);
    const kept = rest.filter((r) => key(r.row) >= 0).sort((a, b) => key(a.row) - key(b.row));
    return { pinned, rest: [...fresh, ...kept].map((r) => r.row) };
  }
  return { pinned, rest: rest.map((r) => r.row) };
}

/** A row's id: a conversation's channel (or NEXA_ID), or a group's own. */
export function rowId(row: DMRow): string {
  return row.kind === "group" ? row.group.id : row.id;
}

/** A copy to change. */
function clone(layout: DMListLayout): DMListLayout {
  const out: DMListLayout = { pins: [...layout.pins], groups: layout.groups.map((g) => ({ ...g, ids: [...g.ids] })) };
  if (layout.sort === "custom") {
    out.sort = "custom";
    out.order = [...(layout.order ?? [])];
  }
  return out;
}

/**
 * Moves a conversation or group in the main list to beside another row of it,
 * putting the list in an order of its own if it was not already (starting
 * from `rest`, the main list as it was shown). A pinned one comes out of the
 * pins to go there, and a conversation out of its group.
 */
export function moveInMain(layout: DMListLayout, id: string, at: string, where: "before" | "after", rest: string[]): DMListLayout {
  if (id === at) return layout;
  const next = clone(layout);
  next.pins = next.pins.filter((x) => x !== id);
  if (!isGroupId(id)) for (const g of next.groups) g.ids = g.ids.filter((x) => x !== id);
  // what is shown is the truth: anything new since is placed where it showed
  const base = next.sort === "custom" ? [...rest, ...(next.order ?? []).filter((x) => !rest.includes(x))] : [...rest];
  const order = base.filter((x) => x !== id);
  const target = order.indexOf(at);
  order.splice(target < 0 ? 0 : where === "after" ? target + 1 : target, 0, id);
  next.sort = "custom";
  next.order = order;
  return next;
}

/** Sorts the main list by activity again, or by hand from the order it shows now (`rest`). */
export function setDMSort(layout: DMListLayout, sort: "recent" | "custom", rest: string[]): DMListLayout {
  if ((layout.sort === "custom") === (sort === "custom")) return layout;
  const next = clone(layout);
  if (sort === "custom") {
    next.sort = "custom";
    next.order = [...rest];
  } else {
    delete next.sort;
    delete next.order;
  }
  return next;
}

/** Takes a conversation out of the pins and every group. */
function unplace(layout: DMListLayout, id: string): void {
  layout.pins = layout.pins.filter((x) => x !== id);
  for (const g of layout.groups) g.ids = g.ids.filter((x) => x !== id);
}

/** A group id nothing in the layout has. */
export function newGroupId(layout: DMListLayout, random: () => number = Math.random): string {
  const used = new Set(layout.groups.map((g) => g.id));
  for (;;) {
    const id = `g${Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0")}`;
    if (!used.has(id)) return id;
  }
}

/**
 * Pins a conversation or a group, at the bottom of the pinned ones or at
 * `index` among them. A conversation leaves its group to be pinned.
 */
export function pinDM(layout: DMListLayout, id: string, index?: number): DMListLayout {
  if (isGroupId(id) && !layout.groups.some((g) => g.id === id)) return layout;
  const next = clone(layout);
  const was = next.pins.indexOf(id);
  if (isGroupId(id)) next.pins = next.pins.filter((x) => x !== id);
  else unplace(next, id);
  // `index` counts the pins as they were; moving one down, the place it left moves everything after it up by one
  const at = index === undefined ? next.pins.length : Math.max(0, Math.min(was >= 0 && was < index ? index - 1 : index, next.pins.length));
  next.pins.splice(at, 0, id);
  return next;
}

/** Unpins a conversation or group: back to the main list. */
export function unpinDM(layout: DMListLayout, id: string): DMListLayout {
  if (!layout.pins.includes(id)) return layout;
  const next = clone(layout);
  next.pins = next.pins.filter((x) => x !== id);
  return next;
}

/** Moves a pinned conversation or group `delta` places among the pinned ones. */
export function movePinnedDM(layout: DMListLayout, id: string, delta: number): DMListLayout {
  const at = layout.pins.indexOf(id);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= layout.pins.length) return layout;
  const next = clone(layout);
  next.pins.splice(at, 1);
  next.pins.splice(to, 0, id);
  return next;
}

/** Puts a conversation in a group (out of the pins and any other group). */
export function addToGroup(layout: DMListLayout, id: string, groupId: string): DMListLayout {
  const g = layout.groups.find((x) => x.id === groupId);
  if (!g || g.ids.includes(id) || isGroupId(id)) return layout;
  const next = clone(layout);
  unplace(next, id);
  next.groups.find((x) => x.id === groupId)!.ids.push(id);
  return next;
}

/** Takes a conversation out of its group, back to the main list. */
export function removeFromGroup(layout: DMListLayout, id: string): DMListLayout {
  if (!groupOf(layout, id)) return layout;
  const next = clone(layout);
  for (const g of next.groups) g.ids = g.ids.filter((x) => x !== id);
  return next;
}

/** A new group, with these conversations moved into it. Returns the layout and the group's id. */
export function createGroup(layout: DMListLayout, name: string, ids: string[] = [], makeId: (l: DMListLayout) => string = newGroupId): { layout: DMListLayout; id: string } {
  const next = clone(layout);
  const id = makeId(next);
  for (const c of ids) unplace(next, c);
  next.groups.push({ id, name: name.trim().slice(0, GROUP_NAME_MAX), ids: ids.filter((c, i) => !isGroupId(c) && ids.indexOf(c) === i) });
  return { layout: next, id };
}

export function renameGroup(layout: DMListLayout, groupId: string, name: string): DMListLayout {
  const next = clone(layout);
  const g = next.groups.find((x) => x.id === groupId);
  if (!g) return layout;
  g.name = name.trim().slice(0, GROUP_NAME_MAX);
  return next;
}

export function setGroupCollapsed(layout: DMListLayout, groupId: string, collapsed: boolean): DMListLayout {
  const next = clone(layout);
  const g = next.groups.find((x) => x.id === groupId);
  if (!g) return layout;
  if (collapsed) g.collapsed = true;
  else delete g.collapsed;
  return next;
}

/** Deletes a group; its conversations go back to the main list. */
export function deleteGroup(layout: DMListLayout, groupId: string): DMListLayout {
  if (!layout.groups.some((g) => g.id === groupId)) return layout;
  const next = clone(layout);
  next.groups = next.groups.filter((g) => g.id !== groupId);
  next.pins = next.pins.filter((x) => x !== groupId);
  if (next.order) next.order = next.order.filter((x) => x !== groupId);
  return next;
}

/** Forgets a conversation that was closed or left: it is no longer pinned or in a group, or anywhere in the order. */
export function forgetDM(layout: DMListLayout, id: string): DMListLayout {
  if (!layout.pins.includes(id) && !groupOf(layout, id) && !layout.order?.includes(id)) return layout;
  const next = clone(layout);
  unplace(next, id);
  if (next.order) next.order = next.order.filter((x) => x !== id);
  return next;
}

/**
 * Drops the conversations that are gone, keeping the groups themselves. Only
 * for when every conversation of the account is loaded; before then, missing
 * is not gone.
 */
export function pruneDMs(layout: DMListLayout, known: (id: string) => boolean): DMListLayout {
  const groupIds = new Set(layout.groups.map((g) => g.id));
  const gone = (id: string) => (isGroupId(id) ? !groupIds.has(id) : !known(id));
  if (!layout.pins.some(gone) && !layout.groups.some((g) => g.ids.some(gone)) && !layout.order?.some(gone)) return layout;
  const next = clone(layout);
  next.pins = next.pins.filter((id) => !gone(id));
  for (const g of next.groups) g.ids = g.ids.filter((id) => !gone(id));
  if (next.order) next.order = next.order.filter((id) => !gone(id));
  return next;
}

/** Where a dragged conversation or group lands: pinned at a place, in a group, or back in the main list. */
export function dropDM(layout: DMListLayout, id: string, drop: DMDrop): DMListLayout {
  if (drop.kind === "pinned") return pinDM(layout, id, drop.index);
  if (drop.kind === "group") return isGroupId(id) ? layout : addToGroup(layout, id, drop.groupId);
  // beside a row of the main list: there, and the list keeps that order
  if (drop.at) return moveInMain(layout, id, drop.at, drop.where ?? "before", drop.rest ?? []);
  // the main list: out of the pins, and a conversation out of its group
  const next = unpinDM(layout, id);
  return isGroupId(id) ? next : removeFromGroup(next, id);
}
