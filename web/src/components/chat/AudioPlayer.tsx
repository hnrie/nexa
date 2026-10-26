import { Download, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Tooltip } from "@/components/common/Tooltip";
import { formatBytes } from "@/lib/time";
import { mediaPrefs, saveMediaPrefs } from "./mediaPrefs";
import { BARS, waveform } from "./waveform";
import s from "./AudioPlayer.module.css";

import { t as tr_ } from "@/i18n";
export function clock(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const total = Math.floor(t);
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, "0")}`;
}

export const SPEEDS = [1, 1.25, 1.5, 2, 0.75];
/** Until the recording's own shape is worked out (or where it cannot be), an even row: honest about knowing nothing. */
const FLAT = Array.from({ length: BARS }, () => 0.3);

interface Props {
  src: string;
  name: string;
  size?: number | undefined;
  duration?: number | undefined;
  /** What the recording's shape is remembered by (its attachment); without one, the bar stays even. */
  waveKey?: string | undefined;
}

/** The app's own audio player: a scrubbable bar, speed, volume and a download. */
export function AudioPlayer({ src, name, size, duration: hinted, waveKey }: Props) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(hinted ?? 0);
  const [prefs] = useState(mediaPrefs);
  const [volume, setVolume] = useState(prefs.volume);
  const [muted, setMuted] = useState(prefs.muted);
  const [speed, setSpeed] = useState(SPEEDS.includes(prefs.speed) ? prefs.speed : 1);
  const [failed, setFailed] = useState(false);
  const [shape, setShape] = useState<number[]>(FLAT);

  useEffect(() => {
    if (!waveKey) return;
    let alive = true;
    void waveform(waveKey, src).then((bars) => alive && bars && setShape(bars));
    return () => {
      alive = false;
    };
  }, [waveKey, src]);

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch((err: unknown) => {
        // a play() cut short by pause() rejects too, and says nothing about whether the file plays
        if (!(err instanceof DOMException && err.name === "AbortError")) setFailed(true);
      });
    }
    else el.pause();
  }, []);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const onTime = () => setTime(el.currentTime);
    const onMeta = () => Number.isFinite(el.duration) && setDuration(el.duration);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnd = () => {
      setPlaying(false);
      setTime(0);
    };
    const onError = () => setFailed(true);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnd);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("error", onError);
    };
  }, [src]);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
    el.playbackRate = speed;
  }, [volume, muted, speed]);

  const seekTo = (fraction: number) => {
    const el = audio.current;
    if (!el || !duration) return;
    el.currentTime = Math.max(0, Math.min(duration, fraction * duration));
    setTime(el.currentTime);
  };
  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    seekTo(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
  };
  /**
   * The player's own keys, on the player and its track only: on a button
   * Space is that button's (it used to play the clip instead of muting it),
   * and the arrows on the volume slider move the volume.
   */
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = audio.current;
    const target = e.target as HTMLElement;
    if (!el || (target !== e.currentTarget && target.getAttribute("role") !== "slider")) return;
    if (e.key === " " || e.key === "k") {
      e.preventDefault();
      toggle();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      seekTo((el.currentTime + 5) / (duration || 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      seekTo((el.currentTime - 5) / (duration || 1));
    }
  };
  const changeVolume = (v: number) => {
    setVolume(v);
    setMuted(false);
    saveMediaPrefs({ volume: v, muted: false });
  };
  const toggleMute = () => {
    setMuted((m) => {
      saveMediaPrefs({ muted: !m });
      return !m;
    });
  };
  const nextSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1;
    setSpeed(next);
    saveMediaPrefs({ speed: next });
  };

  const pct = duration > 0 ? time / duration : 0;
  const muteLabel = muted ? tr_("chat.media.unmute") : tr_("chat.media.mute");
  return (
    <div className={s.player} data-testid="audio-player" onKeyDown={onKey}>
      <audio ref={audio} src={src} preload="metadata" />
      <button className={s.play} onClick={toggle} aria-label={playing ? tr_("chat.audioPlayer.pauseNamed", { name }) : tr_("chat.audioPlayer.playNamed", { name })} disabled={failed}>
        {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
      </button>
      <div className={s.body}>
        <div className={s.top}>
          <span className={s.name} title={name} dir="auto">{name}</span>
          {size ? <span className={s.size}>{formatBytes(size)}</span> : null}
        </div>
        {failed ? (
          <div className={s.failed}>{tr_("chat.audioPlayer.thisAudioCannotBePlayedHere")}</div>
        ) : (
          <div
            className={s.track}
            role="slider"
            aria-label={tr_("chat.audioPlayer.seek")}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(time)}
            aria-valuetext={`${clock(time)} / ${clock(duration)}`}
            tabIndex={0}
            // dragging along the waveform scrubs, rather than pulling a drawer open on a phone
            data-no-swipe
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              scrub(e);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e);
            }}
          >
            {shape.map((h, i) => (
              <span key={i} className={s.bar} data-on={i / BARS <= pct} style={{ height: `${Math.round(h * 100)}%` }} />
            ))}
          </div>
        )}
      </div>
      <div className={s.side}>
        <span className={s.time}>{clock(time)} / {clock(duration)}</span>
        <div className={s.tools}>
          <Tooltip text={tr_("chat.audioPlayer.playbackSpeed")} side="top">
            <button className={s.speed} onClick={nextSpeed} aria-label={tr_("chat.audioPlayer.playbackSpeed")}>{speed}×</button>
          </Tooltip>
          <Tooltip text={muteLabel} side="top">
            <button className={s.ctl} onClick={toggleMute} aria-label={muteLabel} aria-pressed={muted}>{muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
          </Tooltip>
          <input className={s.volume} type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume} aria-label={tr_("chat.audioPlayer.volume")} onChange={(e) => changeVolume(Number(e.target.value))} />
          <Tooltip text={tr_("chat.attachments.download")} side="top">
            <a className={s.ctl} href={src} download={name} aria-label={tr_("chat.attachments.downloadNamed", { name })}><Download size={16} /></a>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
