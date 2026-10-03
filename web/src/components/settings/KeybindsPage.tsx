import { CircleAlert, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/common/Button";
import { Toggle } from "@/components/common/Toggle";
import { Tooltip } from "@/components/common/Tooltip";
import { t } from "@/i18n";
import { desktopBridge } from "@/lib/desktopBridge";
import { bindable, bindKeys, comboOf, formatBind, isMac, KEYBIND_ACTIONS, keybindsOf, keyName, parseBind, reservedBy, sameCombo, type Combo, type KeybindAction } from "@/lib/keybinds";
import { useDesktop } from "@/stores/desktop";
import { useSettings } from "@/stores/settings";
import k from "./Keybinds.module.css";
import s from "./Settings.module.css";

const NAMES: Record<KeybindAction, string> = { mute: "keybinds.actions.mute", deafen: "keybinds.actions.deafen", activity: "keybinds.actions.activity" };
const HINTS: Record<KeybindAction, string> = { mute: "keybinds.actions.muteHint", deafen: "keybinds.actions.deafenHint", activity: "keybinds.actions.activityHint" };

/** The keys of a bind, as caps. */
export function KeyCaps({ combo, held }: { combo: Combo; held?: boolean }) {
  return (
    <span className={k.keys}>
      {bindKeys(combo).map((key, i) => (
        <kbd key={i} className={k.cap} data-held={held || undefined}>{key}</kbd>
      ))}
    </span>
  );
}

/**
 * Settings, Keybinds: the keys for muting, deafening and sharing activity,
 * each set by pressing it. In the desktop app they also answer while another
 * window is in front; the app says which keys another program already holds.
 */
export default function KeybindsPage({ onVoice }: { onVoice: () => void }) {
  const saved = useSettings((x) => x.settings.keybinds);
  const background = useSettings((x) => x.settings.backgroundKeybinds !== false);
  const ptt = useSettings((x) => x.settings.voice);
  const patch = useSettings((x) => x.patch);
  const held = useDesktop((x) => x.shortcuts);
  const binds = keybindsOf(saved);
  const bridge = desktopBridge();
  // an app from before 1.2.2 answers the keys only while it is in front
  const canHold = !!bridge?.setShortcuts;
  const [recording, setRecording] = useState<KeybindAction | null>(null);
  const [mods, setMods] = useState<Combo | null>(null);
  const [error, setError] = useState<{ action: KeybindAction; text: string } | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const mac = isMac();

  useEffect(() => {
    if (!recording) return;
    const stop = () => {
      setRecording(null);
      setMods(null);
    };
    const onKey = (e: KeyboardEvent) => {
      // the keys belong to the box while it listens: nothing else in the app answers them
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        stop();
        return;
      }
      const c = comboOf(e);
      if (!c) {
        // a modifier on its own: shown as it is held, so it is clear the box hears it
        setMods({ mod: mac ? e.metaKey : e.ctrlKey, ctrl: mac ? e.ctrlKey : false, alt: e.altKey, shift: e.shiftKey, code: "" });
        return;
      }
      if (e.repeat) return;
      if (!bindable(c)) {
        setError({ action: recording, text: mac ? t("keybinds.needsModifierMac") : t("keybinds.needsModifier") });
        return;
      }
      const taken = KEYBIND_ACTIONS.find((a) => a !== recording && sameCombo(parseBind(binds[a]), c));
      if (taken) {
        setError({ action: recording, text: t("keybinds.taken", { action: t(NAMES[taken]) }) });
        return;
      }
      const reserved = reservedBy(c);
      if (reserved) {
        setError({ action: recording, text: t("keybinds.reserved", { what: t(reserved) }) });
        return;
      }
      setError(null);
      patch({ keybinds: { ...saved, [recording]: formatBind(c) } });
      stop();
    };
    const onUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setMods((m) => (m ? { ...m, mod: mac ? e.metaKey : e.ctrlKey, ctrl: mac ? e.ctrlKey : false, alt: e.altKey, shift: e.shiftKey } : m));
    };
    // a press anywhere else puts the row down, so it cannot be left listening forever
    const onDown = (e: PointerEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) stop();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [recording, binds, saved, patch, mac]);

  const listen = (action: KeybindAction) => {
    setError(null);
    setMods(null);
    setRecording((r) => (r === action ? null : action));
  };
  const clear = (action: KeybindAction) => {
    setError(null);
    patch({ keybinds: { ...saved, [action]: "" } });
  };
  const changed = KEYBIND_ACTIONS.some((a) => saved[a] !== undefined);

  return (
    <>
      <h2 className={s.title}>{t("keybinds.title")}</h2>
      <p className={s.hint} style={{ margin: "-10px 0 18px" }}>{t("keybinds.intro")}</p>
      <div className={k.list} data-setting="keybinds">
        {KEYBIND_ACTIONS.map((action) => {
          const combo = parseBind(binds[action]);
          const on = recording === action;
          const heldMods = on && mods && (mods.mod || mods.ctrl || mods.alt || mods.shift) ? mods : null;
          const err = error?.action === action ? error.text : null;
          const elsewhere = !on && combo && canHold && background && held && held[action] === false;
          return (
            <div key={action} ref={on ? rowRef : undefined} className={k.row} data-recording={on || undefined} data-testid={`keybind-${action}`}>
              <div className={k.what}>
                <span className={k.name} id={`keybind-${action}-name`}>{t(NAMES[action])}</span>
                <span className={k.desc}>{t(HINTS[action])}</span>
              </div>
              <div className={k.side}>
                {on ? (
                  heldMods ? (
                    <span className={k.keys}>
                      {bindKeys({ ...heldMods, code: "" }).filter(Boolean).map((key, i) => (
                        <kbd key={i} className={k.cap} data-held>{key}</kbd>
                      ))}
                    </span>
                  ) : (
                    <span className={k.listening}>{t("keybinds.pressKeys")}</span>
                  )
                ) : combo ? (
                  <KeyCaps combo={combo} />
                ) : (
                  <span className={k.none}>{t("keybinds.notSet")}</span>
                )}
                <div className={k.btns}>
                  <Button size="sm" variant={on ? "secondary" : combo ? "secondary" : "primary"} onClick={() => listen(action)} aria-describedby={`keybind-${action}-name`} data-testid={`keybind-${action}-change`}>
                    {on ? t("look.common.cancel") : combo ? t("settings.security.change") : t("keybinds.setKey")}
                  </Button>
                  {combo && !on ? (
                    <Tooltip text={t("keybinds.removeKey")}>
                      <button type="button" className={k.clear} onClick={() => clear(action)} aria-label={t("keybinds.removeKeyFor", { action: t(NAMES[action]) })} data-testid={`keybind-${action}-clear`}>
                        <X size={18} />
                      </button>
                    </Tooltip>
                  ) : null}
                </div>
              </div>
              {err ? (
                <p className={k.note} data-tone="danger" role="alert">
                  <CircleAlert size={15} aria-hidden="true" />
                  {err}
                </p>
              ) : elsewhere ? (
                <p className={k.note} data-tone="warn">
                  <TriangleAlert size={15} aria-hidden="true" />
                  {t("keybinds.heldElsewhere")}
                </p>
              ) : null}
            </div>
          );
        })}
        <div className={k.row}>
          <div className={k.what}>
            <span className={k.name}>{t("settings.voice.pushToTalk")}</span>
            <span className={k.desc}>{t("keybinds.pttHint")}</span>
            <span><button type="button" className={k.link} onClick={onVoice}>{t("keybinds.pttChange")}</button></span>
          </div>
          <div className={k.side}>
            {ptt.pttKey ? (
              <span className={k.keys}>
                <kbd className={k.cap}>{ptt.pttKey.length === 1 ? ptt.pttKey.toUpperCase() : keyName(ptt.pttKey)}</kbd>
              </span>
            ) : null}
          </div>
        </div>
      </div>
      {/* the polite announcement a screen reader gets while a row listens */}
      <span className="visually-hidden" aria-live="polite">{recording ? t("keybinds.listeningFor", { action: t(NAMES[recording]) }) : ""}</span>
      <div className={k.foot}>
        <p className={k.where}>{bridge ? (canHold ? t("keybinds.inApp") : t("keybinds.updateApp")) : t("keybinds.inBrowser")}</p>
        {changed ? (
          <Button size="sm" variant="ghost" onClick={() => patch({ keybinds: {} })} data-testid="keybinds-reset">{t("keybinds.reset")}</Button>
        ) : null}
      </div>
      {canHold ? (
        <>
          <h3 className={s.h5}>{t("keybinds.backgroundHeading")}</h3>
          <Toggle setting="backgroundKeybinds" checked={background} onChange={(v) => patch({ backgroundKeybinds: v })} label={t("keybinds.background")} description={t("keybinds.backgroundHint")} />
        </>
      ) : null}
    </>
  );
}
