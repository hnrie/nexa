import { ExternalLink, Monitor, MonitorUp, RotateCw, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import type { DisplaySourceRequest } from "@/lib/desktopBridge";
import { desktopBridge } from "@/lib/desktopBridge";
import { shareAudioRequested } from "@/voice/media";
import s from "./Desktop.module.css";

/**
 * The desktop app's screen and window picker, asked for by getDisplayMedia
 * after the Share Your Screen dialog. Browsers have their own; the app shows
 * this one. Whether the share carries sound was already chosen in that
 * dialog, so the picker only asks what to share.
 */
export function DisplayPicker({ request, onChoose }: { request: DisplaySourceRequest; onChoose: (sourceId: string | null, withAudio: boolean) => void }) {
  if (request.permission) return <ScreenPermission stale={request.permission.stale} onClose={() => onChoose(null, false)} />;
  return <SourceGrid request={request} onChoose={onChoose} />;
}

/**
 * What to do when the computer will not let the app record the screen. macOS
 * keeps that decision itself, and an update can leave one that reads as
 * granted while the recording it allows is an older copy of the app — the
 * settings look right and nothing is captured. A restart picks up a fresh
 * decision; where it does not, taking the app out of the list and putting it
 * back writes a new one.
 */
export function ScreenPermission({ stale, onClose }: { stale: boolean; onClose: () => void }) {
  const bridge = desktopBridge();
  return (
    <Modal
      open
      onClose={onClose}
      title="This computer is not sharing the screen"
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {bridge?.openScreenSettings ? (
            <Button variant="secondary" onClick={() => void bridge.openScreenSettings?.()} data-testid="open-screen-settings"><ExternalLink size={16} /> Open Settings</Button>
          ) : null}
          {bridge?.restartApp ? (
            <Button onClick={() => void bridge.restartApp?.()} data-testid="restart-for-screen"><RotateCw size={16} /> Restart nexa</Button>
          ) : null}
        </>
      }
    >
      <div className={s.permission}>
        <span className={s.permissionIcon}><ShieldAlert size={22} /></span>
        <div>
          {stale ? (
            <>
              <p><b>Screen Recording is switched on for nexa, and the system is still refusing.</b> That happens after an update: the permission points at the copy of the app that asked for it.</p>
              <p>Restarting usually settles it. If it does not, open Privacy &amp; Security → Screen Recording, take nexa out of the list with the minus button, add it again, and restart.</p>
            </>
          ) : (
            <>
              <p><b>nexa needs permission to record the screen.</b> Open Privacy &amp; Security → Screen Recording and switch nexa on.</p>
              <p>macOS only hands the permission over to a fresh start, so restart the app afterwards.</p>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function SourceGrid({ request, onChoose }: { request: DisplaySourceRequest; onChoose: (sourceId: string | null, withAudio: boolean) => void }) {
  const screens = request.sources.filter((x) => x.kind === "screen");
  const windows = request.sources.filter((x) => x.kind === "window");
  const [tab, setTab] = useState<"screen" | "window">(screens.length ? "screen" : "window");
  const [picked, setPicked] = useState<string | null>(screens.length === 1 ? screens[0]!.id : null);
  // an older app offers sound whether or not the share asked for it
  const audio = request.audio && shareAudioRequested();
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
    </Modal>
  );
}
