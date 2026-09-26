import { Copy } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { Twemoji } from "@/components/common/Twemoji";
import { copyText } from "@/lib/clipboard";
import { MentionGlyph } from "@/components/common/ChannelGlyph";
import { ensureShortcodes, mightHaveShortcode, onShortcodesReady, shortcodeVersion, shortcodesReady } from "@/lib/shortcodes";
import { formatStamp, type StampStyle } from "@/lib/time";
import type { Node, RenderCtx } from "./ast";
import { parse, plainText } from "./parse";

import { t } from "@/i18n";
// ---------------------------------------------------------------------------
// React renderer for the markdown AST.
//
// Everything here builds real React elements; no HTML string ever reaches the
// DOM, including the syntax highlighting, which is converted from highlight.js'
// output by `parseHighlightHtml` below.
// ---------------------------------------------------------------------------

/** Renders a raw message. `parse` is memoised on the source and the mode. */
export function Markdown(props: { source: string; ctx: RenderCtx; inline?: boolean; jumbo?: boolean }): JSX.Element {
  const { source, ctx, inline, jumbo } = props;
  // `:shortcode:` names need a table that arrives on demand; once it does,
  // everything already on screen parses again and the names turn into emoji.
  const codes = useShortcodes(source);
  const nodes = useMemo(() => parse(source, { inline: inline === true }), [source, inline, codes]);
  return <RenderNodes nodes={nodes} ctx={ctx} jumbo={jumbo} />;
}

/** Loads the shortcode table when some text might need it, and re-renders once it lands. */
function useShortcodes(source: string): number {
  const [version, setVersion] = useState(() => shortcodeVersion());
  const wants = mightHaveShortcode(source);
  useEffect(() => {
    if (!wants || shortcodesReady()) return;
    ensureShortcodes();
    return onShortcodesReady(() => setVersion(shortcodeVersion()));
  }, [wants]);
  return version;
}

/**
 * A key that follows what the node holds rather than where it sits.
 *
 * Most nodes are stateless, but a spoiler remembers being revealed and a code
 * block its highlighting. Keyed by index, an edit that removes a node hands
 * that state to whichever node moves into its place — the second spoiler in a
 * message shows itself because the first one was opened.
 */
function signature(node: Node, max: number): string {
  if (max <= 0) return "";
  switch (node.type) {
    case "text":
    case "code":
    case "codeblock":
    case "unicodeEmoji":
      return node.text.slice(0, max);
    case "emoji":
      return node.id;
    case "mention":
      return "id" in node ? `${node.kind}:${node.id}` : node.kind;
    case "link":
      return node.url.slice(0, max);
    case "timestamp":
      return `${node.unix}:${node.style}`;
    case "br":
      return "";
    case "list": {
      let out = "";
      for (const item of node.items) {
        for (const child of item) {
          out += signature(child, max - out.length);
          if (out.length >= max) return out.slice(0, max);
        }
      }
      return out;
    }
    default: {
      let out = "";
      for (const child of node.children) {
        out += signature(child, max - out.length);
        if (out.length >= max) return out.slice(0, max);
      }
      return out;
    }
  }
}

function nodeKey(node: Node, n: number): string {
  return `${n}:${node.type}:${signature(node, 48)}`;
}

/** Renders an already parsed list of nodes. */
export function RenderNodes(props: { nodes: Node[]; ctx: RenderCtx; jumbo?: boolean }): JSX.Element {
  const { nodes, ctx, jumbo } = props;
  return (
    <>
      {nodes.map((node, i) => (
        <Fragment key={nodeKey(node, i)}>{renderNode(node, ctx, jumbo === true)}</Fragment>
      ))}
    </>
  );
}

