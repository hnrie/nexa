// AST for Discord-flavoured markdown.
//
// The parser produces a flat-ish tree of these nodes. Block nodes (paragraph,
// quote, heading, subtext, list, codeblock) only appear at the top level of a
// non-inline parse; everything else is inline and may nest.

export type Node =
  | { type: "text"; text: string }
  | { type: "strong" | "em" | "u" | "s" | "spoiler" | "paragraph" | "quote"; children: Node[] }
  | { type: "code"; text: string }
  | { type: "codeblock"; lang: string | null; text: string }
  | { type: "heading"; level: 1 | 2 | 3; children: Node[] }
  | { type: "subtext"; children: Node[] }
  | { type: "list"; ordered: boolean; start: number; items: Node[][] }
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
}
