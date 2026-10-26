import { Pause, Play, SendHorizontal, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clock } from "@/components/chat/AudioPlayer";
import { t } from "@/i18n";
import { decodeWave, MAX_SECONDS, startRecording, type Recorder, type Recording } from "@/lib/voiceMessage";
import { useUI } from "@/stores/ui";
import s from "./VoiceRecordBar.module.css";

/** How many bars of the live shape fit along the bar: it scrolls in from the end as the voice comes. */
const LIVE_BARS = 40;

interface Props {
  onSend: (rec: Recording) => void;
  onClose: () => void;
}

/**
 * The message box while a voice message is made. It starts recording at once:
 * a red dot, the time and the voice's shape as it comes. Stop gives a moment
 * to listen back; Send goes straight from either; the bin throws it away.
 * Escape throws it away too, and Enter sends.
 */
export function VoiceRecordBar({ onSend, onClose }: Props) {
  const toast = useUI((u) => u.toast);
  const rec = useRef<Recorder | null>(null);
  const [phase, setPhase] = useState<"starting" | "recording" | "review">("starting");
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState<number[]>([]);
  const [kept, setKept] = useState<Recording | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [played, setPlayed] = useState(0);
  const sendBtn = useRef<HTMLButtonElement>(null);
  const done = useRef(false);

  const stop = async (): Promise<Recording | null> => {
    const r = rec.current;
    rec.current = null;
    if (!r) return kept;
    const out = await r.stop();
    if (!out) {
      toast(t("voiceMessage.tooShort"), "info");
      onClose();
      return null;
    }
    setKept(out);
    setUrl(URL.createObjectURL(out.blob));
    setPhase("review");
    return out;
  };

  useEffect(() => {
    let alive = true;
    startRecording(() => void stop())
      .then((r) => {
        if (!alive) return r.cancel();
        rec.current = r;
        setPhase("recording");
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
        toast(denied ? t("voiceMessage.micBlocked") : t("voiceMessage.micFailed"), "error");
        onClose();
      });
    return () => {
      alive = false;
      rec.current?.cancel();
      rec.current = null;
    };
    // started once, when the bar opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  // the time and the shape, a few times a second
  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => {
      const r = rec.current;
      if (!r) return;
      setElapsed(r.elapsed());
      setLive((cur) => [...cur.slice(-(LIVE_BARS - 1)), r.level()]);
    }, 100);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "starting") sendBtn.current?.focus({ preventScroll: true });
  }, [phase]);

  const send = async () => {
    if (done.current) return;
    const out = phase === "review" ? kept : await stop();
    if (!out) return;
    done.current = true;
    onSend(out);
  };
  const discard = () => {
    done.current = true;
    rec.current?.cancel();
    rec.current = null;
    onClose();
  };
  const togglePlay = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      discard();
    } else if (e.key === "Enter" && !e.shiftKey && (e.target as HTMLElement).tagName !== "BUTTON") {
      e.preventDefault();
      void send();
    }
  };

  const shape = phase === "review" ? (decodeWave(kept?.wave) ?? []) : [...Array.from({ length: LIVE_BARS - live.length }, () => 0), ...live];
  const total = kept?.duration ?? elapsed;
  const pct = phase === "review" && total > 0 ? played / total : 0;
  const nearLimit = phase === "recording" && MAX_SECONDS - elapsed <= 30;
  return (
    <div className={s.bar} data-phase={phase} onKeyDown={onKeyDown} role="group" aria-label={t("voiceMessage.recording")} data-testid="voice-recorder">
      <button type="button" className={s.discard} onClick={discard} aria-label={t("voiceMessage.discard")} title={t("voiceMessage.discard")} data-testid="voice-discard">
        <Trash2 size={20} />
      </button>
      {phase === "review" ? (
        <>
          {url ? (
            <audio
              ref={audio}
              src={url}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => {
                setPlaying(false);
                setPlayed(0);
              }}
              onTimeUpdate={(e) => setPlayed(e.currentTarget.currentTime)}
            />
          ) : null}
          <button type="button" className={s.listen} onClick={togglePlay} aria-label={playing ? t("voiceMessage.pause") : t("voiceMessage.play")} data-testid="voice-listen">
            {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </button>
        </>
      ) : (
        <span className={s.dot} data-live={phase === "recording"} aria-hidden="true" />
      )}
      <span className={s.time} data-warn={nearLimit} aria-live="off" data-testid="voice-time">
        {clock(phase === "review" && (playing || played > 0) ? played : total)}
      </span>
      <div className={s.wave} aria-hidden="true">
        {shape.map((h, i) => (
          <span key={phase === "review" ? i : `l${i}`} className={s.waveBar} data-on={phase === "recording" || (i + 0.5) / shape.length <= pct} style={{ height: `${Math.round(10 + h * 90)}%` }} />
        ))}
      </div>
      {phase === "recording" ? (
        <button type="button" className={s.stop} onClick={() => void stop()} aria-label={t("voiceMessage.stop")} title={t("voiceMessage.stop")} data-testid="voice-stop">
          <Square size={14} fill="currentColor" />
        </button>
      ) : null}
      <button ref={sendBtn} type="button" className={s.send} onClick={() => void send()} disabled={phase === "starting"} aria-label={t("voiceMessage.send")} title={t("voiceMessage.send")} data-testid="voice-send">
        <SendHorizontal size={20} />
      </button>
    </div>
  );
}
