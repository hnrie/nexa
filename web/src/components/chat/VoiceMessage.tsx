import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "@/components/common/Spinner";
import { t } from "@/i18n";
import { decodeWave, shapeOf, SHOWN_BARS } from "@/lib/voiceMessage";
import { clock, SPEEDS } from "./AudioPlayer";
import { mediaPrefs, saveMediaPrefs } from "./mediaPrefs";
import s from "./VoiceMessage.module.css";

interface Props {
  /** The decrypted recording, once it is here. */
  src: string | null;
  duration: number | undefined;
  wave: string | undefined;
  /** Still on its way (shown on the play button). */
  loading: boolean;
  /** Asks for the recording when it was not fetched by itself. */
  onLoad: () => void;
}

const FLAT = Array.from({ length: SHOWN_BARS }, () => 0.3);

/**
 * A voice message: a round play button, the shape of the voice to scrub along,
 * and its time, with the speed beside it. The shape and length travel with
 * the message, so it is drawn whole before the recording has come down.
 */
export function VoiceMessage({ src, duration: hinted, wave, loading, onLoad }: Props) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(hinted ?? 0);
  const [speed, setSpeed] = useState(() => (SPEEDS.includes(mediaPrefs().speed) ? mediaPrefs().speed : 1));
  const [failed, setFailed] = useState(false);
  // pressed before the recording was here: it plays as soon as it arrives
  const [queued, setQueued] = useState(false);
  const shape = useMemo(() => {
    const got = decodeWave(wave);
    return got ? shapeOf(got, SHOWN_BARS) : FLAT;
  }, [wave]);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const onTime = () => setTime(el.currentTime);
    // a recording made in a browser often says nothing of its length until played through
    const onMeta = () => Number.isFinite(el.duration) && el.duration > 0 && setDuration(el.duration);
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
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed, src]);

  const play = () => {
    const el = audio.current;
    if (!el) return;
    el.playbackRate = speed;
    void el.play().catch((err: unknown) => {
      if (!(err instanceof DOMException && err.name === "AbortError")) setFailed(true);
    });
  };
  useEffect(() => {
    if (src && queued) {
      setQueued(false);
      play();
    }
    // play is the same every time; only the arrival matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, queued]);

  const toggle = () => {
    const el = audio.current;
    if (!src || !el) {
      setQueued(true);
      onLoad();
      return;
    }
    if (el.paused) play();
    else el.pause();
  };
  const seekTo = (fraction: number) => {
    const el = audio.current;
    if (!el || !src || !duration) return;
    el.currentTime = Math.max(0, Math.min(duration, fraction * duration));
    setTime(el.currentTime);
  };
  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    seekTo(Math.max(0, Math.min(1, document.documentElement.dir === "rtl" ? 1 - x : x)));
  };
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = audio.current;
    if (!el) return;
    const step = (by: number) => {
      e.preventDefault();
      seekTo((el.currentTime + by) / (duration || 1));
    };
    if (e.key === "ArrowRight") step(5);
    else if (e.key === "ArrowLeft") step(-5);
  };
  const nextSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1;
    setSpeed(next);
    saveMediaPrefs({ speed: next });
  };

  const broken = failed;
  const pct = duration > 0 ? time / duration : 0;
  const busy = (loading || queued) && !src && !broken;
  return (
    <div className={s.voice} data-playing={playing} role="group" aria-label={t("voiceMessage.label")} data-testid="voice-message">
      {src ? <audio ref={audio} src={src} preload="metadata" /> : null}
      <button className={s.play} onClick={toggle} disabled={broken} aria-label={playing ? t("voiceMessage.pause") : t("voiceMessage.play")} data-testid="voice-play">
        {busy ? <Spinner size={18} /> : playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className={s.playIcon} />}
      </button>
      {broken ? (
        <span className={s.failed}>{t("chat.audioPlayer.thisAudioCannotBePlayedHere")}</span>
      ) : (
        <div
          className={s.wave}
          role="slider"
          aria-label={t("chat.audioPlayer.seek")}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${clock(time)} / ${clock(duration)}`}
          tabIndex={0}
          onKeyDown={onKey}
          // dragging along the shape scrubs, rather than pulling a drawer open on a phone
          data-no-swipe
          onPointerDown={(e) => {
            if (!src) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            scrub(e);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e);
          }}
        >
          {shape.map((h, i) => (
            <span key={i} className={s.bar} data-on={(i + 0.5) / shape.length <= pct} style={{ height: `${Math.round(14 + h * 86)}%` }} />
          ))}
        </div>
      )}
      {/* while it plays, the time counts up; still, it says how long it is */}
      <span className={s.time}>{clock(playing || time > 0 ? time : duration)}</span>
      <button className={s.speed} onClick={nextSpeed} aria-label={t("chat.audioPlayer.playbackSpeed")} title={t("chat.audioPlayer.playbackSpeed")}>{speed}×</button>
    </div>
  );
}
