import { Download, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Tooltip } from "@/components/common/Tooltip";
import { formatBytes } from "@/lib/time";
import s from "./AudioPlayer.module.css";

function clock(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const total = Math.floor(t);
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, "0")}`;
}

const SPEEDS = [1, 1.25, 1.5, 2, 0.75];
/** How many bars the waveform stand-in draws. */
const BARS = 48;

/** A stable pattern per file, so the same clip always looks the same. */
function bars(seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < BARS; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    out.push(0.25 + (Math.abs(h) % 1000) / 1000 * 0.75);
  }
  return out;
}

interface Props {
  src: string;
  name: string;
  size?: number | undefined;
  duration?: number | undefined;
}

/** The app's own audio player: a scrubbable bar, speed, volume and a download. */
export function AudioPlayer({ src, name, size, duration: hinted }: Props) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(hinted ?? 0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);
  const [shape] = useState(() => bars(name));

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setFailed(true));
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
    seekTo((e.clientX - r.left) / r.width);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const el = audio.current;
    if (!el) return;
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

  const pct = duration > 0 ? time / duration : 0;
  return (
    <div className={s.player} data-testid="audio-player" onKeyDown={onKey}>
      <audio ref={audio} src={src} preload="metadata" />
      <button className={s.play} onClick={toggle} aria-label={playing ? `Pause ${name}` : `Play ${name}`} disabled={failed}>
        {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
      </button>
      <div className={s.body}>
        <div className={s.top}>
          <span className={s.name} title={name}>{name}</span>
          {size ? <span className={s.size}>{formatBytes(size)}</span> : null}
        </div>
        {failed ? (
          <div className={s.failed}>This audio cannot be played here. Download it to listen.</div>
        ) : (
          <div
            className={s.track}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(time)}
            tabIndex={0}
            onPointerDown={scrub}
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
          <Tooltip text="Playback speed" side="top">
            <button className={s.speed} onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1)} aria-label="Playback speed">{speed}×</button>
          </Tooltip>
          <Tooltip text={muted ? "Unmute" : "Mute"} side="top">
            <button className={s.ctl} onClick={() => setMuted((v) => !v)} aria-label={muted ? "Unmute" : "Mute"}>{muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
          </Tooltip>
          <input className={s.volume} type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume} aria-label="Volume" onChange={(e) => { setVolume(Number(e.target.value)); setMuted(false); }} />
          <Tooltip text="Download" side="top">
            <a className={s.ctl} href={src} download={name} aria-label={`Download ${name}`}><Download size={16} /></a>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
