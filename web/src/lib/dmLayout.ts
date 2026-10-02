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
   * Rows of the main list moved by hand. The main list always goes by
   * activity; a row moved somewhere stands there, as though its last activity
   * were `at`, until something newer than `since` happens in it, and then it
   * goes by its own activity again. Nothing is held in place for good: a new
   * message still brings a conversation to the top.
   */
  moved?: Record<string, MovedRow>;
}

/** Where a row moved by hand stands: at `at`, until its activity passes `since`. */
export interface MovedRow {
  at: string;
  since: string;
}

/** How many moved rows are remembered; the oldest moves are let go first. */
const MOVED_MAX = 200;

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
  /** The rest's rows, by id: the activity each is sorted by (a moved one's place). */
  keys: Record<string, string>;
  /** Every row's own last activity, by id: the rest's, and the pinned and grouped ones'. */
  now: Record<string, string>;
}

/** Where a dragged conversation or group lands. */
export type DMDrop =
  | { kind: "pinned"; index: number }
  | { kind: "group"; groupId: string }
  /**
   * The main list. With `at`, beside that row of it, where it stays until
   * something new happens in it; `rest` is the main list as it is shown, and
   * `keys` and `now` its rows' places and activity (DMListView's).
   */
  | { kind: "main"; at?: string; where?: "before" | "after"; rest?: string[]; keys?: Record<string, string>; now?: Record<string, string> };

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
  // An order kept by hand for good ("sort": "custom", from before) is let go:
  // the list goes by activity, and moves hold only until something new happens.
  const rawMoved = (x as { moved?: unknown }).moved;
  if (rawMoved && typeof rawMoved === "object") {
    const moved: Record<string, MovedRow> = {};
    for (const [id, m] of Object.entries(rawMoved as Record<string, unknown>)) {
      if (!(CONVERSATION_ID.test(id) || groupIds.has(id)) || !m || typeof m !== "object") continue;
      const { at, since } = m as { at?: unknown; since?: unknown };
      if (typeof at === "string" && typeof since === "string" && KEY.test(at) && KEY.test(since)) moved[id] = { at, since };
    }
    if (Object.keys(moved).length) out.moved = moved;
  }
  return out;
}

/** An activity, as a snowflake's digits. */
const KEY = /^\d{1,20}$/;

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
  const rest: { row: DMRow; at: string; now: string }[] = [];
  // a row moved by hand stands where it was put until something new happens in it
  const placeOf = (id: string, now: string): string => {
    const m = layout.moved?.[id];
    return m && compare(now, m.since) <= 0 ? m.at : now;
  };
  for (const g of layout.groups) {
    if (pinnedIds.has(g.id)) continue;
    const row = groupRows.get(g.id)!;
    const ids = row.kind === "group" ? row.ids : [];
    const now = ids.length ? activity(ids[0]!) : "0";
    rest.push({ row, at: placeOf(g.id, now), now });
  }
  for (const id of conversations) {
    if (placed.has(id) || !known(id)) continue;
    placed.add(id);
    const now = activity(id);
    rest.push({ row: { kind: "conversation", id }, at: placeOf(id, now), now });
  }
  rest.sort((a, b) => compare(b.at, a.at));
  const keys: Record<string, string> = {};
  // every row's own activity, the pinned and grouped ones too, for whichever is moved into the main list
  const now: Record<string, string> = {};
  for (const id of placed) now[id] = activity(id);
  for (const [gid, row] of groupRows) now[gid] = row.kind === "group" && row.ids.length ? activity(row.ids[0]!) : "0";
  for (const r of rest) {
    keys[rowId(r.row)] = r.at;
    now[rowId(r.row)] = r.now;
  }
  return { pinned, rest: rest.map((r) => r.row), keys, now };
}

/** A row's id: a conversation's channel (or NEXA_ID), or a group's own. */
export function rowId(row: DMRow): string {
  return row.kind === "group" ? row.group.id : row.id;
}

/** A copy to change. */
function clone(layout: DMListLayout): DMListLayout {
  const out: DMListLayout = { pins: [...layout.pins], groups: layout.groups.map((g) => ({ ...g, ids: [...g.ids] })) };
  if (layout.moved) out.moved = { ...layout.moved };
  return out;
}

