import { Activity, Cat, Clock, Flag, Leaf, Lightbulb, Pizza, Plane, Smile, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "@/stores/settings";
import { GROUPS, TONES, allEmoji, emojiLoaded, loadEmoji, searchEmoji, withTone, type EmojiEntry } from "./emojiIndex";
import s from "./Picker.module.css";

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
  unicode: string;
  name: string;
}

export function EmojiPicker({ onPick }: { onPick: (e: EmojiPick) => void }) {
  const [ready, setReady] = useState(emojiLoaded());
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<EmojiEntry | null>(null);
  const [toneOpen, setToneOpen] = useState(false);
  const tone = useSettings((st) => st.settings.skinTone);
  const recent = useSettings((st) => st.settings.recentEmoji);
  const patch = useSettings((st) => st.patch);
  const gridRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadEmoji().then(() => setReady(true));
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const results = useMemo(() => (ready && q.trim() ? searchEmoji(q, 100) : null), [q, ready]);
  const groups = useMemo(() => {
    if (!ready) return [];
    const list = allEmoji();
    return GROUPS.map((g) => ({ ...g, items: list.filter((e) => e.group === g.id) })).filter((g) => g.items.length > 0);
  }, [ready]);
  const recentEntries = useMemo(() => {
    if (!ready) return [];
    const map = new Map(allEmoji().map((e) => [e.unicode, e]));
    return recent.map((u) => map.get(u)).filter((e): e is EmojiEntry => !!e);
  }, [recent, ready]);

  const pick = (e: EmojiEntry) => {
    const unicode = withTone(e, tone);
    const next = [e.unicode, ...recent.filter((u) => u !== e.unicode)].slice(0, 40);
    patch({ recentEmoji: next });
    onPick({ unicode, name: e.shortcodes[0] ?? e.label });
  };

  const jump = (id: number) => {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-group="${id}"]`);
    el?.scrollIntoView({ block: "start" });
  };

  const cell = (e: EmojiEntry) => (
    <button key={e.hexcode} className={s.cell} data-emoji={withTone(e, tone)} data-label={e.label} title={`:${e.shortcodes[0] ?? e.label}:`} onMouseEnter={() => setHover(e)} onFocus={() => setHover(e)} onClick={() => pick(e)}>
      {withTone(e, tone)}
    </button>
  );

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
          {recentEntries.length > 0 ? <button className={s.cat} title="Frequently used" onClick={() => jump(-1)}>{ICONS[-1]}</button> : null}
          {groups.map((g) => (
            <button key={g.id} className={s.cat} title={g.name} onClick={() => jump(g.id)}>{ICONS[g.id]}</button>
          ))}
        </div>
        <div className={s.grid} ref={gridRef}>
          {!ready ? <div className={s.empty}>Loading emoji…</div> : null}
          {results ? (
            results.length === 0 ? <div className={s.empty}>No emoji match.</div> : <div className={s.rows}>{results.map(cell)}</div>
          ) : (
            <>
              {recentEntries.length > 0 ? (
                <div data-group={-1}>
                  <div className={s.section}>Frequently used</div>
                  <div className={s.rows}>{recentEntries.map(cell)}</div>
                </div>
              ) : null}
              {groups.map((g) => (
                <div key={g.id} data-group={g.id}>
                  <div className={s.section}>{g.name}</div>
                  <div className={s.rows}>{g.items.map(cell)}</div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      <div className={s.inspector}>
        {hover ? (
          <>
            <span className={s.big}>{withTone(hover, tone)}</span>
            <span className={s.name}>:{hover.shortcodes[0] ?? hover.label}:</span>
          </>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>Pick an emoji</span>
        )}
      </div>
    </>
  );
}
