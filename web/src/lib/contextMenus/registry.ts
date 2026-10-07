import type { DecryptedMessage } from "@/lib/decrypt";
import { useUI, type ContextMenuItem, type ContextMenuState } from "@/stores/ui";

/**
 * Every context menu the app opens is registered here, by kind, as a list of
 * buttons with stable ids. Components never build menus inline: they open a
 * registered menu with the context it needs (the message, the channel, the
 * callbacks only the component has), and the registry builds its items.
 *
 * A menu is groups of buttons. A line is drawn between two groups that both
 * have something to show, so a button that is left out never leaves a stray
 * line or a missing one behind. A button builds one item, several (a list of
 * devices, spellings), or nothing for a context it does not apply to.
 *
 * Button ids are unique across every menu, so a button can be named on its
 * own (the plugin API's context menus name buttons by id alone). The items a
 * button builds keep ids of their own, which only need to be unique within
 * one open menu.
 *
 * Plugins change menus through a layer of changes laid over the buttons
 * (below): buttons added, removed and edited, each recorded against the
 * plugin that made it, applied in the order they were made, and taken away
 * when it stops.
 */

export type Built = ContextMenuItem | ContextMenuItem[] | null | undefined | false;

export interface MenuButton<C> {
  /** Unique across every menu, camelCase: "deleteMessage". */
  id: string;
  /** The item or items this button shows for a context; nothing to leave it out. */
  build: (ctx: C) => Built;
}

/** Where a menu opens: everything about opening one except its items. */
export type MenuPlacement = Omit<ContextMenuState, "items">;

/**
 * What a menu is about, for whatever is laid over it (the plugin API's
 * `ContextMenuContext`): the message, the person, the channel and the server,
 * where the menu is about one.
 */
export interface MenuSubject {
  message?: DecryptedMessage | null;
  userId?: string | null;
  channelId?: string | null;
  serverId?: string | null;
}

export interface MenuOptions<C> {
  /** What the menu is about, from its context. Left out, it is about nothing in particular. */
  about?: (ctx: C) => MenuSubject;
}

export interface Menu<C> {
  kind: string;
  /** The items the menu shows for a context, with lines between its groups. */
  items: (ctx: C) => ContextMenuItem[];
  /** Opens the menu; returns false, opening nothing, when it has nothing to show. */
  open: (ctx: C, at: MenuPlacement) => boolean;
}

export interface RegisteredButton {
  id: string;
  kind: string;
  /** Which of the menu's groups it is in, counted from 0. */
  group: number;
}

/** What a menu's context can hold for a plugin; the server also comes with a channel that is in one. */
export type SubjectName = "message" | "user" | "channel" | "server";

interface Entry {
  kind: string;
  groups: MenuButton<never>[][];
  about?: (ctx: never) => MenuSubject;
  subjects?: SubjectName[];
}

const menus = new Map<string, Entry>();
const buttonKinds = new Map<string, string>();

const asList = (b: Built): ContextMenuItem[] => (!b ? [] : Array.isArray(b) ? b : [b]);

/** Lines on the last item of each group a later group follows; a line an item asks for itself is kept. */
function withLines(groups: ContextMenuItem[][]): ContextMenuItem[] {
  const shown = groups.filter((g) => g.length > 0);
  const out: ContextMenuItem[] = [];
  shown.forEach((g, i) => {
    const last = i < shown.length - 1 ? g.length - 1 : -1;
    g.forEach((item, j) => out.push(j === last && !item.separatorAfter ? { ...item, separatorAfter: true } : item));
  });
  return out;
}

/** Builds a menu's items with no changes laid over them. Exported for tests; menus use their own items(). */
export function buildItems<C>(groups: MenuButton<C>[][], ctx: C): ContextMenuItem[] {
  return withLines(groups.map((g) => g.flatMap((b) => asList(b.build(ctx)))));
}

/**
 * Registers a menu. Defining the same kind again replaces it (a module
 * reloaded during development); a button id another menu already has throws.
 */
