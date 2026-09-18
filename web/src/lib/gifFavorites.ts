import { useSettings } from "@/stores/settings";
import { mediaKey } from "./mediaLinks";

/** How many favourite GIFs are kept; past this the oldest drop off. */
export const MAX_FAVORITE_GIFS = 500;

export interface FavoriteGif {
  url: string;
  w?: number;
  h?: number;
}

// Compared by what a link points at: each signing gives a GIF a new address
// (lib/mediaLinks), and comparing addresses said a favourite was not one.
export function isFavoriteGif(url: string): boolean {
  const key = mediaKey(url);
  return useSettings.getState().settings.favoriteGifs.some((f) => mediaKey(f.url) === key);
}

/** Makes a GIF a favourite or stops it being one. Returns whether it is one now. */
export function toggleFavoriteGif(gif: FavoriteGif): boolean {
  const { settings, patch } = useSettings.getState();
  const favs = settings.favoriteGifs;
  const key = mediaKey(gif.url);
  if (favs.some((f) => mediaKey(f.url) === key)) {
    patch({ favoriteGifs: favs.filter((f) => mediaKey(f.url) !== key) });
    return false;
  }
  const saved = { url: gif.url, ...(gif.w ? { w: gif.w } : {}), ...(gif.h ? { h: gif.h } : {}) };
  patch({ favoriteGifs: [saved, ...favs].slice(0, MAX_FAVORITE_GIFS) });
  return true;
}

export function removeFavoriteGifs(urls: ReadonlySet<string>): void {
  const { settings, patch } = useSettings.getState();
  patch({ favoriteGifs: settings.favoriteGifs.filter((f) => !urls.has(f.url)) });
}