function renderNode(node: Node, ctx: RenderCtx, jumbo: boolean): ReactNode {
  switch (node.type) {
    case "text":
      return node.text;
    case "br":
      return <br />;
    case "strong":
      return (
        <strong>
          <RenderNodes nodes={node.children} ctx={ctx} jumbo={jumbo} />
        </strong>
      );
    case "em":
      return (
        <em>
          <RenderNodes nodes={node.children} ctx={ctx} jumbo={jumbo} />
        </em>
      );
    case "u":
      return (
        <u>
          <RenderNodes nodes={node.children} ctx={ctx} jumbo={jumbo} />
        </u>
      );
    case "s":
      return (
        <s>
          <RenderNodes nodes={node.children} ctx={ctx} jumbo={jumbo} />
        </s>
      );
    case "spoiler":
      return (
        <Spoiler ctx={ctx}>
          <RenderNodes nodes={node.children} ctx={ctx} jumbo={jumbo} />
        </Spoiler>
      );
    // Every block takes the direction of its own words (dir="auto"): an
    // English line in an Arabic conversation reads, and lines up, as English.
    case "paragraph":
      return (
        <div className="md-paragraph" dir="auto">
          <RenderNodes nodes={node.children} ctx={ctx} jumbo={jumbo} />
        </div>
      );
    case "quote":
      return (
        <blockquote className="md-quote" dir="auto">
          <RenderNodes nodes={node.children} ctx={ctx} jumbo={jumbo} />
        </blockquote>
      );
    case "heading": {
      const Tag = (node.level === 1 ? "h1" : node.level === 2 ? "h2" : "h3") as "h1" | "h2" | "h3";
      return (
        <Tag className={"md-h" + String(node.level)} dir="auto">
          <RenderNodes nodes={node.children} ctx={ctx} jumbo={jumbo} />
        </Tag>
      );
    }
    case "subtext":
      return (
        <small className="md-subtext" dir="auto">
          <RenderNodes nodes={node.children} ctx={ctx} jumbo={jumbo} />
        </small>
      );
    case "list": {
      const items = node.items.map((item, i) => (
        <li key={i} className="md-list-item" dir="auto">
          <RenderNodes nodes={item} ctx={ctx} jumbo={jumbo} />
        </li>
      ));
      // the list as a whole follows its first item, so its markers sit on that side
      return node.ordered ? (
        <ol className="md-list" start={node.start} dir="auto">
          {items}
        </ol>
      ) : (
        <ul className="md-list" dir="auto">{items}</ul>
      );
    }
    case "code":
      return <code className="md-inline-code">{node.text}</code>;
    case "codeblock":
      return <CodeBlock lang={node.lang} text={node.text} />;
    case "link": {
      // A masked link says where it really goes, after its words, unless they
      // already name that site: the tooltip that did so shows on no phone.
      const host = node.masked ? linkHost(node.url) : null;
      const shows = host && !plainText(node.children).toLowerCase().replace(/\bwww\./g, "").includes(host);
      return (
        <a
          href={node.url}
          target="_blank"
          rel="noopener noreferrer"
          className="md-link"
          title={node.masked ? node.url : undefined}
        >
          <RenderNodes nodes={node.children} ctx={ctx} jumbo={jumbo} />
          {shows ? <span className="md-link-host" dir="ltr">{host}</span> : null}
        </a>
      );
    }
    case "mention":
      switch (node.kind) {
        case "everyone":
          return <span className="md-mention" style={STATIC}>{t("render.everyone")}</span>;
        case "here":
          return <span className="md-mention" style={STATIC}>{t("render.here")}</span>;
        case "user":
          return <UserMention id={node.id} ctx={ctx} />;
        case "channel":
          return <ChannelMention id={node.id} ctx={ctx} />;
        default:
          return <RoleMention id={node.id} ctx={ctx} />;
      }
    case "emoji":
      return (
        <img
          className={jumbo ? "md-emoji md-emoji-jumbo" : "md-emoji"}
          src={ctx.emojiUrl(node.id, node.animated, 48)}
          alt={":" + node.name + ":"}
          title={":" + node.name + ":"}
          draggable={false}
        />
      );
    case "unicodeEmoji":
      return (
        <Twemoji
          text={node.text}
          className={jumbo ? "md-emoji md-emoji-jumbo" : "md-emoji"}
          fallbackClassName={jumbo ? "md-emoji-unicode md-emoji-jumbo" : "md-emoji-unicode"}
        />
      );
    case "timestamp":
      return <Timestamp unix={node.unix} style={node.style} />;
  }
}

// ---------------------------------------------------------------------------
// spoilers
// ---------------------------------------------------------------------------

/**
 * A spoiler. Hidden, it is a button named "spoiler" whose words are out of
 * the accessibility tree as well as out of sight (transparent text used to be
 * read out in full, as the button's name); shown, it is ordinary text again.
 */
function Spoiler(props: { ctx: RenderCtx; children: ReactNode }): JSX.Element {
  const [revealed, setRevealed] = useState(false);
  const open = props.ctx.revealSpoilers === true || revealed;
  const inner = <span className="md-spoiler-inner">{props.children}</span>;
  if (open) {
    return (
      <span className="md-spoiler" data-revealed="true">
        {inner}
      </span>
    );
  }
  return (
    <span
      className="md-spoiler"
      data-revealed="false"
      role="button"
      tabIndex={0}
      aria-label={t("render.spoilerHidden")}
      aria-expanded={false}
      onClick={(e) => {
        // the first click only uncovers: a link or a mention under it waits for a second one
        e.preventDefault();
        e.stopPropagation();
        setRevealed(true);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        setRevealed(true);
      }}
    >
      {inner}
    </span>
  );
}

