import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { emojiUrl } from "@/api/users";
import type { Emoji, StickerPack } from "@/api/types";
import { Twemoji } from "@/components/common/Twemoji";
import { portalRoot } from "@/hooks/usePortalRoot";
import { emojiShortcode, ensureShortcodes, onShortcodesReady, shortcodesReady } from "@/lib/shortcodes";
import { useExpressions } from "@/stores/expressions";
import { useServers } from "@/stores/servers";
import s from "./EmojiDetails.module.css";

import { t } from "@/i18n";

/** An emoji in the words of a message, as render.tsx marks it. */
export type ShownEmoji = { kind: "unicode"; text: string } | { kind: "custom"; id: string; name: string; animated: boolean };

/** The box an emoji is drawn in, when `target` is in one. */
export function emojiBoxOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>("[data-emoji-card]") : null;
}

/** What the emoji in a box is: its character, or a custom emoji's picture and name. */
export function emojiOf(box: HTMLElement): ShownEmoji | null {
  if (box.dataset["emojiCard"] === "custom") {
    const id = box.dataset["emojiId"];
    const name = box.dataset["emojiName"];
    return id && name ? { kind: "custom", id, name, animated: box.dataset["emojiAnimated"] === "true" } : null;
  }
  const text = box.querySelector("img")?.getAttribute("alt") ?? box.textContent ?? "";
  return text ? { kind: "unicode", text } : null;
}

/** The server of yours a custom emoji belongs to, by its picture, which is what a message names it by. */
export function emojiServer(id: string, emojis: Record<string, Emoji[]>): string | null {
  for (const [server, list] of Object.entries(emojis)) if (list.some((e) => e.blob_id === id)) return server;
  return null;
}

/** The emoji pack of yours a custom emoji is in. */
export function emojiPack(id: string, packs: Record<string, StickerPack>): StickerPack | null {
  for (const pack of Object.values(packs)) if (pack.kind === "emoji" && pack.stickers.some((st) => st.blob_id === id)) return pack;
  return null;
}

const GAP = 8;
/** How long the pointer rests on an emoji before it is named, as a tooltip waits. */
const HOVER_MS = 300;

/** Above the emoji when there is room, else below; always on screen. */
function place(anchor: DOMRect, box: DOMRect): { left: number; top: number } {
  let top = anchor.top - box.height - GAP;
  if (top < 4) top = anchor.bottom + GAP;
  const left = anchor.left + anchor.width / 2 - box.width / 2;
  return {
    left: Math.max(4, Math.min(left, window.innerWidth - box.width - 4)),
    top: Math.max(4, Math.min(top, window.innerHeight - box.height - 4)),
  };
}

interface Open {
  box: HTMLElement;
  emoji: ShownEmoji;
  /** Pressed rather than pointed at: it stays until dismissed, and takes the pointer. */
  pinned: boolean;
}

/**
 * Names the emoji in messages. Resting the pointer on one shows it large with
 * the `:name:` that types it and where it comes from; pressing one (the only
 * way on a touch screen) keeps that card open until a press elsewhere, Escape
 * or a scroll that takes the emoji away. One listener on the document serves
 * every message, so nothing is added to each emoji drawn.
 */
