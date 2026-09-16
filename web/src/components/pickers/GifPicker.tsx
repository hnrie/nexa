import { Star, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { expressions as expressionsApi } from "@/api/expressions";
import type { GifResult } from "@/api/types";
import { removeFavoriteGifs, toggleFavoriteGif, type FavoriteGif } from "@/lib/gifFavorites";
import { useExpressions } from "@/stores/expressions";
import { useSettings } from "@/stores/settings";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { GifGrid, type GifTileData } from "./GifGrid";
import { focusSearchOnOpen } from "./EmojiPicker";
import s from "./Picker.module.css";

import { t as tr_ } from "@/i18n";
type Pick = (gif: { url: string; w?: number; h?: number }) => void;

interface ResultTile extends GifTileData {
  gif: GifResult;
}

interface FavoriteTile extends GifTileData {
  fav: FavoriteGif;
}

/** The GIFs tab: favourites always; trending and search when the server has a key. */
export function GifPicker({ onPick }: { onPick: Pick }) {
  const favs = useSettings((st) => st.settings.favoriteGifs);
  const enabled = useExpressions((x) => x.gifEnabled);
  const setEnabled = useExpressions((x) => x.setGifEnabled);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const [tab, setTab] = useState<"favorites" | "search">("favorites");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GifResult[]>([]);
  // the search the results are for, which lags what is typed while it waits
  const [shownFor, setShownFor] = useState<string | null>(null);
  const [next, setNext] = useState("");
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
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
    setFailed(false);
    try {
      const page = query.trim() ? await expressionsApi.gifSearch(query, pos) : await expressionsApi.gifTrending(pos);
      if (mine !== seq.current) return;
      if (pos) {
        // pages can overlap as trending shifts; a GIF shown twice would share a key
        setResults((cur) => {
          const have = new Set(cur.map((g) => g.id));
          return [...cur, ...page.results.filter((g) => !have.has(g.id))];
        });
      } else {
        setResults(page.results);
        setShownFor(query);
      }
      // an empty page ends it, even if the provider offers another
      setNext(page.results.length ? page.next : "");
    } catch {
      if (mine !== seq.current) return;
      if (pos) {
        setFailed(true);
      } else {
        setResults([]);
        setShownFor(query);
        setNext("");
      }
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

  const loadMore = useCallback(() => {
    if (loading || failed || !next || shownFor === null) return;
    void load(shownFor, next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, failed, next, shownFor]);

  const menu = (x: number, y: number, items: ContextMenuItem[]) => openContextMenu({ x, y, items });

  const resultTiles = useMemo<ResultTile[]>(() => results.map((g) => ({ key: g.id, src: g.preview, label: g.title || "GIF", w: g.w, h: g.h, gif: g })), [results]);
  const favoriteTiles = useMemo<FavoriteTile[]>(
    () => favs.map((f) => ({ key: f.url, src: f.url, label: "Favorite GIF", w: f.w, h: f.h, dead: dead.has(f.url), fav: f })),
    [favs, dead],
  );

  const sendResult = (g: GifResult) => onPick({ url: g.url, w: g.w, h: g.h });

  return (
    <div className={s.body} style={{ flexDirection: "column" }}>
      <div className={s.searchRow} style={{ flexDirection: "column", alignItems: "stretch" }}>
        {enabled ? (
          <input className={s.search} value={q} onChange={(e) => { setQ(e.target.value); setTab("search"); }} placeholder={tr_("pickers.gifPicker.searchKlipy")} aria-label={tr_("pickers.gifPicker.searchGifs")} autoFocus={focusSearchOnOpen()} />
        ) : null}
        <div className={s.gifTabs}>
          <button className={s.gifTab} data-on={tab === "favorites"} onClick={() => setTab("favorites")}>{tr_("pickers.gifPicker.favorites")}</button>
          {enabled ? <button className={s.gifTab} data-on={tab === "search"} onClick={() => setTab("search")}>{q.trim() ? "Results" : "Trending"}</button> : null}
        </div>
      </div>
      {tab === "favorites" ? (
        favs.length === 0 ? (
          <div className={s.empty}>No favorite GIFs yet. {enabled ? "Star a GIF in search to keep it here." : "Hover any GIF in chat and press the star to save it here."}</div>
        ) : (
          <GifGrid
            key="favorites"
            tiles={favoriteTiles}
            onPick={(t) => onPick(t.fav)}
            onDead={(t) => setDead((d) => (d.has(t.key) ? d : new Set(d).add(t.key)))}
            onMenu={(t, x, y) =>
              menu(x, y, [
                ...(t.dead ? [] : [{ id: "send", label: "Send GIF", onSelect: () => onPick(t.fav) }]),
                { id: "unfavorite", label: "Remove from Favorites", danger: true, onSelect: () => removeFavoriteGifs(new Set([t.key])) },
              ])
            }
            overlay={(t) => <button className={s.gifRemove} aria-label={tr_("pickers.gifPicker.removeFavorite")} onClick={() => removeFavoriteGifs(new Set([t.key]))}><X size={14} /></button>}
            footer={
              dead.size > 0 ? (
                <div className={s.gifNote}>
                  {dead.size} favourite{dead.size === 1 ? "" : "s"} no longer load.{" "}
                  <button className={s.gifTab} onClick={() => removeFavoriteGifs(dead)}>{tr_("pickers.gifPicker.removeThem")}</button>
                </div>
              ) : null
            }
          />
        )
      ) : (
        <GifGrid
          key={`search:${shownFor ?? ""}`}
          tiles={resultTiles}
          onPick={(t) => sendResult(t.gif)}
          onNearEnd={loadMore}
          onMenu={(t, x, y) => {
            const fav = favSet.has(t.gif.url);
            menu(x, y, [
              { id: "send", label: "Send GIF", onSelect: () => sendResult(t.gif) },
              { id: "favorite", label: fav ? "Remove from Favorites" : "Add to Favorites", onSelect: () => toggleFavoriteGif({ url: t.gif.url, w: t.gif.w, h: t.gif.h }) },
            ]);
          }}
          overlay={(t) => {
            const fav = favSet.has(t.gif.url);
            return (
              <button className={s.gifStar} data-on={fav} aria-label={fav ? "Remove favorite" : "Add favorite"} onClick={() => toggleFavoriteGif({ url: t.gif.url, w: t.gif.w, h: t.gif.h })}>
                <Star size={14} fill={fav ? "currentColor" : "none"} />
              </button>
            );
          }}
          footer={
            <>
              {loading ? <div className={s.gifNote}>{tr_("chat.pins.loading")}</div> : null}
              {!loading && results.length === 0 && shownFor !== null ? <div className={s.empty}>{shownFor.trim() ? "No GIFs match." : "Nothing trending right now."}</div> : null}
              {failed ? (
                <div className={s.gifNote}>
                  More GIFs could not be loaded.{" "}
                  <button className={s.gifTab} onClick={() => { setFailed(false); if (shownFor !== null && next) void load(shownFor, next); }}>{tr_("chat.messageList.tryAgain")}</button>
                </div>
              ) : null}
              {results.length > 0 ? <div className={s.gifNote}>{tr_("pickers.gifPicker.searchPoweredByKlipyThisServer")}</div> : null}
            </>
          }
        />
      )}
      {!enabled && enabled !== null ? <div className={s.gifNote}>{tr_("pickers.gifPicker.gifSearchIsOffOnThis")}</div> : null}
    </div>
  );
}
