import { Activity, Cat, Clock, Flag, Leaf, Lightbulb, Pizza, Plane, Smile, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Emoji, Sticker } from "@/api/types";
import { emojiUrl, iconUrl } from "@/api/users";
import { initials } from "@/lib/avatarColor";
import { emojiToken, packEmoji, packImageUrl, searchCustomEmoji, searchPackEmoji, useExpressions } from "@/stores/expressions";
import { useServers } from "@/stores/servers";
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
  /** The text to insert: the emoji itself, or a <:name:id> token for custom emoji. */
  unicode: string;
  name: string;
  custom?: Emoji;
}

type Hover = { kind: "unicode"; e: EmojiEntry } | { kind: "custom"; e: Emoji };

export function EmojiPicker({ onPick, serverId }: { onPick: (e: EmojiPick) => void; serverId?: string | null | undefined }) {
  const [ready, setReady] = useState(emojiLoaded());
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<Hover | null>(null);
  const customByServer = useExpressions((x) => x.emojis);
  const servers = useServers((x) => x.byId);
  const customGroups = useMemo(() => {
    const ids = Object.keys(customByServer).filter((id) => customByServer[id]!.length > 0);
    ids.sort((a, b) => (a === serverId ? -1 : b === serverId ? 1 : (servers[a]?.server.name ?? "").localeCompare(servers[b]?.server.name ?? "")));
    return ids.map((id) => ({ id, name: servers[id]?.server.name ?? "Server", icon: servers[id]?.server.icon_id ?? null, items: customByServer[id]! }));
  }, [customByServer, servers, serverId]);
  const customResults = useMemo(() => (q.trim() ? searchCustomEmoji(customByServer, q, 40) : []), [customByServer, q]);
  const packs = useExpressions((x) => x.packs);
  const emojiPacks = useMemo(() => packEmoji(packs), [packs]);
  const packResults = useMemo(() => (q.trim() ? searchPackEmoji(packs, q, 40) : []), [packs, q]);
  const pickPack = (st: { id: string; name: string; blob_id: string; animated: boolean }) =>
    onPick({ unicode: emojiToken({ name: st.name, blob_id: st.blob_id, animated: st.animated }), name: st.name });
  const packCell = (st: Sticker) => (
    <button key={st.id} className={s.cell} data-emoji={`:${st.name}:`} data-label={st.name} data-pack-emoji={st.id} title={`:${st.name}:`} onClick={() => pickPack(st)}>
      <img className={s.cellImg} src={emojiUrl(st.blob_id, st.animated)} alt={`:${st.name}:`} loading="lazy" draggable={false} />
    </button>
  );
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
    <button key={e.hexcode} className={s.cell} data-emoji={withTone(e, tone)} data-label={e.label} title={`:${e.shortcodes[0] ?? e.label}:`} onMouseEnter={() => setHover({ kind: "unicode", e })} onFocus={() => setHover({ kind: "unicode", e })} onClick={() => pick(e)}>
      {withTone(e, tone)}
    </button>
  );
  const customCell = (e: Emoji) => (
    <button key={e.id} className={s.cell} data-emoji={emojiToken(e)} data-label={e.name} data-custom={e.id} title={`:${e.name}:`} onMouseEnter={() => setHover({ kind: "custom", e })} onFocus={() => setHover({ kind: "custom", e })} onClick={() => onPick({ unicode: emojiToken(e), name: e.name, custom: e })}>
      <img className={s.cellImg} src={emojiUrl(e.blob_id, e.animated)} alt={`:${e.name}:`} loading="lazy" draggable={false} />
    </button>
  );
  const jumpCustom = (id: string) => gridRef.current?.querySelector<HTMLElement>(`[data-custom-group="${id}"]`)?.scrollIntoView({ block: "start" });

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
          {emojiPacks.map(({ pack, items }) => (
            <button key={pack.id} className={s.cat} title={pack.name} onClick={() => jumpCustom(pack.id)}>
              {items[0] ? <img className={s.catImg} src={packImageUrl(pack, items[0])} alt="" /> : <span className={s.catInitial}>{initials(pack.name)}</span>}
            </button>
          ))}
          {customGroups.map((g) => (
            <button key={g.id} className={s.cat} title={g.name} onClick={() => jumpCustom(g.id)}>
              {iconUrl(g.icon) ? <img className={s.catImg} src={iconUrl(g.icon) ?? ""} alt="" /> : <span className={s.catInitial}>{initials(g.name)}</span>}
            </button>
          ))}
          {groups.map((g) => (
            <button key={g.id} className={s.cat} title={g.name} onClick={() => jump(g.id)}>{ICONS[g.id]}</button>
          ))}
        </div>
        <div className={s.grid} ref={gridRef}>
          {!ready ? <div className={s.empty}>Loading emoji…</div> : null}
          {results ? (
            results.length === 0 && customResults.length === 0 && packResults.length === 0 ? (
              <div className={s.empty}>No emoji match.</div>
            ) : (
              <div className={s.rows}>{[...customResults.map(customCell), ...packResults.map((r) => packCell(r.sticker)), ...results.map(cell)]}</div>
            )
          ) : (
            <>
              {recentEntries.length > 0 ? (
                <div data-group={-1}>
                  <div className={s.section}>Frequently used</div>
                  <div className={s.rows}>{recentEntries.map(cell)}</div>
                </div>
              ) : null}
              {customGroups.map((g) => (
                <div key={g.id} data-custom-group={g.id}>
                  <div className={s.section}>{g.name}</div>
                  <div className={s.rows}>{g.items.map(customCell)}</div>
                </div>
              ))}
              {emojiPacks.map(({ pack, items }) => (
                <div key={pack.id} data-custom-group={pack.id}>
                  <div className={s.section}>{pack.name}</div>
                  <div className={s.rows}>{items.map(packCell)}</div>
                </div>
              ))}
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
        {hover?.kind === "custom" ? (
          <>
            <img className={s.cellImg} src={emojiUrl(hover.e.blob_id, hover.e.animated)} alt="" />
            <span className={s.name}>:{hover.e.name}:</span>
          </>
        ) : hover ? (
          <>
            <span className={s.big}>{withTone(hover.e, tone)}</span>
            <span className={s.name}>:{hover.e.shortcodes[0] ?? hover.e.label}:</span>
          </>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>Pick an emoji</span>
        )}
      </div>
    </>
  );
}
