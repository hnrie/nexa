/**
 * Song previews: thirty seconds of a song on someone's Favourite Songs,
 * played through this server (handleMusicPreview in internal/api/widgets.go)
 * so the listener never contacts Deezer. One plays at a time anywhere in the
 * app, at the volume voice notes and videos play at, and the list that
 * started one stops it as it goes away.
 */
import { create } from "zustand";
import { api } from "@/api/client";
import { mediaPrefs } from "@/components/chat/mediaPrefs";
import { t } from "@/i18n";
import { musicArtUrl, type WidgetMusic } from "@/lib/widgets";
import { useUI } from "@/stores/ui";

export interface PreviewState {
  /** The song playing, or about to. */
  id: string | null;
  /** Which list started it. */
  owner: string | null;
  state: "loading" | "playing" | "paused";
  /** How far through it is, from 0 to 1. */
  progress: number;
}

const IDLE: PreviewState = { id: null, owner: null, state: "paused", progress: 0 };

export const usePreview = create<PreviewState>(() => IDLE);

let player: HTMLAudioElement | null = null;

const idle = () => usePreview.setState(IDLE);

function audio(): HTMLAudioElement {
  if (player) return player;
  const el = new Audio();
  el.preload = "auto";
  const ours = () => usePreview.getState().id !== null;
  el.addEventListener("waiting", () => ours() && usePreview.setState({ state: "loading" }));
  el.addEventListener("playing", () => ours() && usePreview.setState({ state: "playing" }));
  // the pause of the song before is told after the next has been asked to play: that one is not paused
  el.addEventListener("pause", () => ours() && el.paused && !el.ended && usePreview.setState({ state: "paused" }));
  el.addEventListener("timeupdate", () => {
    if (ours() && el.duration > 0) usePreview.setState({ progress: Math.min(1, el.currentTime / el.duration) });
  });
  el.addEventListener("ended", idle);
  el.addEventListener("error", () => {
    if (!ours() || !el.error) return;
    // a source with nothing to play is a song Deezer has no preview of
    useUI.getState().toast(el.error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? t("widgets.music.noPreview") : t("widgets.music.previewFailed"), "error");
    idle();
  });
  player = el;
  return el;
}

function play(el: HTMLAudioElement) {
  void el.play().catch((err: unknown) => {
    // a play() cut short by a pause, or by the next song, rejects too; the error event speaks for the rest
    if (err instanceof DOMException && err.name === "AbortError") return;
    if (err instanceof DOMException && err.name === "NotAllowedError") idle();
  });
}

/** Plays a song's preview, or pauses it (and plays it on) when it is the one playing. */
export function togglePreview(song: WidgetMusic, owner: string): void {
  if (!song.id) return;
  const el = audio();
  if (usePreview.getState().id === song.id) {
    if (el.paused) play(el);
    else el.pause();
    return;
  }
  const prefs = mediaPrefs();
  el.volume = prefs.volume;
  el.muted = prefs.muted;
  el.src = `${api.baseUrl}/media/music/preview/${song.id}`;
  usePreview.setState({ id: song.id, owner, state: "loading", progress: 0 });
  play(el);
  // what a phone's lock screen and a headset's buttons show
  if (typeof navigator !== "undefined" && "mediaSession" in navigator && typeof MediaMetadata !== "undefined") {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.name,
      artist: song.by ?? "",
      artwork: song.art ? [{ src: musicArtUrl("cover", song.art, "l"), sizes: "400x400", type: "image/jpeg" }] : [],
    });
  }
}

/** Stops the preview playing, when the list asking is the one that started it. */
export function stopPreview(owner: string): void {
  if (usePreview.getState().owner !== owner) return;
  idle();
  if (!player) return;
  player.pause();
  player.removeAttribute("src");
  player.load();
}
