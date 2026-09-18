import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ContextMenuItem } from "@/stores/ui";
import { t } from "@/i18n";

/**
 * Reordering without a mouse.
 *
 * Roles, stickers and the server rail are all HTML5 `draggable` and nothing
 * else. A touch screen never fires a drag event, and a keyboard has no way in
 * at all — so role hierarchy, which decides who can moderate whom, simply
 * could not be changed on a phone.
 *
 * This is the other two paths. Alt and an arrow key moves the focused row one
 * place, because plain arrows already belong to the list itself; the same move
 * is offered as Move up / Move down in the row's context menu, which is what a
 * long press opens on touch. Either way a live region says where the thing
 * landed, since the only other signal is a row sliding past.
 */
export interface Reorder {
  /** Put on each row. Alt+Arrow moves the row it is on. */
  onKeyDown: (id: string) => (e: KeyboardEvent) => void;
  /** Move up / Move down, for the row's context menu — the touch path. */
  menuItems: (id: string) => ContextMenuItem[];
  /** Render once inside the list: what was moved, and where to. */
  live: ReactNode;
  /** One line saying the list can be reordered and how. */
  hint: string;
}

interface Options {
  /** Every id in the order they are drawn. */
  ids: string[];
  /** Moves `id` by `delta` places. Return false when the move is not allowed. */
  move: (id: string, delta: number) => Promise<boolean> | boolean;
  /** What to call the thing being moved, for the announcement. */
  name: (id: string) => string;
  /** A grid also moves left and right; a column only up and down. */
  axis?: "vertical" | "grid";
  /** Whether this row can be moved at all. */
  canMove?: (id: string) => boolean;
}

export function useReorder({ ids, move, name, axis = "vertical", canMove }: Options): Reorder {
  const [said, setSaid] = useState("");
  // The rows are re-rendered after a move and React puts the node somewhere
  // else in the parent, which in some browsers drops focus. Finding it again by
  // id keeps the keyboard where it was, so the next Alt+Arrow carries on.
  const refocus = useRef<string | null>(null);

  const step = useCallback(
    async (id: string, delta: number) => {
      if (canMove && !canMove(id)) return;
      const at = ids.indexOf(id);
      const to = at + delta;
      if (at < 0 || to < 0 || to >= ids.length) return;
      const ok = await move(id, delta);
      if (!ok) return;
      setSaid(t("reorder.nameIsNowIndexOfCount", { name: name(id), index: to + 1, count: ids.length }));
      refocus.current = id;
      requestAnimationFrame(() => {
        const want = refocus.current;
        refocus.current = null;
        if (!want) return;
        // Matched by value rather than built into a selector: an id is opaque
        // here, and `CSS.escape` is not everywhere (jsdom has no `CSS` at all).
        const row = [...document.querySelectorAll<HTMLElement>("[data-reorder-id]")].find((el) => el.dataset["reorderId"] === want);
        if (!row) return;
        // The row itself is sometimes a plain container — a rail item, a
        // sticker cell — with the real control inside it.
        const target = row.tabIndex >= 0 || /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(row.tagName) ? row : row.querySelector<HTMLElement>("button, a[href], input, [tabindex]");
        target?.focus();
      });
    },
    [ids, move, name, canMove],
  );

  const onKeyDown = useCallback(
    (id: string) => (e: KeyboardEvent) => {
      // Alt, because the bare arrows belong to whatever list this is: holding a
      // modifier is how every file manager and every editor says "take the
      // thing with you".
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const back = e.key === "ArrowUp" || (axis === "grid" && e.key === "ArrowLeft");
      const forward = e.key === "ArrowDown" || (axis === "grid" && e.key === "ArrowRight");
      if (!back && !forward) return;
      e.preventDefault();
      e.stopPropagation();
      void step(id, back ? -1 : 1);
    },
    [axis, step],
  );

  const menuItems = useCallback(
    (id: string): ContextMenuItem[] => {
      if (canMove && !canMove(id)) return [];
      const at = ids.indexOf(id);
      const items: ContextMenuItem[] = [];
      if (at > 0) items.push({ id: "move-up", label: axis === "grid" ? t("reorder.moveEarlier") : t("reorder.moveUp"), onSelect: () => void step(id, -1) });
      if (at >= 0 && at < ids.length - 1) items.push({ id: "move-down", label: axis === "grid" ? t("reorder.moveLater") : t("reorder.moveDown"), onSelect: () => void step(id, 1) });
      if (items.length) items[items.length - 1]!.separatorAfter = true;
      return items;
    },
    [ids, axis, step, canMove],
  );

  return {
    onKeyDown,
    menuItems,
    live: (
      <span className="visually-hidden" role="status" aria-live="polite">
        {said}
      </span>
    ),
    hint: axis === "grid" ? t("reorder.dragToReorderOrHoldAltGrid") : t("reorder.dragToReorderOrHoldAlt"),
  };
}