export function defineMenu<C>(kind: string, groups: MenuButton<C>[][], opts: MenuOptions<C> = {}): Menu<C> {
  const seen = new Set<string>();
  for (const b of groups.flat()) {
    const other = buttonKinds.get(b.id);
    if (seen.has(b.id) || (other !== undefined && other !== kind)) throw new Error(`context menu button id "${b.id}" is used twice`);
    seen.add(b.id);
  }
  if (menus.has(kind)) for (const [id, k] of buttonKinds) if (k === kind) buttonKinds.delete(id);
  for (const id of seen) buttonKinds.set(id, kind);
  menus.set(kind, { kind, groups: groups as MenuButton<never>[][], ...(opts.about ? { about: opts.about as (ctx: never) => MenuSubject } : {}) });
  const items = (ctx: C) => {
    const entry = menus.get(kind);
    return layered(kind, (entry?.groups ?? groups) as MenuButton<C>[][], ctx, entry?.about ? (entry.about as (c: C) => MenuSubject)(ctx) : {});
  };
  return {
    kind,
    items,
    open(ctx, at) {
      const list = items(ctx);
      if (!list.length) return false;
      useUI.getState().openContextMenu({ ...at, items: list });
      return true;
    },
  };
}

/**
 * Says what a menu is about, from its context, after it is defined; and,
 * for the plugin docs' table of menus, which of message, user, channel and
 * server that gives.
 */
export function about<C>(menu: Menu<C>, subjects: SubjectName[], fn: (ctx: C) => MenuSubject): void {
  const entry = menus.get(menu.kind);
  if (!entry) return;
  entry.about = fn as (ctx: never) => MenuSubject;
  entry.subjects = subjects;
}

/** Which of message, user, channel and server a menu's context gives a plugin; none for a menu about nothing in particular. */
export function menuSubjects(kind: string): SubjectName[] {
  return menus.get(kind)?.subjects ?? [];
}

/** The menu kinds registered so far, in the order they were. */
export function menuKinds(): string[] {
  return [...menus.keys()];
}

/** A menu's buttons, in order. */
export function menuButtons(kind: string): RegisteredButton[] {
  const m = menus.get(kind);
  return m ? m.groups.flatMap((g, group) => g.map((b) => ({ id: b.id, kind, group }))) : [];
}

/** The menu a button belongs to, or null. */
export function kindOfButton(id: string): string | null {
  return buttonKinds.get(id) ?? null;
}

/** A button, written shortly: button("copyText", (ctx) => ({ ... })). */
export function button<C>(id: string, build: (ctx: C) => Built): MenuButton<C> {
  return { id, build };
}

// --- changes laid over the menus (plugins) ---------------------------------------

/** What a change's callbacks are told: what the menu is about, and which menu it is. */
export type Subject = MenuSubject & { menu: string };

export interface AddedButton {
  id: string;
  label: string;
  icon?: string | null;
  danger?: boolean;
  separatorAfter?: boolean;
  visible?: (s: Subject) => boolean;
  onClick: (s: Subject) => void;
  before?: string;
  after?: string;
}

export interface ButtonEdit {
  label?: string;
  icon?: string | null;
  danger?: boolean;
  separatorAfter?: boolean;
  visible?: (s: Subject) => boolean;
  onClick?: (s: Subject, original: () => void) => void;
}

type Change = { owner: string; seq: number } & ({ kind: "add"; menu: string; button: AddedButton } | { kind: "remove"; id: string } | { kind: "edit"; id: string; edit: ButtonEdit });

let changes: Change[] = [];
let seq = 0;

/** What a button looks like when it is not being built for a context: as it last showed, for get and list. */
const lastShown = new Map<string, { label: string; icon: string | null; danger: boolean; separatorAfter: boolean }>();

/** A plugin's callback that throws leaves the menu working: the button is left out, or its click does nothing. */
function safely<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    console.warn("a context menu change failed", err);
    return fallback;
  }
}

function addedIds(): Map<string, Extract<Change, { kind: "add" }>> {
  const out = new Map<string, Extract<Change, { kind: "add" }>>();
  for (const c of changes) if (c.kind === "add") out.set(c.button.id, c);
  return out;
}

