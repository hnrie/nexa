import { CircleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/common/Button";
import { Tooltip } from "@/components/common/Tooltip";
import { t } from "@/i18n";
import { bindable, bindKeys, comboOf, formatBind, isMac, parseBind, reservedBy, type Combo } from "@/lib/keybinds";
import { bindClash, setPluginBind, usePluginKeybinds } from "@/lib/pluginKeybinds";
import { useSettings } from "@/stores/settings";
import { KEYBIND_NAMES, KeyCaps } from "./KeybindsPage";
import k from "./Keybinds.module.css";
import s from "./Settings.module.css";

type Target = { pluginId: string; id: string };
const same = (a: Target | null, b: Target) => !!a && a.pluginId === b.pluginId && a.id === b.id;

/**
 * Settings, Keybinds, for plugins: a group for each running plugin that has
 * keybinds, under its name, each set by pressing it as the app's own are, by
 * the same rules. Keys something else already has are pointed out and not
 * taken. A plugin that is off has no group here, and keeps its keys saved.
 */
export function PluginKeybinds() {
  const byPlugin = usePluginKeybinds((x) => x.byPlugin);
  const saved = useSettings((x) => x.settings.pluginKeybinds);
  const [recording, setRecording] = useState<Target | null>(null);
  const [mods, setMods] = useState<Combo | null>(null);
  const [error, setError] = useState<(Target & { text: string }) | null>(null);
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
      if (e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) return stop();
      const c = comboOf(e);
      if (!c) {
        setMods({ mod: mac ? e.metaKey : e.ctrlKey, ctrl: mac ? e.ctrlKey : false, alt: e.altKey, shift: e.shiftKey, code: "" });
        return;
      }
      if (e.repeat) return;
      const fail = (text: string) => setError({ ...recording, text });
      if (!bindable(c)) return fail(mac ? t("keybinds.needsModifierMac") : t("keybinds.needsModifier"));
      const reserved = reservedBy(c);
      if (reserved) return fail(t("keybinds.reserved", { what: t(reserved) }));
      const clash = bindClash(c, recording);
      if (clash?.kind === "app") return fail(t("keybinds.taken", { action: t(KEYBIND_NAMES[clash.action]) }));
      if (clash?.kind === "plugin") return fail(clash.name && clash.plugin ? t("keybinds.takenByPlugin", { name: clash.name, plugin: clash.plugin }) : t("keybinds.takenByOtherPlugin"));
      setError(null);
      setPluginBind(recording.pluginId, recording.id, formatBind(c));
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
  }, [recording, mac]);

  const plugins = Object.entries(byPlugin).sort(([, a], [, b]) => a.plugin.localeCompare(b.plugin));
  if (!plugins.length) return null;

  return (
    <section data-testid="plugin-keybinds" aria-label={t("keybinds.plugins")}>
      <h3 className={s.h5}>{t("keybinds.plugins")}</h3>
      <p className={s.hint} style={{ margin: "-4px 0 12px" }}>{t("keybinds.pluginsHint")}</p>
      {plugins.map(([pluginId, { plugin, keybinds }]) => (
        <div key={pluginId} style={{ marginBottom: 16 }}>
          <h4 className={k.pluginName} dir="auto">{plugin}</h4>
          <div className={k.list}>
            {Object.entries(keybinds).map(([id, info]) => {
              const target = { pluginId, id };
              const combo = parseBind(saved[pluginId]?.[id]);
              const on = same(recording, target);
              const heldMods = on && mods && (mods.mod || mods.ctrl || mods.alt || mods.shift) ? mods : null;
              const err = same(error, target) ? error!.text : null;
              const nameId = `plugin-keybind-${pluginId}-${id}`;
              return (
                <div key={id} ref={on ? rowRef : undefined} className={k.row} data-recording={on || undefined} data-testid="plugin-keybind" data-keybind={id}>
                  <div className={k.what}>
                    <span className={k.name} id={nameId} dir="auto">{info.name}</span>
                    {info.description ? <span className={k.desc} dir="auto">{info.description}</span> : null}
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
                      <Button size="sm" variant={on || combo ? "secondary" : "primary"} onClick={() => { setError(null); setMods(null); setRecording(on ? null : target); }} aria-describedby={nameId} data-testid="plugin-keybind-change">
                        {on ? t("look.common.cancel") : combo ? t("settings.security.change") : t("keybinds.setKey")}
                      </Button>
                      {combo && !on ? (
                        <Tooltip text={t("keybinds.removeKey")}>
                          <button type="button" className={k.clear} onClick={() => { setError(null); setPluginBind(pluginId, id, null); }} aria-label={t("keybinds.removeKeyFor", { action: info.name })} data-testid="plugin-keybind-clear">
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
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <span className="visually-hidden" aria-live="polite">{recording ? t("keybinds.listeningFor", { action: byPlugin[recording.pluginId]?.keybinds[recording.id]?.name ?? "" }) : ""}</span>
    </section>
  );
}
