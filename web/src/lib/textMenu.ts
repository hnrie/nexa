/**
 * The right-click menu of a text box on a computer, in place of the
 * browser's, which a page can neither add to nor read: spellings for the word
 * clicked from Nexa's own checker (lib/spell), Undo and Redo, Cut, Copy, Paste
 * and Select All, the formatting a box that takes markdown understands, and
 * what a box adds of its own, such as the message box's Send button.
 *
 * Words picked out on the page and links where nothing else has a menu get a
 * small one of the app's own too (pageItems), so a right click shows the same
 * menu in a browser and in the desktop app.
 *
 * Shift with the right click still opens the browser's menu. A touch screen
 * keeps the system's, with its selection handles; so do password boxes, for
 * the password manager in it.
 */
import { useEffect, useRef, type RefObject } from "react";
import { applyWrap, type WrapMarker } from "@/components/composer/wrapShortcut";
import { t } from "@/i18n";
import { copyText } from "@/lib/copyText";
import { desktopBridge, pasteNeedsUpdate } from "@/lib/desktopBridge";
import { learn, misspelled, spellActive, suggestions, wordAt, type Word } from "@/lib/spell";
import { useUI, type ContextMenuItem } from "@/stores/ui";

export type TextFormat = "bold" | "italic" | "underline" | "strike" | "spoiler" | "code";

/** What a box adds to its menu, or does its own way. */
export interface TextMenuHooks {
  /** Formatting for the Format submenu. A textarea marked `data-markdown` gets markdown's without this. */
  format?: (f: TextFormat) => void;
  /** The keys each format answers to in this box, to show beside it. */
  formatKeys?: Partial<Record<TextFormat, string>>;
  /** Its own history, for a box whose changes the browser's history knows nothing of. */
  undo?: () => void;
  redo?: () => void;
  canUndo?: () => boolean;
  canRedo?: () => boolean;
  /** Puts words in place of the selection, for a box that keeps its own copy of its text. */
  insert?: (text: string) => void;
  /** Items of its own, after the rest. */
  extra?: () => ContextMenuItem[];
}

const registered = new WeakMap<Element, TextMenuHooks>();

/** Gives a box its own part of the menu, or with null takes it away. */
export function setTextMenu(el: Element, hooks: TextMenuHooks | null): void {
  if (hooks) registered.set(el, hooks);
  else registered.delete(el);
}

/**
 * setTextMenu for as long as a component shows the box. The hooks may change
 * from one render to the next; which ones a box has may not.
 */
export function useTextMenu(ref: RefObject<HTMLElement | null>, hooks: TextMenuHooks): void {
  const latest = useRef(hooks);
  latest.current = hooks;
  const through = useRef<TextMenuHooks | null>(null);
  if (!through.current) {
    // every call reaches the hooks of the latest render
    const h: TextMenuHooks = { formatKeys: hooks.formatKeys };
    for (const key of Object.keys(hooks) as (keyof TextMenuHooks)[]) {
      if (key === "formatKeys") continue;
      (h as Record<string, unknown>)[key] = (...args: unknown[]) => (latest.current[key] as ((...a: unknown[]) => unknown) | undefined)?.(...args);
    }
    through.current = h;
  }
  // after every render, as the box may come and go with it
  useEffect(() => {
    const el = ref.current;
    if (!el || !through.current) return;
    setTextMenu(el, through.current);
    return () => setTextMenu(el, null);
  });
}

const MARKERS: Record<TextFormat, WrapMarker> = { bold: "**", italic: "*", underline: "__", strike: "~~", spoiler: "||", code: "`" };
const FORMATS: TextFormat[] = ["bold", "italic", "underline", "strike", "spoiler", "code"];
const FORMAT_LABELS: Record<TextFormat, string> = {
  bold: "composer.format.bold",
  italic: "composer.format.italic",
  underline: "composer.format.underline",
  strike: "composer.format.strike",
  spoiler: "composer.format.spoiler",
  code: "composer.format.inlineCode",
};

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
/** How a shortcut with the command key reads here: ⌘X on a Mac, Ctrl+X elsewhere. */
export function modKeys(key: string, shift = false): string {
  if (isMac) return (shift ? "⇧" : "") + "⌘" + key;
  return "Ctrl+" + (shift ? "Shift+" : "") + key;
}

