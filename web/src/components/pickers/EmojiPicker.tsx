import { Activity, Cat, Clock, Flag, Leaf, Lightbulb, Pizza, Plane, Smile, Users } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Emoji, Sticker, StickerPack } from "@/api/types";
import { emojiUrl, iconUrl } from "@/api/users";
import { initials } from "@/lib/avatarColor";
import { twemojiCandidates } from "@/lib/twemoji";
import { emojiToken, packEmoji, packImageUrl, searchCustomEmoji, searchPackEmoji, useExpressions } from "@/stores/expressions";
import { useServers } from "@/stores/servers";
import { useSettings } from "@/stores/settings";
import { TONES, emojiGroups, emojiLoaded, loadEmoji, searchEmoji, withTone, type EmojiEntry } from "./emojiIndex";
import s from "./Picker.module.css";

/**
 * Whether opening the picker should put the cursor in its search box. On a
 * touch screen that raises the keyboard, which covers the picker's sheet.
 */
export function focusSearchOnOpen(): boolean {
  return typeof window !== "undefined" && !window.matchMedia?.("(pointer: coarse)").matches;
}

const ICONS: Record<number, React.ReactNode> = {
  [-1]: <Clock size={20} />,
  0: <Smile size={20} />,
  1: <Users size={20} />,
  3: <Cat size={20} />,
  4: <Pizza size={20} />,
  5: <Plane size={20} />,
  6: <Activity size={20} />,
  7: <Lightbulb size={20} />,
  8: <Leaf size={20} />,
  9: <Flag size={20} />,
};

export interface EmojiPick {
  /** The text to insert: the emoji itself, or a <:name:id> token for custom emoji. */
  unicode: string;
  name: string;
  custom?: Emoji;
}

type Cell = { kind: "unicode"; e: EmojiEntry } | { kind: "custom"; e: Emoji } | { kind: "pack"; st: Sticker; pack: StickerPack };

interface Section {
  key: string;
  title: string | null;
  cells: Cell[];
}

type Row = { kind: "head"; key: string; title: string; top: number } | { kind: "cells"; key: string; cells: Cell[]; top: number };

const CELL = 40;
const HEAD = 32;
/** How far past the visible part rows are drawn, so a fast scroll does not show gaps. */
const OVERSCAN = 240;
const GRID_PADDING = 16;

/**
 * Who is under the pointer, kept outside React state: the inspector under the
 * grid follows it without the grid itself drawing again on every hover.
 */