// ---------------------------------------------------------------------------
// mentions
// ---------------------------------------------------------------------------

/** Enter or Space on a mention that works as a button. */
function pressed(e: KeyboardEvent): boolean {
  if (e.key !== "Enter" && e.key !== " ") return false;
  e.preventDefault();
  return true;
}

function UserMention(props: { id: string; ctx: RenderCtx }): JSX.Element {
  const user = props.ctx.users[props.id];
  const name = user ? user.display_name || user.username || t("render.unknownUser") : t("render.unknownUser");
  return (
    <span
      className="md-mention"
      role="button"
      tabIndex={0}
      onClick={(e) => props.ctx.onUserClick?.(props.id, e.currentTarget)}
      onKeyDown={(e) => pressed(e) && props.ctx.onUserClick?.(props.id, e.currentTarget)}
    >
      {"@" + name}
    </span>
  );
}

function ChannelMention(props: { id: string; ctx: RenderCtx }): JSX.Element {
  const channel = props.ctx.channels[props.id];
  // A channel this device does not know was deleted, or is private and not
  // for this reader: which one cannot be told, so it says neither, and it
  // leads nowhere.
  if (!channel?.name) {
    return (
      <span className="md-mention" style={UNKNOWN_MENTION} data-channel-mention="unknown">
        {"#" + t("render.unknownChannel")}
      </span>
    );
  }
  const name = channel.name;
  return (
    <span className="md-mention" role="button" tabIndex={0} onClick={() => props.ctx.onChannelClick?.(props.id)} onKeyDown={(e) => pressed(e) && props.ctx.onChannelClick?.(props.id)}>
      <MentionGlyph channel={channel} />{name}
    </span>
  );
}

/** Mentions that only say something: nothing happens when they are clicked, so they do not look as if it would. */
const STATIC: CSSProperties = { cursor: "default" };

/** A role or channel we know nothing about (deleted, or not ours to see) reads as a quiet placeholder, not as a live mention. */
const UNKNOWN_MENTION: CSSProperties = { ...STATIC, color: "var(--text-muted)", backgroundColor: "color-mix(in srgb, var(--text-muted) 14%, transparent)" };

function RoleMention(props: { id: string; ctx: RenderCtx }): JSX.Element {
  const role = props.ctx.roles?.[props.id];
  if (!role) {
    return (
      <span className="md-mention" style={UNKNOWN_MENTION} data-role-mention="unknown">
        {"@" + t("render.unknownRole")}
      </span>
    );
  }
  // Colour 0 is a role without a colour, which looks like any other mention.
  // A coloured one is mixed a little toward the theme's strongest text, which
  // is light on a dark theme and dark on a light one, so a pale yellow role
  // still reads on white and a deep blue one on black.
  const style: CSSProperties =
    role.color !== 0
      ? { ...STATIC, color: `color-mix(in srgb, ${hexColor(role.color)} 72%, var(--text-strong))`, backgroundColor: rgbaColor(role.color, 0.16) }
      : STATIC;
  return (
    <span className="md-mention" style={style} data-role-mention={props.id}>
      {"@" + (role.name || t("render.unknownRole"))}
    </span>
  );
}

function clampColor(color: number): number {
  return Number.isFinite(color) ? Math.max(0, Math.min(0xffffff, Math.trunc(color))) : 0;
}

function hexColor(color: number): string {
  return "#" + clampColor(color).toString(16).padStart(6, "0");
}

function rgbaColor(color: number, alpha: number): string {
  const value = clampColor(color);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return "rgba(" + String(r) + ", " + String(g) + ", " + String(b) + ", " + String(alpha) + ")";
}

// ---------------------------------------------------------------------------
// timestamps
// ---------------------------------------------------------------------------

/** How soon a relative time ("in 5 minutes") can read differently: often while it is close, rarely once it is far. */
export function relativeTick(deltaMs: number): number {
  const away = Math.abs(deltaMs);
  return away < 60_000 ? 10_000 : away < 3_600_000 ? 30_000 : away < 86_400_000 ? 60_000 : 3_600_000;
}