type Field = HTMLTextAreaElement | HTMLInputElement;
/** The kinds of input with words in them that can be selected: an email or number box cannot say what is selected. */
const TEXT_TYPES = new Set(["text", "search", "url", "tel"]);

function isField(el: Element): el is Field {
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
}

function editable(el: HTMLElement): boolean {
  if (typeof el.isContentEditable === "boolean") return el.isContentEditable;
  const v = el.getAttribute("contenteditable");
  return v === "" || v === "true" || v === "plaintext-only";
}

/** The text box a right click landed in, when it is one this menu serves. */
export function textBoxOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element) || target.closest("[data-native-menu]")) return null;
  if (target instanceof HTMLTextAreaElement) return target.disabled ? null : target;
  if (target instanceof HTMLInputElement) return TEXT_TYPES.has(target.type) && !target.disabled ? target : null;
  const host = target.closest<HTMLElement>("[contenteditable]:not([contenteditable='false'])");
  if (!host || !editable(host)) return null;
  let root = host;
  while (root.parentElement && editable(root.parentElement)) root = root.parentElement;
  return root;
}

/** The box and its selection as the right click found them, to put back before acting on it. */
interface Snap {
  el: HTMLElement;
  field: Field | null;
  start: number;
  end: number;
  range: Range | null;
  readOnly: boolean;
  selected: string;
  empty: boolean;
}

function snapshot(el: HTMLElement): Snap {
  if (isField(el)) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    return { el, field: el, start, end, range: null, readOnly: el.readOnly, selected: el.value.slice(start, end), empty: el.value.length === 0 };
  }
  const sel = document.getSelection();
  const range = sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer) ? sel.getRangeAt(0).cloneRange() : null;
  return { el, field: null, start: 0, end: 0, range, readOnly: false, selected: range && !range.collapsed ? range.toString() : "", empty: !el.textContent?.trim() && !el.querySelector("img") };
}

function hasSelection(s: Snap): boolean {
  return s.field ? s.end > s.start : !!s.range && !s.range.collapsed;
}

/** Focus and the selection back in the box, as they were when the menu opened. */
function restore(s: Snap): void {
  s.el.focus({ preventScroll: true });
  if (s.field) {
    try {
      s.field.setSelectionRange(s.start, s.end);
    } catch {
      /* an input that has no selection to set */
    }
    return;
  }
  if (!s.range) return;
  const sel = document.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(s.range);
}

function exec(command: string, value?: string): boolean {
  try {
    return typeof document.execCommand === "function" && document.execCommand(command, false, value);
  } catch {
    return false;
  }
}

/** Whether the browser says a command would do anything; yes when it cannot say. */
function possible(command: string): boolean {
  try {
    return typeof document.queryCommandEnabled !== "function" || document.queryCommandEnabled(command);
  } catch {
    return true;
  }
}

/**
 * Words in place of the selection, the way typing puts them there, so Undo
 * takes them back and the box's own handlers hear of it.
 */