/** Activities as numbers, to find one between two others. */
const big = (k: string | undefined): bigint => (k && KEY.test(k) ? BigInt(k) : 0n);

/**
 * Moves a conversation or group in the main list to beside another row of it.
 * `rest` is the main list as it is shown, and `keys` and `now` its rows'
 * places and activity (DMListView's). The row stands between its new
 * neighbours until something new happens in it; then it goes by its activity
 * again. A pinned one comes out of the pins to go there, and a conversation
 * out of its group.
 */
export function moveInMain(layout: DMListLayout, id: string, at: string, where: "before" | "after", rest: string[], keys: Record<string, string> = {}, now: Record<string, string> = {}): DMListLayout {
  if (id === at) return layout;
  const next = clone(layout);
  next.pins = next.pins.filter((x) => x !== id);
  if (!isGroupId(id)) for (const g of next.groups) g.ids = g.ids.filter((x) => x !== id);
  const order = rest.filter((x) => x !== id);
  const target = order.indexOf(at);
  const i = target < 0 ? 0 : where === "after" ? target + 1 : target;
  const above = order[i - 1];
  const below = order[i];
  let place: bigint;
  if (above !== undefined && below !== undefined) place = (big(keys[above]) + big(keys[below])) / 2n;
  else if (below !== undefined) place = big(keys[below]) + 1n;
  else if (above !== undefined) place = big(keys[above]) > 0n ? big(keys[above]) - 1n : 0n;
  else return next;
  const moved: Record<string, MovedRow> = {};
  // moves that something new has since overtaken are let go, and only so many are kept
  for (const [k, m] of Object.entries(next.moved ?? {})) {
    if (k === id) continue;
    if (k in now && big(now[k]) > big(m.since)) continue;
    moved[k] = m;
  }
  moved[id] = { at: place.toString(), since: now[id] ?? keys[id] ?? "0" };
  const kept = Object.entries(moved).slice(-MOVED_MAX);
  next.moved = Object.fromEntries(kept);
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

/** The layout without a moved row's place. */
function unmove(layout: DMListLayout, id: string): void {
  if (!layout.moved || !(id in layout.moved)) return;
  const { [id]: _gone, ...rest } = layout.moved;
  if (Object.keys(rest).length) layout.moved = rest;
  else delete layout.moved;
}

/** Deletes a group; its conversations go back to the main list. */
export function deleteGroup(layout: DMListLayout, groupId: string): DMListLayout {
  if (!layout.groups.some((g) => g.id === groupId)) return layout;
  const next = clone(layout);
  next.groups = next.groups.filter((g) => g.id !== groupId);
  next.pins = next.pins.filter((x) => x !== groupId);
  unmove(next, groupId);
  return next;
}

/** Forgets a conversation that was closed or left: it is no longer pinned or in a group, or moved anywhere. */
export function forgetDM(layout: DMListLayout, id: string): DMListLayout {
  if (!layout.pins.includes(id) && !groupOf(layout, id) && !layout.moved?.[id]) return layout;
  const next = clone(layout);
  unplace(next, id);
  unmove(next, id);
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
  const movedGone = Object.keys(layout.moved ?? {}).filter(gone);
  if (!layout.pins.some(gone) && !layout.groups.some((g) => g.ids.some(gone)) && movedGone.length === 0) return layout;
  const next = clone(layout);
  next.pins = next.pins.filter((id) => !gone(id));
  for (const g of next.groups) g.ids = g.ids.filter((id) => !gone(id));
  for (const id of movedGone) unmove(next, id);
  return next;
}

/** Where a dragged conversation or group lands: pinned at a place, in a group, or back in the main list. */
export function dropDM(layout: DMListLayout, id: string, drop: DMDrop): DMListLayout {
  if (drop.kind === "pinned") return pinDM(layout, id, drop.index);
  if (drop.kind === "group") return isGroupId(id) ? layout : addToGroup(layout, id, drop.groupId);
  // beside a row of the main list: there, until something new happens in it
  if (drop.at) return moveInMain(layout, id, drop.at, drop.where ?? "before", drop.rest ?? [], drop.keys ?? {}, drop.now ?? {});
  // the main list: out of the pins, and a conversation out of its group
  const next = unpinDM(layout, id);
  return isGroupId(id) ? next : removeFromGroup(next, id);
}
