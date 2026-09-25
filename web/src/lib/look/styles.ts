import { storage } from "@/lib/storage";
import { cssOff } from "./safeMode";

/**
 * The person's own CSS in the page, and the CSS plugins add.
 *
 * Each sheet is a style element in one container at the end of the body. The
 * app's own stylesheets are all in the head, including those a page loaded
 * later adds there, so everything here comes after them and wins wherever a
 * rule is as specific as the app's: a person's CSS never has to fight the
 * order the app's chunks happened to load in. Plugins' CSS goes first, links
 * next and the person's own snippet last, so their own word is the final one.
 */

export interface Sheet {
  id: string;
  css: string;
}

export type SheetGroup = "plugins" | "links" | "snippet";
const ORDER: SheetGroup[] = ["plugins", "links", "snippet"];
const HOST = "nexa-custom-css";

function host(): HTMLElement {
  let el = document.getElementById(HOST);
  if (!el) {
    el = document.createElement("div");
    el.id = HOST;
    el.hidden = true;
    for (const g of ORDER) {
      const part = document.createElement("div");
      part.dataset["group"] = g;
      el.append(part);
    }
    document.body.append(el);
  }
  return el;
}

/** Puts exactly these sheets into a group, in order, rewriting only the ones that changed. */
export function setSheets(group: SheetGroup, sheets: Sheet[]): void {
  if (typeof document === "undefined" || !document.body) return;
  const part = host().querySelector<HTMLElement>(`[data-group="${group}"]`)!;
  const have = new Map([...part.querySelectorAll<HTMLStyleElement>("style")].map((el) => [el.dataset["sheet"] ?? "", el]));
  const keep = new Set<HTMLStyleElement>();
  let prev: HTMLStyleElement | null = null;
  for (const sheet of sheets) {
    let el = have.get(sheet.id);
    if (!el) {
      el = document.createElement("style");
      el.dataset["sheet"] = sheet.id;
    }
    if (el.textContent !== sheet.css) el.textContent = sheet.css;
    // in the order asked for; moving one costs a restyle, so only when it is out of place
    const want: ChildNode | null = prev ? prev.nextSibling : part.firstChild;
    if (want !== el) part.insertBefore(el, want);
    keep.add(el);
    prev = el;
  }
  for (const el of have.values()) if (!keep.has(el)) el.remove();
}

export function clearSheets(): void {
  for (const g of ORDER) setSheets(g, []);
}

/*
 * The sheets this device last drew with, for the first frame. The account's
 * settings arrive seconds after the page is drawn and the link texts come
 * from IndexedDB, which cannot be read before the first render; without this
 * every reload would show the app unstyled and then jump. Kept only while
 * someone is signed in: signing out forgets it.
 */
const REMEMBERED = "ec:look:css";
/** What localStorage is asked to hold, in characters; a theme past this starts plain and styles itself a moment later. */
const REMEMBER_MAX = 1_500_000;

export function rememberSheets(sheets: { links: Sheet[]; snippet: Sheet[] }): void {
  const total = [...sheets.links, ...sheets.snippet].reduce((n, s) => n + s.css.length, 0);
  if (total === 0 || total > REMEMBER_MAX) {
    storage.remove(REMEMBERED);
    return;
  }
  storage.set(REMEMBERED, JSON.stringify({ v: 1, ...sheets }));
}

export function forgetSheets(): void {
  storage.remove(REMEMBERED);
}

function asSheets(v: unknown): Sheet[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is Sheet => !!s && typeof s === "object" && typeof (s as Sheet).id === "string" && typeof (s as Sheet).css === "string");
}

/** Draws the remembered sheets before the first render; nothing in safe mode. */
export function applyRememberedSheets(): void {
  if (cssOff()) return;
  const raw = storage.get(REMEMBERED);
  if (!raw) return;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (v["v"] !== 1) return;
    setSheets("links", asSheets(v["links"]));
    setSheets("snippet", asSheets(v["snippet"]));
  } catch {
    /* unreadable: the settings will draw it shortly */
  }
}