function insertText(s: Snap, text: string): void {
  const hooks = registered.get(s.el);
  if (hooks?.insert) return hooks.insert(text);
  if (s.field) {
    const f = s.field;
    const from = f.selectionStart ?? f.value.length;
    const to = f.selectionEnd ?? from;
    if (exec("insertText", text) && f.value.slice(from, from + text.length) === text) return;
    f.setRangeText(text, from, to, "end");
    f.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  if (exec("insertText", text)) return;
  const sel = document.getSelection();
  if (!sel?.rangeCount) return;
  const r = sel.getRangeAt(0);
  r.deleteContents();
  r.insertNode(document.createTextNode(text));
  r.collapse(false);
  s.el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Takes the selection away, for a cut the browser would not do itself. */
function deleteSelection(s: Snap): void {
  if (exec("delete")) return;
  insertText(s, "");
}

async function cut(s: Snap): Promise<void> {
  restore(s);
  if (exec("cut")) return;
  if (await copyText(s.selected)) {
    restore(s);
    deleteSelection(s);
  } else useUI.getState().toast(t("common.copyFailed"), "error");
}

async function copy(s: Snap): Promise<void> {
  restore(s);
  if (exec("copy")) return;
  if (!(await copyText(s.selected))) useUI.getState().toast(t("common.copyFailed"), "error");
}

/** What the clipboard holds, as far as the browser lets a page read it. */
async function readClipboard(): Promise<{ text: string; html: string; files: File[] } | null> {
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!clip) return null;
  try {
    if (clip.read) {
      let text = "";
      let html = "";
      const files: File[] = [];
      for (const item of await clip.read()) {
        for (const type of item.types) {
          const blob = await item.getType(type);
          if (type === "text/plain") text ||= await blob.text();
          else if (type === "text/html") html ||= await blob.text();
          else if (type.startsWith("image/")) files.push(new File([blob], `image.${type.slice(6).replace(/\W.*$/, "") || "png"}`, { type }));
        }
      }
      return { text, html, files };
    }
  } catch {
    // refused, or a browser that only reads text
  }
  try {
    return clip.readText ? { text: await clip.readText(), html: "", files: [] } : null;
  } catch {
    return null;
  }
}

/**
 * Paste, handed to the box as a paste so it treats it like Ctrl+V: the
 * message box stages a picture or holds back a paste that is too long, the
 * formatting editor reads markdown. Words nobody took go in as typed.
 */
async function paste(s: Snap): Promise<void> {
  // the desktop app pastes for the page, as its own menu did: the page may not read the clipboard there
  const bridge = desktopBridge();
  if (bridge?.paste) {
    restore(s);
    if (await bridge.paste().catch(() => false)) return;
  }
  const clip = await readClipboard();
  restore(s);
  if (!clip || (!clip.text && clip.files.length === 0)) {
    // the old command still works where the page may use the clipboard (the desktop app)
    if (clip === null && exec("paste")) return;
    if (clip === null) useUI.getState().toast(t("textMenu.pasteBlocked", { keys: modKeys("V") }), "info");
    return;
  }
  let handled = false;
  try {
    const data = new DataTransfer();
    if (clip.text) data.setData("text/plain", clip.text);
    if (clip.html) data.setData("text/html", clip.html);
    for (const f of clip.files) data.items.add(f);
    const ev = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    s.el.dispatchEvent(ev);
    handled = ev.defaultPrevented;
  } catch {
    // no DataTransfer to hand over: the words go in as typed
  }
  if (!handled && clip.text) insertText(snapshot(s.el), clip.text);
}

function selectAll(s: Snap): void {
  s.el.focus({ preventScroll: true });
  if (s.field) s.field.select();
  else exec("selectAll");
}

function format(s: Snap, f: TextFormat): void {
  restore(s);
  const hooks = registered.get(s.el);
  if (hooks?.format) return hooks.format(f);
  if (s.el instanceof HTMLTextAreaElement) applyWrap(s.el, MARKERS[f]);
}

/** Where a caret would go for a point on screen, in a contenteditable box. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof doc.caretPositionFromPoint === "function") {
    const p = doc.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  if (typeof doc.caretRangeFromPoint === "function") {
    const r = doc.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null;
}

interface Spelling {
  word: string;
  /** Selects the word, for the spelling that replaces it. */
  select: () => void;
  suggestions: string[];
}

/** The misspelled word the right click was on, and what it might be; null for anything else. */
async function spellingAt(s: Snap, x: number, y: number): Promise<Spelling | null> {
  if (!spellActive() || s.readOnly) return null;
  // a box that wants no spell checking (a name, an address) gets none here either
  if (!s.el.spellcheck && !s.el.hasAttribute("data-spell")) return null;
  let found: { word: Word; select: () => void } | null = null;
  if (s.field) {
    // the right click put the caret on the word, or left a selection of just that word
    const field = s.field;
    const w = wordAt(field.value, s.start);
    if (w && (s.start === s.end || (s.start === w.start && s.end === w.end))) found = { word: w, select: () => field.setSelectionRange(w.start, w.end) };
  } else {
    const at = caretAt(x, y);
    if (at && at.node.nodeType === Node.TEXT_NODE && s.el.contains(at.node)) {
      const node = at.node as Text;
      const w = wordAt(node.data, at.offset);
      if (w) {
        found = {
          word: w,
          select: () => {
            const r = document.createRange();
            r.setStart(node, w.start);
            r.setEnd(node, w.end);
            const sel = document.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(r);
          },
        };
      }
    }
  }
  if (!found) return null;
  if (!(await misspelled([found.word.word])).size) return null;
  return { word: found.word.word, select: found.select, suggestions: await suggestions(found.word.word) };
}