export function EmojiDetails() {
  const [open, setOpen] = useState<Open | null>(null);
  const openRef = useRef<Open | null>(null);
  openRef.current = open;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverBox = useRef<HTMLElement | null>(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const close = useCallback(() => {
    clearTimer();
    hoverBox.current = null;
    setOpen(null);
  }, []);

  useEffect(() => {
    const over = (e: PointerEvent) => {
      // a finger has no hover; it presses instead
      if (e.pointerType === "touch" || openRef.current?.pinned) return;
      const box = emojiBoxOf(e.target);
      if (!box || box === hoverBox.current) return;
      const emoji = emojiOf(box);
      if (!emoji) return;
      clearTimer();
      hoverBox.current = box;
      // moving from one emoji to the next swaps the card straight away
      if (openRef.current) setOpen({ box, emoji, pinned: false });
      else timer.current = setTimeout(() => setOpen({ box, emoji, pinned: false }), HOVER_MS);
    };
    const out = (e: PointerEvent) => {
      const box = hoverBox.current;
      if (!box || openRef.current?.pinned) return;
      if (e.relatedTarget instanceof Node && box.contains(e.relatedTarget)) return;
      close();
    };
    const click = (e: MouseEvent) => {
      const box = emojiBoxOf(e.target);
      if (!box || e.defaultPrevented) return;
      // an emoji inside a link or a button leaves the press to it
      if (box.closest("a[href], button, [role='button']")) return;
      // the end of a drag that selected something is not a press
      if (document.getSelection()?.isCollapsed === false) return;
      const emoji = emojiOf(box);
      if (!emoji) return;
      clearTimer();
      hoverBox.current = null;
      const cur = openRef.current;
      setOpen(cur?.pinned && cur.box === box ? null : { box, emoji, pinned: true });
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("click", click);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("click", click);
      clearTimer();
    };
  }, [close]);

  return open ? <EmojiCard open={open} onClose={close} /> : null;
}

function EmojiCard({ open, onClose }: { open: Open; onClose: () => void }) {
  const { box, emoji, pinned } = open;
  const card = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  const reposition = useCallback(() => {
    const el = card.current;
    if (!el) return;
    const a = box.getBoundingClientRect();
    // an emoji scrolled away, or out of the list altogether, takes its card with it
    if (!box.isConnected || a.bottom < 0 || a.top > window.innerHeight) {
      onClose();
      return;
    }
    setAt(place(a, el.getBoundingClientRect()));
  }, [box, onClose]);
  const name = useEmojiName(emoji);
  // measured again whenever what it says changes its size
  useLayoutEffect(reposition, [reposition, emoji, name]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const target = e.target as Node;
      // the emoji itself toggles its card, so a press on it is left to its click
      if (card.current?.contains(target) || box.contains(target)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // a pinned card is what Escape closes first, before the dialog or panel under it
      if (pinned) e.stopPropagation();
      onClose();
    };
    // a pointed-at card goes as soon as anything moves; a pinned one follows its emoji
    const scroll = pinned ? reposition : onClose;
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [box, pinned, onClose, reposition]);

  return createPortal(
    <div
      ref={card}
      className={s.card}
      data-pinned={pinned}
      role={pinned ? "dialog" : "tooltip"}
      aria-label={pinned ? (name ?? undefined) : undefined}
      data-testid="emoji-details"
      style={at ? { left: at.left, top: at.top } : { left: -9999, top: -9999 }}
    >
      <span className={s.picture} aria-hidden="true">
        {emoji.kind === "unicode" ? <Twemoji text={emoji.text} className={s.img} fallbackClassName={s.glyph} title="" /> : <img className={s.img} src={emojiUrl(emoji.id, emoji.animated, 96)} alt="" draggable={false} />}
      </span>
      <span className={s.words}>
        {name ? <span className={s.name}>{name}</span> : null}
        <span className={s.sub}>{emoji.kind === "unicode" ? t("chat.emojiDetails.standard") : <CustomSource id={emoji.id} />}</span>
      </span>
    </div>,
    portalRoot(),
  );
}

/** The `:name:` that types an emoji; a standard one's waits for the table of names. */
function useEmojiName(emoji: ShownEmoji): string | null {
  const [, bump] = useState(0);
  const unicode = emoji.kind === "unicode";
  useEffect(() => {
    if (!unicode || shortcodesReady()) return;
    ensureShortcodes();
    return onShortcodesReady(() => bump((n) => n + 1));
  }, [unicode]);
  if (emoji.kind === "custom") return `:${emoji.name}:`;
  const code = emojiShortcode(emoji.text);
  return code ? `:${code}:` : null;
}

/** Where a custom emoji comes from, when it is from somewhere of yours. */
function CustomSource({ id }: { id: string }) {
  const serverId = useExpressions((x) => emojiServer(id, x.emojis));
  const serverName = useServers((st) => (serverId ? (st.byId[serverId]?.server.name ?? null) : null));
  const packName = useExpressions((x) => (serverName ? null : (emojiPack(id, x.packs)?.name ?? null)));
  if (serverName) return <>{t("chat.emojiDetails.fromServer", { name: serverName })}</>;
  if (packName) return <>{t("chat.emojiDetails.fromPack", { name: packName })}</>;
  return <>{t("chat.emojiDetails.custom")}</>;
}
