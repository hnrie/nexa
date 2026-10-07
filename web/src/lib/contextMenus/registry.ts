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

interface Entry {
  kind: string;
  groups: MenuButton<never>[][];
}

const menus = new Map<string, Entry>();
const buttonKinds = new Map<string, string>();

const asList = (b: Built): ContextMenuItem[] => (!b ? [] : Array.isArray(b) ? b : [b]);

/**
 * Builds a menu's items. Exported for tests; menus use their own items().
 * Lines are set on the last item of a group when a later group shows
 * something; a line an item asks for itself is kept.
 */
export function buildItems<C>(groups: MenuButton<C>[][], ctx: C): ContextMenuItem[] {
  const built = groups.map((g) => g.flatMap((b) => asList(b.build(ctx))));
  const shown = built.filter((g) => g.length > 0);
  const out: ContextMenuItem[] = [];
  shown.forEach((g, i) => {
    const last = i < shown.length - 1 ? g.length - 1 : -1;
    g.forEach((item, j) => out.push(j === last && !item.separatorAfter ? { ...item, separatorAfter: true } : item));
  });
  return out;
}

/**
 * Registers a menu. Defining the same kind again replaces it (a module
 * reloaded during development); a button id another menu already has throws.
 */
export function defineMenu<C>(kind: string, groups: MenuButton<C>[][]): Menu<C> {
  const seen = new Set<string>();
  for (const b of groups.flat()) {
    const other = buttonKinds.get(b.id);
    if (seen.has(b.id) || (other !== undefined && other !== kind)) throw new Error(`context menu button id "${b.id}" is used twice`);
    seen.add(b.id);
  }
  if (menus.has(kind)) for (const [id, k] of buttonKinds) if (k === kind) buttonKinds.delete(id);
  for (const id of seen) buttonKinds.set(id, kind);
  menus.set(kind, { kind, groups: groups as MenuButton<never>[][] });
  const items = (ctx: C) => buildItems((menus.get(kind)?.groups ?? groups) as MenuButton<C>[][], ctx);
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