function createHover() {
  let current: Cell | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (c: Cell | null) => {
      if (c === current) return;
      current = c;
      for (const l of listeners) l();
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
type HoverStore = ReturnType<typeof createHover>;

function unicodeSrc(text: string): string | undefined {
  return twemojiCandidates(text)[0];
}

const CellButton = memo(function CellButton({ cell, tone, hover, onPick }: { cell: Cell; tone: number; hover: HoverStore; onPick: (c: Cell) => void }) {
  const enter = () => hover.set(cell);
  if (cell.kind === "unicode") {
    const text = withTone(cell.e, tone);
    const src = unicodeSrc(text);
    return (
      <button className={s.cell} data-emoji={text} data-label={cell.e.label} title={`:${cell.e.shortcodes[0] ?? cell.e.label}:`} onMouseEnter={enter} onFocus={enter} onClick={() => onPick(cell)}>
        {src ? <img className={s.cellImg} src={src} alt={text} draggable={false} decoding="async" /> : <span>{text}</span>}
      </button>
    );
  }
  if (cell.kind === "custom") {
    const e = cell.e;
    return (
      <button className={s.cell} data-emoji={emojiToken(e)} data-label={e.name} data-custom={e.id} title={`:${e.name}:`} onMouseEnter={enter} onFocus={enter} onClick={() => onPick(cell)}>
        <img className={s.cellImg} src={emojiUrl(e.blob_id, e.animated, 48)} alt={`:${e.name}:`} draggable={false} decoding="async" />
      </button>
    );
  }
  const st = cell.st;
  return (
    <button className={s.cell} data-emoji={`:${st.name}:`} data-label={st.name} data-pack-emoji={st.id} title={`:${st.name}:`} onMouseEnter={enter} onFocus={enter} onClick={() => onPick(cell)}>
      <img className={s.cellImg} src={emojiUrl(st.blob_id, st.animated, 48)} alt={`:${st.name}:`} draggable={false} decoding="async" />
    </button>
  );
});

/** The strip under the grid naming whatever the pointer is on. */
function Inspector({ hover, tone }: { hover: HoverStore; tone: number }) {
  const cell = useSyncExternalStore(hover.subscribe, hover.get, hover.get);
  if (!cell) return <div className={s.inspector}><span style={{ color: "var(--text-muted)" }}>Pick an emoji</span></div>;
  if (cell.kind === "unicode") {
    const text = withTone(cell.e, tone);
    const src = unicodeSrc(text);
    return (
      <div className={s.inspector}>
        <span className={s.big}>{src ? <img src={src} alt="" draggable={false} /> : text}</span>
        <span className={s.name}>:{cell.e.shortcodes[0] ?? cell.e.label}:</span>
      </div>
    );
  }
  const name = cell.kind === "custom" ? cell.e.name : cell.st.name;
  const src = cell.kind === "custom" ? emojiUrl(cell.e.blob_id, cell.e.animated, 48) : emojiUrl(cell.st.blob_id, cell.st.animated, 48);
  return (
    <div className={s.inspector}>
      <img className={s.cellImg} src={src} alt="" />
      <span className={s.name}>:{name}:</span>
    </div>
  );
}

/** The first row that ends below y. */
function firstRowBelow(rows: Row[], y: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const r = rows[mid]!;
    if (r.top + (r.kind === "head" ? HEAD : CELL) <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function EmojiPicker({ onPick, serverId }: { onPick: (e: EmojiPick) => void; serverId?: string | null | undefined }) {
  const [ready, setReady] = useState(emojiLoaded());
  const [q, setQ] = useState("");
  const hover = useMemo(createHover, []);
  const customByServer = useExpressions((x) => x.emojis);
  const servers = useServers((x) => x.byId);
  const packs = useExpressions((x) => x.packs);
  const [toneOpen, setToneOpen] = useState(false);
  const tone = useSettings((st) => st.settings.skinTone);
  const recent = useSettings((st) => st.settings.recentEmoji);
  const patch = useSettings((st) => st.patch);
  const gridRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!emojiLoaded()) void loadEmoji().then(() => setReady(true));
    setTimeout(() => {
      if (focusSearchOnOpen()) inputRef.current?.focus();
    }, 0);
  }, []);

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const customGroups = useMemo(() => {
    const ids = Object.keys(customByServer).filter((id) => customByServer[id]!.length > 0);
    ids.sort((a, b) => (a === serverId ? -1 : b === serverId ? 1 : (servers[a]?.server.name ?? "").localeCompare(servers[b]?.server.name ?? "")));
    return ids.map((id) => ({ id, name: servers[id]?.server.name ?? "Server", icon: servers[id]?.server.icon_id ?? null, items: customByServer[id]! }));
  }, [customByServer, servers, serverId]);
  const emojiPacks = useMemo(() => packEmoji(packs), [packs]);

  const sections = useMemo<Section[]>(() => {
    const query = q.trim();
    if (query) {
      const cells: Cell[] = [
        ...searchCustomEmoji(customByServer, query, 40).map((e): Cell => ({ kind: "custom", e })),
        ...searchPackEmoji(packs, query, 40).map((r): Cell => ({ kind: "pack", st: r.sticker, pack: r.pack })),
        ...(ready ? searchEmoji(query, 100).map((e): Cell => ({ kind: "unicode", e })) : []),
      ];
      return [{ key: "results", title: null, cells }];
    }
    const out: Section[] = [];
    if (ready && recent.length) {
      const byUnicode = new Map<string, EmojiEntry>();
      for (const g of emojiGroups()) for (const e of g.items) byUnicode.set(e.unicode, e);
      const cells = recent.map((u) => byUnicode.get(u)).filter((e): e is EmojiEntry => !!e).map((e): Cell => ({ kind: "unicode", e }));
      if (cells.length) out.push({ key: "g:-1", title: "Frequently used", cells });
    }
    for (const g of customGroups) out.push({ key: `c:${g.id}`, title: g.name, cells: g.items.map((e): Cell => ({ kind: "custom", e })) });
    for (const { pack, items } of emojiPacks) out.push({ key: `c:${pack.id}`, title: pack.name, cells: items.map((st): Cell => ({ kind: "pack", st, pack })) });
    if (ready) for (const g of emojiGroups()) out.push({ key: `g:${g.id}`, title: g.name, cells: g.items.map((e): Cell => ({ kind: "unicode", e })) });
    return out;
  }, [q, ready, recent, customGroups, emojiPacks, customByServer, packs]);

  const cols = Math.max(1, Math.floor((box.width - GRID_PADDING) / CELL));
  const { rows, height } = useMemo(() => {
    const list: Row[] = [];
    let y = 0;
    for (const sec of sections) {
      if (sec.title) {
        list.push({ kind: "head", key: `h:${sec.key}`, title: sec.title, top: y });
        y += HEAD;
      }
      for (let i = 0; i < sec.cells.length; i += cols) {
        list.push({ kind: "cells", key: `${sec.key}:${i}`, cells: sec.cells.slice(i, i + cols), top: y });
        y += CELL;
      }
    }
    return { rows: list, height: y };
  }, [sections, cols]);

  // a new search starts at the top
  useEffect(() => {
    gridRef.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, [q]);

  const onScroll = useCallback(() => {
    const el = gridRef.current;
    if (el) setScrollTop(el.scrollTop);
  }, []);

  const pick = useCallback(
    (cell: Cell) => {
      if (cell.kind === "custom") {
        onPick({ unicode: emojiToken(cell.e), name: cell.e.name, custom: cell.e });
        return;
      }
      if (cell.kind === "pack") {
        onPick({ unicode: emojiToken({ name: cell.st.name, blob_id: cell.st.blob_id, animated: cell.st.animated }), name: cell.st.name });
        return;
      }
      const settings = useSettings.getState().settings;
      const next = [cell.e.unicode, ...settings.recentEmoji.filter((u) => u !== cell.e.unicode)].slice(0, 40);
      patch({ recentEmoji: next });
      onPick({ unicode: withTone(cell.e, settings.skinTone), name: cell.e.shortcodes[0] ?? cell.e.label });
    },
    [onPick, patch],
  );

  const jump = (key: string) => {
    const head = rows.find((r) => r.kind === "head" && r.key === `h:${key}`);
    if (head && gridRef.current) gridRef.current.scrollTop = head.top;
  };

  const first = firstRowBelow(rows, scrollTop - OVERSCAN);
  let last = first;
  while (last < rows.length && rows[last]!.top < scrollTop + box.height + OVERSCAN) last++;
  // the title of the part being scrolled through stays at the top
  let current: string | null = null;
  for (let i = Math.min(firstRowBelow(rows, scrollTop), rows.length - 1); i >= 0; i--) {
    const r = rows[i]!;
    if (r.kind === "head") {
      current = r.title;
      break;
    }
  }

  const noResults = q.trim() && sections[0]?.cells.length === 0;

  return (
    <>
      <div className={s.searchRow}>
        <input ref={inputRef} className={s.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find the perfect emoji" aria-label="Search emoji" />
        <button className={s.tone} aria-label="Skin tone" onClick={() => setToneOpen((v) => !v)}>
          <span className={s.toneDot} style={{ background: TONES[tone] ?? TONES[0] }} />
          {toneOpen ? (
            <span className={s.toneMenu}>
              {TONES.map((c, i) => (
                <button key={c} className={s.tone} aria-label={`Skin tone ${i}`} onClick={(ev) => { ev.stopPropagation(); patch({ skinTone: i }); setToneOpen(false); }}>
                  <span className={s.toneDot} style={{ background: c }} />
                </button>
              ))}
            </span>
          ) : null}
        </button>
      </div>
      <div className={s.body}>
        <div className={s.cats}>
          {sections.some((x) => x.key === "g:-1") ? <button className={s.cat} title="Frequently used" onClick={() => jump("g:-1")}>{ICONS[-1]}</button> : null}
          {emojiPacks.map(({ pack, items }) => (
            <button key={pack.id} className={s.cat} title={pack.name} onClick={() => jump(`c:${pack.id}`)}>
              {items[0] ? <img className={s.catImg} src={packImageUrl(pack, items[0])} alt="" /> : <span className={s.catInitial}>{initials(pack.name)}</span>}
            </button>
          ))}
          {customGroups.map((g) => (
            <button key={g.id} className={s.cat} title={g.name} onClick={() => jump(`c:${g.id}`)}>
              {iconUrl(g.icon, 24) ? <img className={s.catImg} src={iconUrl(g.icon, 24) ?? ""} alt="" /> : <span className={s.catInitial}>{initials(g.name)}</span>}
            </button>
          ))}
          {ready
            ? emojiGroups().map((g) => (
                <button key={g.id} className={s.cat} title={g.name} onClick={() => jump(`g:${g.id}`)}>{ICONS[g.id]}</button>
              ))
            : null}
        </div>
        <div className={s.grid} ref={gridRef} onScroll={onScroll} onMouseLeave={() => hover.set(null)} data-testid="emoji-grid">
          {!ready && !q.trim() ? <div className={s.empty}>Loading emoji…</div> : null}
          {noResults ? <div className={s.empty}>No emoji match.</div> : null}
          {current ? <div className={[s.section, s.stickyHead].join(" ")} aria-hidden="true">{current}</div> : null}
          <div className={s.virtual} style={{ height }}>
            {rows.slice(first, last).map((r) =>
              r.kind === "head" ? (
                <div key={r.key} className={[s.section, s.virtualRow].join(" ")} style={{ top: r.top, height: HEAD }}>
                  {r.title}
                </div>
              ) : (
                <div key={r.key} className={[s.rows, s.virtualRow].join(" ")} style={{ top: r.top, height: CELL }}>
                  {r.cells.map((c) => (
                    <CellButton key={c.kind === "unicode" ? c.e.hexcode : c.kind === "custom" ? `c${c.e.id}` : `p${c.st.id}`} cell={c} tone={tone} hover={hover} onPick={pick} />
                  ))}
                </div>
              ),
            )}
          </div>
        </div>
      </div>
      <Inspector hover={hover} tone={tone} />
    </>
  );
}
