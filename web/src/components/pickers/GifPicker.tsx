import { Star, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { expressions as expressionsApi } from "@/api/expressions";
import type { GifResult } from "@/api/types";
import { useExpressions } from "@/stores/expressions";
import { useSettings } from "@/stores/settings";
import s from "./Picker.module.css";

/** The GIFs tab: favourites always; trending and search when the server has a key. */
export function GifPicker({ onPick }: { onPick: (gif: { url: string; w?: number; h?: number }) => void }) {
  const favs = useSettings((st) => st.settings.favoriteGifs);
  const patch = useSettings((st) => st.patch);
  const enabled = useExpressions((x) => x.gifEnabled);
  const setEnabled = useExpressions((x) => x.setGifEnabled);
  const [tab, setTab] = useState<"favorites" | "search">("favorites");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GifResult[]>([]);
  const [next, setNext] = useState("");
  const [loading, setLoading] = useState(false);
  // Favourites saved from a provider that is no longer used stop loading;
  // rather than a row of broken boxes, say so and offer the cross.
  const [dead, setDead] = useState<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const favSet = useMemo(() => new Set(favs.map((f) => f.url)), [favs]);

  useEffect(() => {
    if (enabled !== null) return;
    expressionsApi
      .gifStatus()
      .then((r) => setEnabled(r.enabled))
      .catch(() => setEnabled(false));
  }, [enabled, setEnabled]);

  useEffect(() => {
    if (enabled && favs.length === 0) setTab("search");
  }, [enabled, favs.length]);

  const load = async (query: string, pos?: string) => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const page = query.trim() ? await expressionsApi.gifSearch(query, pos) : await expressionsApi.gifTrending(pos);
      if (mine !== seq.current) return;
      setResults((cur) => (pos ? [...cur, ...page.results] : page.results));
      setNext(page.next);
    } catch {
      if (mine === seq.current) setResults([]);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!enabled || tab !== "search") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(q), q ? 300 : 0);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, enabled, tab]);

  const toggleFav = (g: { url: string; w?: number; h?: number }) => {
    if (favSet.has(g.url)) patch({ favoriteGifs: favs.filter((f) => f.url !== g.url) });
    else patch({ favoriteGifs: [{ url: g.url, ...(g.w ? { w: g.w } : {}), ...(g.h ? { h: g.h } : {}) }, ...favs].slice(0, 200) });
  };

  return (
    <div className={s.body} style={{ flexDirection: "column" }}>
      <div className={s.searchRow} style={{ flexDirection: "column", alignItems: "stretch" }}>
        {enabled ? (
          <input className={s.search} value={q} onChange={(e) => { setQ(e.target.value); setTab("search"); }} placeholder="Search GIFs" aria-label="Search GIFs" autoFocus />
        ) : null}
        <div className={s.gifTabs}>
          <button className={s.gifTab} data-on={tab === "favorites"} onClick={() => setTab("favorites")}>Favorites</button>
          {enabled ? <button className={s.gifTab} data-on={tab === "search"} onClick={() => setTab("search")}>{q.trim() ? "Results" : "Trending"}</button> : null}
        </div>
      </div>
      {tab === "favorites" && dead.size > 0 ? (
        <div className={s.gifNote}>
          {dead.size} favourite{dead.size === 1 ? "" : "s"} no longer load.{" "}
          <button className={s.gifTab} onClick={() => patch({ favoriteGifs: favs.filter((f) => !dead.has(f.url)) })}>Remove them</button>
        </div>
      ) : null}
      {tab === "favorites" ? (
        favs.length === 0 ? (
          <div className={s.empty}>No favorite GIFs yet. {enabled ? "Star a GIF in search to keep it here." : "Hover any GIF in chat and press the star to save it here."}</div>
        ) : (
          <div className={s.gifGrid}>
            {favs.map((f) => (
              <div key={f.url} className={s.gifCell} data-dead={dead.has(f.url)}>
                {dead.has(f.url) ? (
                  <span className={s.gifDead}>This one is gone</span>
                ) : (
                  <img src={f.url} alt="" loading="lazy" referrerPolicy="no-referrer" onClick={() => onPick(f)} onError={() => setDead((d) => new Set(d).add(f.url))} />
                )}
                <button className={s.gifRemove} aria-label="Remove favorite" onClick={() => patch({ favoriteGifs: favs.filter((x) => x.url !== f.url) })}><X size={14} /></button>
              </div>
            ))}
          </div>
        )
      ) : (
        <>
          {results.length === 0 && !loading ? <div className={s.empty}>{q ? "No GIFs match." : "Nothing trending right now."}</div> : null}
          <div className={s.gifGrid}>
            {results.map((g) => (
              <div key={g.id} className={s.gifCell}>
                <img src={g.preview} alt={g.title} loading="lazy" referrerPolicy="no-referrer" style={g.w && g.h ? { aspectRatio: `${g.w} / ${g.h}` } : undefined} onClick={() => onPick({ url: g.url, w: g.w, h: g.h })} />
                <button className={s.gifStar} data-on={favSet.has(g.url)} aria-label={favSet.has(g.url) ? "Remove favorite" : "Add favorite"} onClick={() => toggleFav({ url: g.url, w: g.w, h: g.h })}><Star size={14} /></button>
              </div>
            ))}
            {next && !loading ? <button className={s.gifTab} style={{ width: "100%", marginTop: 4 }} onClick={() => void load(q, next)}>Load more</button> : null}
            {loading ? <div className={s.gifNote}>Loading…</div> : null}
          </div>
          <div className={s.gifNote}>Search powered by Klipy. This server fetches every picture for you, so nobody on the other end learns who is looking.</div>
        </>
      )}
      {!enabled && enabled !== null ? <div className={s.gifNote}>GIF search is off on this server: set KLIPY_API_KEY to enable it.</div> : null}
    </div>
  );
}
