import { Activity, Cat, Clock, Flag, Leaf, Lightbulb, Pizza, Plane, Smile, Users } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Emoji, Sticker, StickerPack } from "@/api/types";
import { emojiUrl, iconUrl } from "@/api/users";
import { initials } from "@/lib/avatarColor";
import { twemojiCandidates } from "@/lib/twemoji";
import { emojiToken, packEmoji, packImageUrl, searchCustomEmoji, searchPackEmoji, useExpressions } from "@/stores/expressions";
import { useServers } from "@/stores/servers";
import { useSettings } from "@/stores/settings";
import { Twemoji } from "@/components/common/Twemoji";
import { toneNames, emojiGroups, emojiLoaded, loadEmoji, searchEmoji, spriteStyle, withTone, type EmojiEntry } from "./emojiIndex";
import { SearchBox } from "@/components/common/SearchBox";
import s from "./Picker.module.css";

import { t } from "@/i18n";
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
/** How big an emoji is drawn inside its cell. */
const PICTURE = 32;
/** How far past the visible part rows are drawn, so a fast scroll does not show gaps. */
const OVERSCAN = 600;
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

const CellButton = memo(function CellButton({ cell, tone, hover, onPick, pos }: { cell: Cell; tone: number; hover: HoverStore; onPick: (c: Cell) => void; pos: string }) {
  const enter = () => hover.set(cell);
  if (cell.kind === "unicode") {
    const text = withTone(cell.e, tone);
    // a piece of a sprite sheet: an SVG picture per cell stalled fast scrolling (see tools/twemoji_sprites.py)
    const sprite = spriteStyle(text, PICTURE);
    const src = sprite ? undefined : unicodeSrc(text);
    return (
      <button className={s.cell} data-pos={pos} tabIndex={-1} data-emoji={text} data-label={cell.e.label} aria-label={`:${cell.e.shortcodes[0] ?? cell.e.label}:`} title={`:${cell.e.shortcodes[0] ?? cell.e.label}:`} onMouseEnter={enter} onFocus={enter} onClick={() => onPick(cell)}>
        {sprite ? <span className={s.sprite} style={sprite} role="img" aria-label={text} /> : src ? <img className={s.cellImg} src={src} alt={text} draggable={false} decoding="async" /> : <span>{text}</span>}
      </button>
    );
  }
  if (cell.kind === "custom") {
    const e = cell.e;
    return (
      <button className={s.cell} data-pos={pos} tabIndex={-1} data-emoji={emojiToken(e)} data-label={e.name} data-custom={e.id} aria-label={`:${e.name}:`} title={`:${e.name}:`} onMouseEnter={enter} onFocus={enter} onClick={() => onPick(cell)}>
        <img className={s.cellImg} src={emojiUrl(e.blob_id, e.animated, 48)} alt={`:${e.name}:`} draggable={false} decoding="async" />
      </button>
    );
  }
  const st = cell.st;
  return (
    <button className={s.cell} data-pos={pos} tabIndex={-1} data-emoji={`:${st.name}:`} data-label={st.name} data-pack-emoji={st.id} aria-label={`:${st.name}:`} title={`:${st.name}:`} onMouseEnter={enter} onFocus={enter} onClick={() => onPick(cell)}>
      <img className={s.cellImg} src={emojiUrl(st.blob_id, st.animated, 48)} alt={`:${st.name}:`} draggable={false} decoding="async" />
    </button>
  );
});

