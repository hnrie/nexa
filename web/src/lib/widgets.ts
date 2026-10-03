/**
 * Profile widgets (internal/api/widgets.go): sections of a profile that show
 * what someone is into. Games they love, are playing, want to play and have
 * played, found on IGDB or added by name, and cards they make themselves.
 * The server checks and keeps them; this is their shape on this side, read
 * defensively, and the addresses of their pictures.
 */
import { api } from "@/api/client";
import { mediaSize } from "@/api/users";

export interface WidgetGame {
  /** IGDB's id for the game, when it came from the games search. */
  id?: string;
  name: string;
  /** IGDB's image id for its cover. */
  cover?: string;
  /** A picture of the person's own, for a game added by name. */
  image?: string;
  /** Only for Playing Now: how they play it. */
  tags?: string[];
}

export interface WidgetStat {
  label: string;
  value: string;
}

export type GameWidgetType = "favorite" | "playing" | "wishlist" | "played";
export type WidgetType = GameWidgetType | "custom";

export interface GameWidget {
  id: string;
  type: GameWidgetType;
  games: WidgetGame[];
  /** Only for Favorite Game: why. */
  note?: string;
}

export interface CardWidget {
  id: string;
  type: "custom";
  title: string;
  image?: string;
  shape?: "wide" | "square";
  text?: string;
  stats?: WidgetStat[];
  link?: { url: string; label?: string };
}

export type Widget = GameWidget | CardWidget;

export const GAME_TYPES: GameWidgetType[] = ["favorite", "playing", "wishlist", "played"];
export const WIDGET_TYPES: WidgetType[] = [...GAME_TYPES, "custom"];
export const MAX_WIDGETS = 8;
export const MAX_CARDS = 4;
/** The most games each kind of games widget holds. */
export const MOST_GAMES: Record<GameWidgetType, number> = { favorite: 1, playing: 5, wishlist: 20, played: 20 };
export const LIMITS = { note: 200, tags: 3, tag: 20, game: 100, title: 40, text: 300, stats: 6, label: 24, value: 40, linkLabel: 32 };

export function isGameWidget(w: Widget): w is GameWidget {
  return w.type !== "custom";
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

function readGame(x: unknown): WidgetGame | null {
  if (!x || typeof x !== "object") return null;
  const g = x as Record<string, unknown>;
  const name = str(g["name"], LIMITS.game).trim();
  if (!name) return null;
  const out: WidgetGame = { name };
  if (typeof g["id"] === "string" && /^\d{1,10}$/.test(g["id"])) out.id = g["id"];
  if (typeof g["cover"] === "string" && /^[a-z0-9]{6,32}$/.test(g["cover"])) out.cover = g["cover"];
  if (typeof g["image"] === "string" && /^\d{1,20}$/.test(g["image"])) out.image = g["image"];
  if (Array.isArray(g["tags"])) out.tags = g["tags"].filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.slice(0, LIMITS.tag)).slice(0, LIMITS.tags);
  return out;
}

/** Widgets as the server sent them, read defensively: anything malformed is left out. */
export function readWidgets(x: unknown): Widget[] {
  if (!Array.isArray(x)) return [];
  const out: Widget[] = [];
  for (const raw of x) {
    if (!raw || typeof raw !== "object") continue;
    const w = raw as Record<string, unknown>;
    const id = typeof w["id"] === "string" ? w["id"] : `w${out.length}`;
    const type = w["type"];
    if (type === "custom") {
      const title = str(w["title"], LIMITS.title).trim();
      if (!title) continue;
      const card: CardWidget = { id, type, title };
      if (typeof w["image"] === "string" && /^\d{1,20}$/.test(w["image"])) {
        card.image = w["image"];
        card.shape = w["shape"] === "square" ? "square" : "wide";
      }
      const text = str(w["text"], LIMITS.text);
      if (text) card.text = text;
      if (Array.isArray(w["stats"])) {
        card.stats = w["stats"]
          .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
          .map((s) => ({ label: str(s["label"], LIMITS.label), value: str(s["value"], LIMITS.value) }))
          .filter((s) => s.label && s.value)
          .slice(0, LIMITS.stats);
      }
      const link = w["link"] as Record<string, unknown> | undefined;
      if (link && typeof link["url"] === "string" && /^https?:\/\//i.test(link["url"])) card.link = { url: link["url"], ...(typeof link["label"] === "string" && link["label"] ? { label: link["label"].slice(0, LIMITS.linkLabel) } : {}) };
      out.push(card);
      continue;
    }
    if (type !== "favorite" && type !== "playing" && type !== "wishlist" && type !== "played") continue;
    const games = Array.isArray(w["games"]) ? w["games"].map(readGame).filter((g): g is WidgetGame => !!g).slice(0, MOST_GAMES[type]) : [];
    if (games.length === 0) continue;
    const game: GameWidget = { id, type, games };
    if (type === "favorite" && typeof w["note"] === "string" && w["note"]) game.note = w["note"].slice(0, LIMITS.note);
    out.push(game);
  }
  return out.slice(0, 8);
}

/** A game's cover from IGDB, kept by this server: "s" for small, "l" for large. */
export function gameCoverUrl(cover: string, size: "s" | "l"): string {
  return `${api.baseUrl}/media/game/${cover}?size=${size}`;
}

/** A widget's own picture at a size. */
export function widgetImageUrl(id: string, css?: number): string {
  const base = `${api.baseUrl}/media/widget/${id}`;
  return css ? `${base}?size=${mediaSize(css)}` : base;
}

/** A game's picture: its cover, or the one its owner put up, or none. */
export function gamePicture(g: WidgetGame, css: number): string | null {
  if (g.cover) return gameCoverUrl(g.cover, css > 80 ? "l" : "s");
  if (g.image) return widgetImageUrl(g.image, css);
  return null;
}

/** A short id for a new widget, as the server takes them. */
export function newWidgetId(): string {
  return `w${Math.random().toString(36).slice(2, 10)}`;
}

/** The host a link goes to, for a link with no words of its own. */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Widgets as short lines for the staff: what each is called, and its games or a card's words. */
export function widgetsText(widgets: Widget[], title: (w: Widget) => string): { title: string; text: string }[] {
  return widgets.map((w) => {
    if (isGameWidget(w)) return { title: title(w), text: [w.games.map((g) => g.name).join(", "), w.note].filter(Boolean).join(" · ") };
    return { title: title(w), text: [w.title, w.text, ...(w.stats ?? []).map((st) => `${st.label}: ${st.value}`), w.link?.url].filter(Boolean).join(" · ") };
  });
}