/** Whether a button with this id is there now: a built-in one, or one added and not removed since. */
export function buttonExists(id: string): boolean {
  if (!buttonKinds.has(id) && !addedIds().has(id)) return false;
  return !changes.some((c) => c.kind === "remove" && c.id === id);
}

/** Adds a button to a menu; throws when the id is taken, built-in or not. */
export function addButton(owner: string, menu: string, b: AddedButton): void {
  if (!menus.has(menu)) throw new Error(`there is no menu called "${menu}"`);
  if (buttonKinds.has(b.id) || addedIds().has(b.id)) throw new Error(`a context menu button "${b.id}" is already there`);
  changes.push({ owner, seq: ++seq, kind: "add", menu, button: b });
}

/** Takes a button away, built-in or not; throws when there is none with the id. */
export function removeButton(owner: string, id: string): void {
  if (!buttonExists(id)) throw new Error(`there is no context menu button "${id}"`);
  changes.push({ owner, seq: ++seq, kind: "remove", id });
}

/** Changes a button, built-in or not; throws when there is none with the id. */
export function editButton(owner: string, id: string, edit: ButtonEdit): void {
  if (!buttonExists(id)) throw new Error(`there is no context menu button "${id}"`);
  changes.push({ owner, seq: ++seq, kind: "edit", id, edit });
}

/** Takes back one change: the button a plugin added, by the function `add` returned. */
export function dropAdded(owner: string, id: string): void {
  changes = changes.filter((c) => !(c.owner === owner && c.kind === "add" && c.button.id === id));
}

/** Takes back every change a plugin made, as it stops. */
export function dropChanges(owner: string): void {
  changes = changes.filter((c) => c.owner !== owner);
}

/** Whether anything is laid over a menu at all, so the plain build can be kept when nothing is. */
function touches(menu: string): boolean {
  if (!changes.length) return false;
  const added = addedIds();
  return changes.some((c) => (c.kind === "add" ? c.menu === menu : (buttonKinds.get(c.id) ?? added.get(c.id)?.menu) === menu));
}

/** One button's place in a built menu: its group, and the items it made. */
interface Slot {
  id: string;
  group: number;
  items: ContextMenuItem[];
  added: boolean;
}

function edited(items: ContextMenuItem[], e: ButtonEdit, subject: Subject): ContextMenuItem[] {
  if (e.visible && !safely(() => e.visible!(subject), false)) return [];
  return items.map((item) => {
    const next: ContextMenuItem = { ...item };
    if (e.label !== undefined && items.length === 1) next.label = e.label;
    if (e.icon !== undefined) {
      if (e.icon === null) delete next.icon;
      else next.icon = e.icon;
    }
    if (e.danger !== undefined) next.danger = e.danger;
    if (e.separatorAfter !== undefined) next.separatorAfter = e.separatorAfter;
    if (e.onClick && !item.submenu && !item.heading && !item.note) {
      const original = item.onSelect ?? (() => undefined);
      const onClick = e.onClick;
      next.onSelect = () => safely(() => onClick(subject, original), undefined);
    }
    return next;
  });
}

function addedItem(b: AddedButton, subject: Subject): ContextMenuItem[] {
  if (b.visible && !safely(() => b.visible!(subject), false)) return [];
  return [{ id: `plugin:${b.id}`, label: b.label, ...(b.icon ? { icon: b.icon } : {}), ...(b.danger ? { danger: true } : {}), ...(b.separatorAfter ? { separatorAfter: true } : {}), onSelect: () => safely(() => b.onClick(subject), undefined) }];
}

