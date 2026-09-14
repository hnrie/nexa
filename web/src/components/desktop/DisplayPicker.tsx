import { Monitor, MonitorUp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Toggle } from "@/components/common/Toggle";
import type { DisplaySourceRequest } from "@/lib/desktopBridge";
import s from "./Desktop.module.css";

/**
 * The desktop app's screen and window picker, asked for by getDisplayMedia
 * after the Share Your Screen dialog. Browsers have their own; the app shows
 * this one.
 */
export function DisplayPicker({ request, onChoose }: { request: DisplaySourceRequest; onChoose: (sourceId: string | null, withAudio: boolean) => void }) {
  const screens = request.sources.filter((x) => x.kind === "screen");
  const windows = request.sources.filter((x) => x.kind === "window");
  const [tab, setTab] = useState<"screen" | "window">(screens.length ? "screen" : "window");
  const [picked, setPicked] = useState<string | null>(screens.length === 1 ? screens[0]!.id : null);
  const [audio, setAudio] = useState(request.audio);
  const shown = tab === "screen" ? screens : windows;

  return (
    <Modal
      open
      onClose={() => onChoose(null, false)}
      title="Choose what to share"
      width={640}
      footer={
        <>
          <Button variant="ghost" onClick={() => onChoose(null, false)}>Cancel</Button>
          <Button disabled={!picked} onClick={() => onChoose(picked, audio)} data-testid="display-share"><MonitorUp size={16} /> Share</Button>
        </>
      }
    >
      <div className={s.tabs} role="tablist">
        <button type="button" role="tab" aria-selected={tab === "screen"} className={s.tab} data-on={tab === "screen"} onClick={() => setTab("screen")}>Screens ({screens.length})</button>
        <button type="button" role="tab" aria-selected={tab === "window"} className={s.tab} data-on={tab === "window"} onClick={() => setTab("window")}>Windows ({windows.length})</button>
      </div>
      {shown.length === 0 ? (
        <div className={s.empty}>Nothing to share here.</div>
      ) : (
        <div className={s.grid}>
          {shown.map((src) => (
            <button
              key={src.id}
              type="button"
              className={s.source}
              data-on={picked === src.id}
              aria-pressed={picked === src.id}
              onClick={() => setPicked(src.id)}
              onDoubleClick={() => onChoose(src.id, audio)}
              data-testid="display-source"
            >
              {src.thumbnail ? <img className={s.thumb} src={src.thumbnail} alt="" draggable={false} /> : <span className={s.thumb} />}
              <span className={s.sourceName}>
                {src.icon ? <img src={src.icon} alt="" /> : <Monitor size={14} />}
                <span title={src.name}>{src.name}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {request.audio ? (
        <div className={s.audio}>
          <Toggle checked={audio} onChange={setAudio} label="Share sound" description="Everyone watching hears what your computer plays." />
        </div>
      ) : null}
    </Modal>
  );
}
