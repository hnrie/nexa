import { createContext, useContext, useSyncExternalStore } from "react";

/**
 * Which row of a message list is being looked at: the one under a real
 * pointer, and the one holding focus. Only those rows draw their toolbar.
 *
 * Every row used to render its hover toolbar and hide it in CSS — a dozen
 * buttons with their tooltips, about two thirds of each row's elements — so a
 * long channel carried thousands of controls nobody could see, and a phone,
 * which can never show them, paid for every one.
 */
export class ActiveRows {
  private hovered: string | null = null;
  private focused: string | null = null;
  private readonly listeners = new Set<() => void>();

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  hover(id: string | null): void {
    if (this.hovered === id) return;
    this.hovered = id;
    this.emit();
  }

  focus(id: string | null): void {
    if (this.focused === id) return;
    this.focused = id;
    this.emit();
  }

  isActive(id: string): boolean {
    return this.hovered === id || this.focused === id;
  }
}

const Rows = createContext<ActiveRows | null>(null);

/** Hands a list's tracker down to its rows. */
export const ActiveRowsProvider = Rows.Provider;

/**
 * Whether a row is the one being looked at. A row outside a list that tracks
 * this (a test, a preview) is always active, which is how every row behaved
 * before.
 */
export function useRowActive(id: string): boolean {
  const rows = useContext(Rows);
  return useSyncExternalStore(
    rows ? rows.subscribe : noSubscribe,
    () => (rows ? rows.isActive(id) : true),
    () => true,
  );
}

const noSubscribe = (): (() => void) => () => undefined;

/** The row an event happened in, by the id every row carries. */
export function rowIdOf(target: EventTarget | null): string | null {
  const el = target instanceof Element ? target.closest<HTMLElement>("[data-row]") : null;
  return el?.dataset.id ?? null;
}