/** A menu's items for a context, with every change laid over its buttons in the order they were made. */
function layered<C>(kind: string, groups: MenuButton<C>[][], ctx: C, about: MenuSubject): ContextMenuItem[] {
  const plain = !touches(kind);
  const slots: Slot[] = groups.flatMap((g, group) => g.map((b) => ({ id: b.id, group, items: asList(b.build(ctx)), added: false })));
  for (const s of slots) if (s.items.length === 1) remember(s.id, s.items[0]!);
  if (plain) return withLines(groups.map((_, i) => slots.filter((s) => s.group === i).flatMap((s) => s.items)));
  const subject: Subject = { ...about, menu: kind };
  let list = slots;
  for (const c of changes) {
    if (c.kind === "remove") list = list.filter((s) => s.id !== c.id);
    else if (c.kind === "edit") list = list.map((s) => (s.id === c.id ? { ...s, items: edited(s.items, c.edit, subject) } : s));
    else if (c.menu === kind) {
      const b = c.button;
      const anchor = b.before ?? b.after;
      const at = anchor ? list.findIndex((s) => s.id === anchor) : -1;
      const group = at >= 0 ? list[at]!.group : groups.length - 1;
      const slot: Slot = { id: b.id, group, items: addedItem(b, subject), added: true };
      if (at < 0) list = [...list, slot];
      else list = [...list.slice(0, b.before ? at : at + 1), slot, ...list.slice(b.before ? at : at + 1)];
    }
  }
  const byGroup: ContextMenuItem[][] = groups.map(() => []);
  for (const s of list) byGroup[Math.max(0, Math.min(byGroup.length - 1, s.group))]!.push(...s.items);
  return withLines(byGroup);
}

function remember(id: string, item: ContextMenuItem): void {
  lastShown.set(id, { label: item.label, icon: item.icon ?? null, danger: !!item.danger, separatorAfter: !!item.separatorAfter });
}

/** A button as the plugin API's `get` and `list` report it. */
export interface ButtonInfo {
  id: string;
  menu: string;
  label: string;
  icon: string | null;
  danger: boolean;
  separatorAfter: boolean;
  builtIn: boolean;
}

function info(id: string, menu: string, builtIn: boolean): ButtonInfo {
  const added = builtIn ? undefined : addedIds().get(id)?.button;
  const base = added ? { label: added.label, icon: added.icon ?? null, danger: !!added.danger, separatorAfter: !!added.separatorAfter } : (lastShown.get(id) ?? { label: id, icon: null, danger: false, separatorAfter: false });
  const out = { ...base };
  for (const c of changes) {
    if (c.kind !== "edit" || c.id !== id) continue;
    if (c.edit.label !== undefined) out.label = c.edit.label;
    if (c.edit.icon !== undefined) out.icon = c.edit.icon;
    if (c.edit.danger !== undefined) out.danger = c.edit.danger;
    if (c.edit.separatorAfter !== undefined) out.separatorAfter = c.edit.separatorAfter;
  }
  return { id, menu, builtIn, ...out };
}

/** A button by its id, built-in or added, or null when there is none (or it was removed). */
export function buttonInfo(id: string): ButtonInfo | null {
  if (!buttonExists(id)) return null;
  const kind = buttonKinds.get(id);
  if (kind) return info(id, kind, true);
  const added = addedIds().get(id);
  return added ? info(id, added.menu, false) : null;
}

/** A menu's buttons in the order they are shown, built-in and added, without those removed. A label is as it last showed. */
export function listButtons(menu: string): ButtonInfo[] {
  const m = menus.get(menu);
  if (!m) throw new Error(`there is no menu called "${menu}"`);
  let ids: { id: string; builtIn: boolean }[] = m.groups.flat().map((b) => ({ id: b.id, builtIn: true }));
  for (const c of changes) {
    if (c.kind === "remove") ids = ids.filter((x) => x.id !== c.id);
    else if (c.kind === "add" && c.menu === menu) {
      const anchor = c.button.before ?? c.button.after;
      const at = anchor ? ids.findIndex((x) => x.id === anchor) : -1;
      const entry = { id: c.button.id, builtIn: false };
      if (at < 0) ids.push(entry);
      else ids.splice(c.button.before ? at : at + 1, 0, entry);
    }
  }
  return ids.map((x) => info(x.id, menu, x.builtIn));
}

/** Clears every change: for tests. */
export function resetChanges(): void {
  changes = [];
}
