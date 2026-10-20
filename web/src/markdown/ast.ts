// AST for Nexa's markdown.
//
// The parser produces a flat-ish tree of these nodes. Block nodes (paragraph,
// quote, heading, subtext, list, codeblock, hr, table, alert, details,
// footnotes) only appear at the top level of a non-inline parse, or inside an
// alert or a collapsible section; everything else is inline and may nest.

/** The five callouts GitHub has: `> [!NOTE]` and so on. */
export type AlertKind = "note" | "tip" | "important" | "warning" | "caution";

/** How a table column lines up, as its delimiter row says (`:--`, `:-:`, `--:`). */
export type Align = "left" | "center" | "right" | null;

export type Node =
  | { type: "text"; text: string }
  | { type: "strong" | "em" | "u" | "s" | "spoiler" | "paragraph" | "quote" | "mark" | "sup" | "sub"; children: Node[] }
  | { type: "code"; text: string }
  | { type: "codeblock"; lang: string | null; text: string }
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: Node[] }
  | { type: "subtext"; children: Node[] }
  | { type: "list"; ordered: boolean; start: number; items: Node[][] }
  /** A task list item's box; always the first node of its item. */
  | { type: "task"; checked: boolean }
  | { type: "hr" }
  /**
   * A file a note holds, on a line of its own: `![name](nexa-file:id)`. Only a
   * note's text is parsed with these on (`files`); in a message the same
   * characters are the words they look like.
   */
  /** A note's file on a line of its own; `width` is how much of the line a picture takes, in percent, when not all of it, and `align` the side it keeps to. */
  | { type: "file"; id: string; name: string; width?: number; align?: "left" | "right" }
  /** `head` is the header row's cells; every row has exactly `align.length` cells. */
  | { type: "table"; align: Align[]; head: Node[][]; rows: Node[][][] }
  | { type: "alert"; kind: AlertKind; children: Node[] }
  /** A collapsible section; an empty summary reads as "Details". */
  | { type: "details"; summary: Node[]; children: Node[] }
  /** Text in a colour: `fg` and `bg` are a palette name ("red") or "#rrggbb". */
  | { type: "color"; fg: string | null; bg: string | null; children: Node[] }
  | { type: "footnoteRef"; label: string; n: number }
  /** The notes a message's references point to, numbered in the order they are first referenced. */
  | { type: "footnotes"; notes: { label: string; n: number; children: Node[] }[] }
  | { type: "link"; url: string; children: Node[]; masked: boolean; noEmbed: boolean }
  | { type: "mention"; kind: "user" | "channel" | "role"; id: string }
  | { type: "mention"; kind: "everyone" | "here" }
  | { type: "emoji"; name: string; id: string; animated: boolean }
  | { type: "unicodeEmoji"; text: string }
  | { type: "timestamp"; unix: number; style: "t" | "T" | "d" | "D" | "f" | "F" | "R" }
  | { type: "br" };

/** Everything the renderer needs to turn ids into human-readable content. */
export interface RenderCtx {
  users: Record<string, { display_name: string; username: string }>;
  channels: Record<string, { name: string }>;
  roles?: Record<string, { name: string; color: number }>;
  /** `css`, when given, is how many pixels across the emoji is drawn. */
  emojiUrl: (id: string, animated: boolean, css?: number) => string;
  onUserClick?: (id: string, el: HTMLElement) => void;
  onChannelClick?: (id: string) => void;
  revealSpoilers?: boolean; // when true spoilers render revealed
  /**
   * Drawn as a picture of a message, such as the line over a reply: no link,
   * mention or spoiler in it takes a click or the keyboard, since the whole
   * line is already the way to the message.
   */
  inert?: boolean;
  /** Emoji drawn as their :name: in words: another server's, in a message whose author may not use them there. */
  plainEmoji?: (id: string) => boolean;
  /** Draws a note's file where the text has it; without it the file's name stands in. */
  /** Draws a note's file where its text has it; `width` is the share of the line a picture takes, in percent, when not all of it. */
  renderFile?: (id: string, name: string, width?: number, align?: "left" | "right") => import("react").ReactNode;
}