/** The strip under the grid naming whatever the pointer is on. */
function Inspector({ hover, tone }: { hover: HoverStore; tone: number }) {
  const cell = useSyncExternalStore(hover.subscribe, hover.get, hover.get);
  if (!cell) return <div className={s.inspector}><span style={{ color: "var(--text-muted)" }}>{t("pickers.emojiPicker.pickAnEmoji")}</span></div>;
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

/** The raised hand in each skin tone, as the tone button draws them. */
const HANDS = ["\u270b", "\u270b\u{1f3fb}", "\u270b\u{1f3fc}", "\u270b\u{1f3fd}", "\u270b\u{1f3fe}", "\u270b\u{1f3ff}"];

/**
 * The skin tone button beside the search box: a hand in the chosen tone that
 * opens a column of hands in every tone over the grid, as Discord's does.
 */
function ToneSelector({ tone, onChange }: { tone: number; onChange: (tone: number) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("[aria-checked=true]")?.focus();
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    // Escape closes this before it reaches the picker's own handler, which would close the whole picker
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      wrap.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const move = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + step + items.length) % items.length]?.focus();
  };

  return (
    <div className={s.toneWrap} ref={wrap}>
      <button className={s.tone} aria-label={t("pickers.emojiPicker.skinTone")} title={t("pickers.emojiPicker.skinTone")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="skin-tone">
        <Twemoji text={HANDS[tone] ?? HANDS[0]!} className={s.toneHand} />
      </button>
      {open ? (
        <div className={s.toneMenu} role="menu" aria-label={t("pickers.emojiPicker.skinTone")} ref={menu} onKeyDown={move}>
          {HANDS.map((hand, i) => (
            <button
              key={hand}
              className={s.toneOption}
              role="menuitemradio"
              aria-checked={i === tone}
              aria-label={t("pickers.emojiPicker.skinToneNamed", { tone: toneNames()[i]! })}
              title={t("pickers.emojiPicker.skinToneNamed", { tone: toneNames()[i]! })}
              data-testid={`skin-tone-${i}`}
              onClick={() => {
                onChange(i);
                setOpen(false);
                // The Escape path hands focus back to the trigger; this one
                // unmounted the focused option and left focus on <body>.
                wrap.current?.querySelector<HTMLButtonElement>("button")?.focus();
              }}
            >
              <Twemoji text={hand} className={s.toneHand} />
            </button>
          ))}
        </div>
      ) : null}
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
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [q, setQ] = useState("");
  const hover = useMemo(createHover, []);
  const customByServer = useExpressions((x) => x.emojis);
  const servers = useServers((x) => x.byId);
  const packs = useExpressions((x) => x.packs);
  const tone = useSettings((st) => st.settings.skinTone);
  const recent = useSettings((st) => st.settings.recentEmoji);
  const patch = useSettings((st) => st.patch);
  const gridRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    setTimeout(() => {
      if (focusSearchOnOpen()) inputRef.current?.focus();
    }, 0);
  }, []);

  useEffect(() => {
    if (emojiLoaded()) return;
    let alive = true;
    setLoadFailed(false);
    void loadEmoji().then(
      () => alive && setReady(true),
      () => alive && setLoadFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

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
      if (cells.length) out.push({ key: "g:-1", title: t("pickers.emojiPicker.frequentlyUsed"), cells });
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

  // one update per frame however many scroll events arrive in it
  const scrollFrame = useRef(0);
  const onScroll = useCallback(() => {
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0;
      const el = gridRef.current;
      if (el) setScrollTop(el.scrollTop);
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);

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

  /**
   * Arrow-key navigation over a virtualised grid.
   *
   * Every cell was a tab stop, so the first screenful cost dozens of presses —
   * and rows outside the overscan window are not in the DOM at all, so Tab
   * could never reach anything below them: focus simply left the picker. Now
   * the grid is one tab stop and the arrows move within it, scrolling the row
   * into the render window before asking for it.
   */
  const focusCell = useCallback(
    (ri: number, ci: number) => {
      const row = rows[ri];
      if (!row || row.kind !== "cells") return;
      const col = Math.max(0, Math.min(ci, row.cells.length - 1));
      const el = gridRef.current;
      if (el) {
        if (row.top < el.scrollTop) el.scrollTop = row.top;
        else if (row.top + CELL > el.scrollTop + el.clientHeight) el.scrollTop = row.top + CELL - el.clientHeight;
        setScrollTop(el.scrollTop);
      }
      // the row may only be drawn after that scroll has been rendered
      requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-pos="${ri}:${col}"]`)?.focus({ preventScroll: true }));
    },
    [rows],
  );

  const stepRow = (from: number, dir: 1 | -1): number => {
    for (let i = from + dir; i >= 0 && i < rows.length; i += dir) if (rows[i]!.kind === "cells") return i;
    return -1;
  };

  const onGridKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const KEYS = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"];
    if (!KEYS.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const at = (document.activeElement as HTMLElement | null)?.dataset["pos"];
    e.preventDefault();
    if (!at) {
      focusCell(stepRow(-1, 1), 0);
      return;
    }
    const [rs, cs] = at.split(":");
    const ri = Number(rs);
    const ci = Number(cs);
    const row = rows[ri];
    const width = row && row.kind === "cells" ? row.cells.length : 1;
    const page = Math.max(1, Math.floor((box.height || CELL * 6) / CELL) - 1);
    if (e.key === "ArrowRight") {
      if (ci + 1 < width) focusCell(ri, ci + 1);
      else focusCell(stepRow(ri, 1), 0);
    } else if (e.key === "ArrowLeft") {
      if (ci > 0) focusCell(ri, ci - 1);
      else {
        const prev = stepRow(ri, -1);
        const r = rows[prev];
        focusCell(prev, r && r.kind === "cells" ? r.cells.length - 1 : 0);
      }
    } else if (e.key === "ArrowDown") focusCell(stepRow(ri, 1), ci);
    else if (e.key === "ArrowUp") focusCell(stepRow(ri, -1), ci);
    else if (e.key === "Home") focusCell(stepRow(-1, 1), 0);
    else if (e.key === "End") focusCell(stepRow(rows.length, -1), cols - 1);
    else if (e.key === "PageDown") {
      let r = ri;
      for (let i = 0; i < page; i++) {
        const next = stepRow(r, 1);
        if (next < 0) break;
        r = next;
      }
      focusCell(r, ci);
    } else if (e.key === "PageUp") {
      let r = ri;
      for (let i = 0; i < page; i++) {
        const prev = stepRow(r, -1);
        if (prev < 0) break;
        r = prev;
      }
      focusCell(r, ci);
    }
  };

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

  // Unicode emoji are left out of a search until the index has arrived, so
  // until it has, "No emoji match" is a claim about a set that was not looked
  // in. While it is still coming the grid says so instead.
  const noResults = ready && q.trim() && sections[0]?.cells.length === 0;

  return (
    <>
      <div className={s.searchRow}>
        <SearchBox ref={inputRef} className={s.searchBox} value={q} onChange={setQ} placeholder={t("pickers.emojiPicker.findThePerfectEmoji")} aria-label={t("pickers.emojiPicker.searchEmoji")} />
        <ToneSelector tone={tone} onChange={(i) => patch({ skinTone: i })} />
      </div>
      <div className={s.body}>
        <div className={s.cats}>
          {sections.some((x) => x.key === "g:-1") ? <button className={s.cat} title={t("pickers.emojiPicker.frequentlyUsed")} aria-label={t("pickers.emojiPicker.frequentlyUsed")} aria-current={current === t("pickers.emojiPicker.frequentlyUsed") ? "true" : undefined} onClick={() => jump("g:-1")}>{ICONS[-1]}</button> : null}
          {emojiPacks.map(({ pack, items }) => (
            <button key={pack.id} className={s.cat} title={pack.name} aria-label={pack.name} aria-current={current === pack.name ? "true" : undefined} onClick={() => jump(`c:${pack.id}`)}>
              {items[0] ? <img className={s.catImg} src={packImageUrl(pack, items[0])} alt="" /> : <span className={s.catInitial}>{initials(pack.name)}</span>}
            </button>
          ))}
          {customGroups.map((g) => (
            <button key={g.id} className={s.cat} title={g.name} aria-label={g.name} aria-current={current === g.name ? "true" : undefined} onClick={() => jump(`c:${g.id}`)}>
              {iconUrl(g.icon, 24) ? <img className={s.catImg} src={iconUrl(g.icon, 24) ?? ""} alt="" /> : <span className={s.catInitial}>{initials(g.name)}</span>}
            </button>
          ))}
          {ready
            ? emojiGroups().map((g) => (
                <button key={g.id} className={s.cat} title={g.name} aria-label={g.name} aria-current={current === g.name ? "true" : undefined} onClick={() => jump(`g:${g.id}`)}>{ICONS[g.id]}</button>
              ))
            : null}
        </div>
        <div className={s.grid} ref={gridRef} onScroll={onScroll} onKeyDown={onGridKey} onMouseLeave={() => hover.set(null)} tabIndex={0} role="group" aria-label={t("pickers.emojiPicker.emojiGrid")} data-testid="emoji-grid">
          {!ready ? (
            <div className={s.empty}>
              {loadFailed ? (
                <>
                  {t("pickers.emojiPicker.emojiCouldNotBeLoaded")}{" "}
                  <button className={s.sectionLink} onClick={() => setAttempt((n) => n + 1)} data-testid="emoji-retry">{t("chat.messageList.tryAgain")}</button>
                </>
              ) : (
                t("pickers.emojiPicker.loadingEmoji")
              )}
            </div>
          ) : null}
          {noResults ? <div className={s.empty}>{t("pickers.emojiPicker.noEmojiMatch")}</div> : null}
          {current ? <div className={[s.section, s.stickyHead].join(" ")} aria-hidden="true">{current}</div> : null}
          <div className={s.virtual} style={{ height }}>
            {rows.slice(first, last).map((r) =>
              r.kind === "head" ? (
                <div key={r.key} className={[s.section, s.virtualRow].join(" ")} style={{ top: r.top, height: HEAD }}>
                  {r.title}
                </div>
              ) : (
                <div key={r.key} className={[s.rows, s.virtualRow].join(" ")} style={{ top: r.top, height: CELL }}>
                  {r.cells.map((c, ci) => (
                    <CellButton key={c.kind === "unicode" ? c.e.hexcode : c.kind === "custom" ? `c${c.e.id}` : `p${c.st.id}`} cell={c} tone={tone} hover={hover} onPick={pick} pos={`${first + rows.slice(first, last).indexOf(r)}:${ci}`} />
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