/**
 * A `<t:…>` time. It is set apart from the words around it (dir="auto"
 * isolates it), so a date written in Arabic does not decide which way an
 * English sentence around it reads. The relative style ("in 2 hours") keeps
 * counting; rendered once, it went on saying "in 2 hours" all day.
 */
function Timestamp(props: { unix: number; style: StampStyle }): JSX.Element {
  const date = new Date(props.unix * 1000);
  const valid = !Number.isNaN(date.getTime());
  const relative = valid && props.style === "R";
  const [, tick] = useState(0);
  useEffect(() => {
    if (!relative) return;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(() => {
        tick((n) => n + 1);
        next();
      }, relativeTick(props.unix * 1000 - Date.now()));
    };
    next();
    return () => clearTimeout(timer);
  }, [relative, props.unix]);
  if (!valid) {
    return <time className="md-timestamp">{String(props.unix)}</time>;
  }
  return (
    <time className="md-timestamp" dir="auto" dateTime={date.toISOString()} title={formatStamp(date, "F")}>
      {formatStamp(date, props.style)}
    </time>
  );
}

// ---------------------------------------------------------------------------
// code blocks + the highlight.js html -> react bridge
// ---------------------------------------------------------------------------

export type HlNode = { type: "text"; text: string } | { type: "span"; className: string; children: HlNode[] };

const RE_SPAN_OPEN = /<span class="([^"]*)">/y;

/**
 * Minimal parser for the HTML highlight.js emits. It understands exactly
 * `<span class="...">`, `</span>` and text with the five escapes hljs writes;
 * anything else is kept as literal text, so no markup can ever be injected.
 */
export function parseHighlightHtml(html: string): HlNode[] {
  const root: HlNode[] = [];
  const stack: HlNode[][] = [root];
  let buf = "";
  const top = (): HlNode[] => stack[stack.length - 1] ?? root;
  const flush = (): void => {
    if (buf === "") return;
    top().push({ type: "text", text: unescapeHtml(buf) });
    buf = "";
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      buf += html.slice(i);
      break;
    }
    buf += html.slice(i, lt);
    RE_SPAN_OPEN.lastIndex = lt;
    const open = RE_SPAN_OPEN.exec(html);
    if (open) {
      flush();
      const node: HlNode = { type: "span", className: open[1] ?? "", children: [] };
      top().push(node);
      stack.push(node.children);
      i = RE_SPAN_OPEN.lastIndex;
      continue;
    }
    if (html.startsWith("</span>", lt) && stack.length > 1) {
      flush();
      stack.pop();
      i = lt + 7;
      continue;
    }
    buf += "<";
    i = lt + 1;
  }
  flush();
  return root;
}

function unescapeHtml(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(?:lt|gt|amp|quot|#x27|#39);/g, (entity) => {
    switch (entity) {
      case "&lt;":
        return "<";
      case "&gt;":
        return ">";
      case "&amp;":
        return "&";
      case "&quot;":
        return '"';
      default:
        return "'";
    }
  });
}

function renderHl(nodes: HlNode[]): ReactNode {
  return nodes.map((node, i) =>
    node.type === "text" ? (
      <Fragment key={i}>{node.text}</Fragment>
    ) : (
      <span key={i} className={node.className}>
        {renderHl(node.children)}
      </span>
    ),
  );
}

function CodeBlock(props: { lang: string | null; text: string }): JSX.Element {
  const { lang, text } = props;
  const [highlighted, setHighlighted] = useState<HlNode[] | null>(null);

  useEffect(() => {
    setHighlighted(null);
    if (lang === null) return;
    let alive = true;
    void import("highlight.js/lib/common")
      .then((mod) => {
        if (!alive) return;
        const hljs = mod.default;
        if (!hljs.getLanguage(lang)) return;
        setHighlighted(parseHighlightHtml(hljs.highlight(text, { language: lang }).value));
      })
      .catch(() => {
        /* highlighting is a nicety; plain text is a fine fallback */
      });
    return () => {
      alive = false;
    };
  }, [lang, text]);

  return (
    <div className="md-codeblock-wrap">
      <pre className="md-codeblock">
        <code className={lang === null ? "hljs" : "hljs language-" + lang}>
          {highlighted ? renderHl(highlighted) : text}
        </code>
      </pre>
      {/* just the code, without the fences and whatever else the message said */}
      <button type="button" className="md-code-copy" aria-label={t("render.copyCode")} title={t("render.copyCode")} onClick={() => void copyText(text, t("clipboard.codeCopied"))}>
        <Copy size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

/** The site a link goes to, as people know it: no scheme, no "www.". */
function linkHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}
