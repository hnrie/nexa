import { Download, Maximize2, Minimize2, Pause, PictureInPicture2, Play, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Tooltip } from "@/components/common/Tooltip";
import s from "./VideoPlayer.module.css";

function clock(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const total = Math.floor(t);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

const SPEEDS = [0.5, 1, 1.5, 2];
/** How long the controls stay up after a tap, while the video is playing. */
const CONTROLS_LINGER = 2800;

/** Touch screens have no hover, so the controls need a tap to appear. */
function coarsePointer(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(hover: none)").matches;
}

interface Props {
  src: string;
  name: string;
  /** Natural size, when the sender recorded it. */
  width?: number | undefined;
  height?: number | undefined;
  poster?: string | undefined;
  /** Hidden until the viewer chooses to reveal it. */
  spoiler?: boolean;
}

/** The app's own video player: themed controls, keyboard, PiP and a download. */
export function VideoPlayer({ src, name, width, height, poster, spoiler = false }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [full, setFull] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revealed, setRevealed] = useState(!spoiler);
  // On a touch screen the controls would otherwise sit over the picture the
  // whole time, so they appear on a tap and fade out again while it plays.
  const [ui, setUi] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armHide = useCallback((playing: boolean) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    if (playing) hideTimer.current = setTimeout(() => setUi(false), CONTROLS_LINGER);
  }, []);

  const reveal = useCallback(() => {
    setUi(true);
    armHide(!!video.current && !video.current.paused);
  }, [armHide]);

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  const toggle = useCallback(() => {
    const el = video.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setFailed(true));
    else el.pause();
  }, []);

  /** A first tap on a touch screen brings the controls up rather than pausing. */
  const onSurface = useCallback(() => {
    if (!revealed) {
      setRevealed(true);
      return;
    }
    if (coarsePointer() && !ui) {
      reveal();
      return;
    }
    toggle();
  }, [revealed, ui, reveal, toggle]);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const onTime = () => {
      setTime(el.currentTime);
      const b = el.buffered;
      setBuffered(b.length ? b.end(b.length - 1) : 0);
    };
    const onMeta = () => setDuration(el.duration);
    const onPlay = () => {
      setPlaying(true);
      armHide(true);
    };
    const onPause = () => {
      setPlaying(false);
      setUi(true);
      armHide(false);
    };
    const onError = () => setFailed(true);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("progress", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("progress", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("error", onError);
    };
  }, [src, armHide]);

  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === wrap.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const seek = (t: number) => {
    const el = video.current;
    if (!el || !Number.isFinite(duration)) return;
    el.currentTime = Math.max(0, Math.min(duration || 0, t));
    setTime(el.currentTime);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const el = video.current;
    if (!el) return;
    switch (e.key) {
      case " ":
      case "k":
        e.preventDefault();
        toggle();
        break;
      case "ArrowRight":
        e.preventDefault();
        seek(el.currentTime + 5);
        break;
      case "ArrowLeft":
        e.preventDefault();
        seek(el.currentTime - 5);
        break;
      case "m":
        e.preventDefault();
        setMuted((v) => !v);
        break;
      case "f":
        e.preventDefault();
        void toggleFull();
        break;
      default:
        break;
    }
  };

  const toggleFull = async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    else await wrap.current?.requestFullscreen?.().catch(() => {});
  };
  const pip = async () => {
    const el = video.current;
    if (!el) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await el.requestPictureInPicture();
    } catch {
      /* not supported here */
    }
  };

  useEffect(() => {
    const el = video.current;
    if (el) {
      el.volume = volume;
      el.muted = muted;
      el.playbackRate = speed;
    }
  }, [volume, muted, speed]);

  const pct = duration > 0 ? (time / duration) * 100 : 0;
  const bufPct = duration > 0 ? (buffered / duration) * 100 : 0;
  const size = width && height ? { aspectRatio: `${width} / ${height}` } : undefined;
  return (
    <div
      ref={wrap}
      className={s.player}
      style={size}
      data-full={full}
      data-spoiler={!revealed}
      data-ui={ui}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerMove={(e) => e.pointerType === "mouse" && reveal()}
      data-testid="video-player"
    >
      <video ref={video} className={s.video} src={src} poster={poster} playsInline preload="metadata" onClick={onSurface} onDoubleClick={() => void toggleFull()} />
      {!revealed ? (
        <div className={s.spoiler} onClick={() => setRevealed(true)}><span>SPOILER</span></div>
      ) : null}
      {failed ? (
        <div className={s.failed}>
          <span>This browser cannot play this video.</span>
          <a className={s.failedDownload} href={src} download={name}>Download it</a>
        </div>
      ) : null}
      {!playing && revealed && !failed ? (
        <button className={s.bigPlay} aria-label="Play" onClick={toggle}><Play size={28} fill="currentColor" /></button>
      ) : null}
      <div className={s.bar} onClick={(e) => e.stopPropagation()} onPointerDown={reveal}>
        <div
          className={s.track}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration) || 0}
          aria-valuenow={Math.round(time)}
          tabIndex={0}
          onPointerDown={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            seek(((e.clientX - r.left) / r.width) * duration);
          }}
        >
          <span className={s.buffered} style={{ width: `${bufPct}%` }} />
          <span className={s.progress} style={{ width: `${pct}%` }} />
          <span className={s.knob} style={{ left: `${pct}%` }} />
        </div>
        <div className={s.controls}>
          <button className={s.ctl} aria-label={playing ? "Pause" : "Play"} onClick={toggle}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
          <span className={s.time}>{clock(time)} / {clock(duration)}</span>
          <span className={s.spacer} />
          <div className={s.volumeWrap}>
            <button className={s.ctl} aria-label={muted ? "Unmute" : "Mute"} onClick={() => setMuted((v) => !v)}>{muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
            <input className={s.volume} type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume} aria-label="Volume" onChange={(e) => { setVolume(Number(e.target.value)); setMuted(false); }} />
          </div>
          <button className={s.speed} aria-label="Playback speed" onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!)}>{speed}×</button>
          <Tooltip text="Picture in picture" side="top">
            <button className={s.ctl} aria-label="Picture in picture" onClick={() => void pip()}><PictureInPicture2 size={18} /></button>
          </Tooltip>
          <Tooltip text="Download" side="top">
            <a className={s.ctl} href={src} download={name} aria-label="Download video" onClick={(e) => e.stopPropagation()}><Download size={18} /></a>
          </Tooltip>
          <Tooltip text={full ? "Exit full screen" : "Full screen"} side="top">
            <button className={s.ctl} aria-label="Full screen" onClick={() => void toggleFull()}>{full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
