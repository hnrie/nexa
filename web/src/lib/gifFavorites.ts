import { useSettings } from "@/stores/settings";

/** How many favourite GIFs are kept; past this the oldest drop off. */
export const MAX_FAVORITE_GIFS = 500;

export interface FavoriteGif {
  url: string;
  w?: number;
  h?: number;
}

export function isFavoriteGif(url: string): boolean {
  return useSettings.getState().settings.favoriteGifs.some((f) => f.url === url);
}

/** Makes a GIF a favourite or stops it being one. Returns whether it is one now. */
export function toggleFavoriteGif(gif: FavoriteGif): boolean {
  const { settings, patch } = useSettings.getState();
  const favs = settings.favoriteGifs;
  if (favs.some((f) => f.url === gif.url)) {
    patch({ favoriteGifs: favs.filter((f) => f.url !== gif.url) });
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