/** No longer than this is spent on spellings before the menu opens without them. */
const SPELL_WAIT_MS = 400;

function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([work, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/** The menu's items for a box, as found when it was right-clicked. */
function textMenuItems(s: Snap, spelling: Spelling | null): ContextMenuItem[] {
  const hooks = registered.get(s.el);
  const writable = !s.readOnly;
  const selected = hasSelection(s);
  const items: ContextMenuItem[] = [];
  if (spelling) {
    if (spelling.suggestions.length) {
      for (const word of spelling.suggestions) {
        items.push({
          id: `spell:${word}`,
          label: word,
          strong: true,
          onSelect: () => {
            restore(s);
            spelling.select();
            insertText(snapshot(s.el), word);
          },
        });
      }
    } else items.push({ id: "spell:none", label: t("textMenu.noSuggestions"), disabled: true });
    items.push({ id: "spell:add", label: t("textMenu.addToDictionary"), onSelect: () => learn(spelling.word), separatorAfter: true });
  }
  if (writable) {
    items.push(
      { id: "undo", label: t("textMenu.undo"), keys: modKeys("Z"), disabled: !(hooks?.canUndo ? hooks.canUndo() : possible("undo")), onSelect: () => (hooks?.undo ? hooks.undo() : (restore(s), exec("undo"))) },
      { id: "redo", label: t("textMenu.redo"), keys: isMac ? modKeys("Z", true) : modKeys("Y"), disabled: !(hooks?.canRedo ? hooks.canRedo() : possible("redo")), onSelect: () => (hooks?.redo ? hooks.redo() : (restore(s), exec("redo"))), separatorAfter: true },
      { id: "cut", label: t("textMenu.cut"), keys: modKeys("X"), disabled: !selected, onSelect: () => void cut(s) },
    );
  }
  items.push({ id: "copy", label: t("textMenu.copy"), keys: modKeys("C"), disabled: !selected, onSelect: () => void copy(s) });
  // an app too old to paste for the page says so, and offers the update
  if (writable && pasteNeedsUpdate()) items.push({ id: "paste", label: t("textMenu.paste"), warn: t("textMenu.pasteNeedsUpdate"), onSelect: () => useUI.getState().openModal("pasteUpdate") });
  else if (writable) items.push({ id: "paste", label: t("textMenu.paste"), keys: modKeys("V"), onSelect: () => void paste(s) });
  items.push({ id: "selectAll", label: t("textMenu.selectAll"), keys: modKeys("A"), disabled: s.empty, onSelect: () => selectAll(s) });
  const formats = writable && (hooks?.format || (s.el instanceof HTMLTextAreaElement && s.el.hasAttribute("data-markdown")));
  if (formats) {
    const keys: Partial<Record<TextFormat, string>> = hooks?.formatKeys ?? { bold: modKeys("B"), italic: modKeys("I"), underline: modKeys("U") };
    items[items.length - 1]!.separatorAfter = true;
    items.push({
      id: "format",
      label: t("textMenu.format"),
      submenu: FORMATS.map((f) => ({ id: `format:${f}`, label: t(FORMAT_LABELS[f]), keys: keys[f], onSelect: () => format(s, f) })),
    });
  }
  const extra = hooks?.extra?.() ?? [];
  if (extra.length) {
    items[items.length - 1]!.separatorAfter = true;
    items.push(...extra);
  }
  return items;
}

/**
 * Opens the menu for a box, at a point on screen. Opened with the mouse it
 * leaves focus in the box, so a selection stays in view (keepFocus); opened
 * from the keyboard it takes focus, for the arrows.
 */
export async function openTextMenu(el: HTMLElement, x: number, y: number, byMouse = true): Promise<void> {
  const s = snapshot(el);
  const spelling = await within(spellingAt(s, x, y).catch(() => null), SPELL_WAIT_MS);
  if (!el.isConnected) return;
  useUI.getState().openContextMenu({ x, y, items: textMenuItems(s, spelling), label: t("textMenu.label"), keepFocus: byMouse });
}

/**
 * Words picked out on the page, or a link, where nothing has a menu of its
 * own (a message's, a person's, a server's): a small menu of the app's own,
 * so it is the same in a browser and in the desktop app, where each would
 * otherwise show a different one of its own. Empty when there is neither.
 */
export function pageItems(target: EventTarget | null): ContextMenuItem[] {
  if (!(target instanceof Element) || target.closest("[data-native-menu]")) return [];
  const items: ContextMenuItem[] = [];
  const sel = typeof window.getSelection === "function" ? window.getSelection() : null;
  const words = sel && !sel.isCollapsed ? sel.toString() : "";
  // only when the click is on the words picked out, as a browser's menu goes
  let onWords = false;
  try {
    onWords = !!words.trim() && !!sel && sel.rangeCount > 0 && sel.getRangeAt(0).intersectsNode(target);
  } catch {
    onWords = false;
  }
  if (onWords) {
    items.push({
      id: "copy",
      label: t("textMenu.copy"),
      keys: modKeys("C"),
      onSelect: () => {
        // with what formatting the page has, as Ctrl+C would; just the words where that is refused
        if (exec("copy")) return;
        void copyText(words).then((ok) => !ok && useUI.getState().toast(t("common.copyFailed"), "error"));
      },
    });
  }
  const link = target.closest<HTMLAnchorElement>("a[href]");
  const href = link?.getAttribute("href") ?? "";
  if (link && href && !href.startsWith("#") && !/^javascript:/i.test(href)) {
    let address = href;
    try {
      address = new URL(href, window.location.href).toString();
    } catch {
      /* kept as written */
    }
    if (items.length) items[items.length - 1]!.separatorAfter = true;
    // opened the way a click opens it: inside the app when it is the app's (shell/AppLinks), in a new tab otherwise
    items.push({ id: "open-link", label: t("textMenu.openLink"), onSelect: () => link.click() });
    items.push({
      id: "copy-link",
      label: t("textMenu.copyLink"),
      onSelect: () => void copyText(address).then((ok) => useUI.getState().toast(ok ? t("chat.messageMenu.linkCopied") : t("common.copyFailed"), ok ? "success" : "error")),
    });
  }
  return items;
}

/** A pointer that right-clicks: a mouse, a trackpad or a pen, not a finger. */
function fromMouse(e: MouseEvent): boolean {
  if ((e as PointerEvent).pointerType === "touch") return false;
  return typeof window.matchMedia !== "function" || window.matchMedia("(any-pointer: fine)").matches;
}

/**
 * Listens for right clicks on text boxes anywhere in the app. A box whose own
 * handler has already opened a menu (or wants none) is left to it.
 */
export function installTextMenu(doc: Document = document): () => void {
  const onMenu = (e: MouseEvent) => {
    if (e.defaultPrevented) return;
    // Shift with a right click: the browser's own menu, with Inspect and the rest
    if (e.shiftKey && e.button === 2) return;
    if (!fromMouse(e)) return;
    const el = textBoxOf(e.target);
    if (!el) {
      const items = pageItems(e.target);
      if (!items.length) return;
      e.preventDefault();
      let { clientX: x, clientY: y } = e;
      // the menu key on a focused link has no pointer: the menu opens at the link
      if (e.button !== 2 && e.target instanceof Element) {
        const r = e.target.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) {
          x = r.left + 8;
          y = r.bottom;
        }
      }
      useUI.getState().openContextMenu({ x, y, items, label: t("textMenu.label"), keepFocus: e.button === 2 });
      return;
    }
    e.preventDefault();
    // the menu key or Shift+F10 has no pointer: the menu opens at the box
    let { clientX: x, clientY: y } = e;
    const r = el.getBoundingClientRect();
    if (e.button !== 2 && (x < r.left || x > r.right || y < r.top || y > r.bottom)) {
      x = r.left + 12;
      y = r.top + Math.min(r.height, 28);
    }
    void openTextMenu(el, x, y, e.button === 2);
  };
  doc.addEventListener("contextmenu", onMenu);
  return () => doc.removeEventListener("contextmenu", onMenu);
}
