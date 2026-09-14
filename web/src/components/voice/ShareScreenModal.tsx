import { MonitorUp } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Toggle } from "@/components/common/Toggle";
import { desktopBridge } from "@/lib/desktopBridge";
import { useSettings, type ShareFps, type ShareResolution } from "@/stores/settings";
import { SHARE_FRAME_RATES, SHARE_RESOLUTIONS, shareBitrate } from "@/voice/shareQuality";
import { startScreen } from "@/voice/session";
import s from "./Voice.module.css";

const RESOLUTION_NOTES: Record<ShareResolution, string> = { "720p": "HD", "1080p": "Full HD", "1440p": "QHD", source: "Native" };
const FPS_NOTES: Record<ShareFps, string> = { 15: "Text, slides", 30: "Smooth", 60: "Games, video" };

/**
 * A row of choices that behaves as a radio group: one tab stop on the chosen
 * option, and the arrow keys move the choice along the row.
 */
function Choices<T extends string | number>({ label, id, options, value, onChange }: { label: string; id: string; options: { value: T; title: string; note: string }[]; value: T; onChange: (v: T) => void }) {
  const row = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = options.findIndex((o) => o.value === value);
    const next = (at + step + options.length) % options.length;
    onChange(options[next]!.value);
    row.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[next]?.focus();
  };
  return (
    <div className={s.shareGroup}>
      <span className={s.shareLabel} id={id}>{label}</span>
      <div ref={row} className={s.shareOptions} role="radiogroup" aria-labelledby={id} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            tabIndex={value === o.value ? 0 : -1}
            className={s.shareOption}
            data-on={value === o.value}
            onClick={() => onChange(o.value)}
            onKeyDown={onKey}
            data-testid={`${id}-${o.value}`}
          >
            <span className={s.shareValue}>{o.title}</span>
            <span className={s.shareNote}>{o.note}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Asks for a share's resolution and frame rate before the browser asks what to share. */
export function ShareScreenModal({ onClose }: { onClose: () => void }) {
  const voice = useSettings((x) => x.settings.voice);
  const patch = useSettings((x) => x.patch);
  const [resolution, setResolution] = useState<ShareResolution>(voice.shareResolution);
  const [fps, setFps] = useState<ShareFps>(voice.shareFps);
  // the desktop app knows when this computer cannot share sound without the call echoing in it
  const audioSupported = desktopBridge()?.shareAudio !== false;
  const [audio, setAudio] = useState((voice.shareAudio ?? true) && audioSupported);
  const mbps = shareBitrate(resolution, fps) / 1_000_000;

  const goLive = () => {
    const keepAudio = audioSupported ? audio : (voice.shareAudio ?? true);
    if (resolution !== voice.shareResolution || fps !== voice.shareFps || keepAudio !== (voice.shareAudio ?? true)) patch({ voice: { ...voice, shareResolution: resolution, shareFps: fps, shareAudio: keepAudio } });
    // straight from the click: the browser only opens its picker during a gesture
    void startScreen({ resolution, fps, audio });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Share Your Screen"
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={goLive} data-testid="go-live"><MonitorUp size={16} /> Go Live</Button>
        </>
      }
    >
      <div className={s.shareForm}>
        <Choices label="Resolution" id="share-res" options={SHARE_RESOLUTIONS.map((r) => ({ value: r.value, title: r.label, note: RESOLUTION_NOTES[r.value] }))} value={resolution} onChange={setResolution} />
        <Choices label="Frame rate" id="share-fps" options={SHARE_FRAME_RATES.map((f) => ({ value: f, title: `${f} fps`, note: FPS_NOTES[f] }))} value={fps} onChange={setFps} />
        <div className={s.shareAudio} data-testid="share-audio">
          <Toggle
            checked={audio}
            disabled={!audioSupported}
            onChange={setAudio}
            label="Share audio"
            description={audioSupported ? "Everyone watching hears what you're sharing. The call's own sound is left out." : "This computer can't share its sound without the call echoing back in it, so shares from here are silent."}
          />
        </div>
        <p className={s.shareHint}>
          {resolution === "source" ? "Shares at your screen's own resolution. " : ""}Uses up to {Number.isInteger(mbps) ? mbps : mbps.toFixed(1)} Mbps of upload. Your browser asks what to share next.
        </p>
      </div>
    </Modal>
  );
}
