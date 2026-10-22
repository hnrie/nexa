import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Pipette } from "lucide-react";
import { t } from "@/i18n";
import { parseColour, toHex, toThemeHex, type Rgb } from "@/lib/color";
import { Popout } from "./Popout";
import s from "./ColourInput.module.css";

/** Hue (0 to 360), saturation and value (0 to 1). */
type Hsv = { h: number; s: number; v: number };

function hsvOf(rgb: Rgb): Hsv {
  const [r, g, b] = rgb.map((x) => x / 255) as Rgb;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: h < 0 ? h + 360 : h, s: max ? d / max : 0, v: max };
}

function rgbOf({ h, s: sat, v }: Hsv): Rgb {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * sat * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return [f(5), f(3), f(1)];
}

const clamp = (x: number) => Math.min(1, Math.max(0, x));

/** The browser's eyedropper, where it has one (Chromium). */
type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };
const eyeDropper = (): EyeDropperCtor | undefined => (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;

/**
 * Where a colour is chosen: a button laid over whatever shows the colour (a
 * swatch, a chip), in place of the system's picker, that opens Nexa's own
 * (Android's ui/settings/ColourPicker.kt): a square of shades, a strip of hues,
 * opacity for a see-through colour, the hex code to type, and the eyedropper
 * where the browser has one. Every move is handed over as it happens.
 * `shown` draws the colour on the button itself, for a place with nothing
 * else to show it.
 */
export function ColourInput({ value, onChange, alpha = false, disabled = false, shown = false, label, testId, className }: { value: string; onChange: (value: string) => void; alpha?: boolean; disabled?: boolean; shown?: boolean; label: string; testId?: string; className?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={[shown ? s.shown : s.cover, className ?? ""].join(" ")}
        style={shown ? ({ "--chosen": value } as CSSProperties) : undefined}
        disabled={disabled}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => {
          // a label around it passes its own click on as well; one is enough
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        data-testid={testId}
      />
      {open && ref.current ? (
        <Popout anchor={ref.current} onClose={() => setOpen(false)} label={label} prefer="below" testId="colour-picker">
          <ColourPicker value={value} onChange={onChange} alpha={alpha} label={label} />
        </Popout>
      ) : null}
    </>
  );
}

function ColourPicker({ value, onChange, alpha, label }: { value: string; onChange: (value: string) => void; alpha: boolean; label: string }) {
  const start = parseColour(value) ?? { rgb: [128, 0, 255] as Rgb, alpha: 1 };
  // kept here rather than read back from value, so a grey keeps its hue and black its saturation
  const [hsv, setHsv] = useState<Hsv>(() => hsvOf(start.rgb));
  const [opacity, setOpacity] = useState(alpha ? start.alpha : 1);
  const current = toThemeHex(rgbOf(hsv), alpha ? opacity : 1);
  const [text, setText] = useState(current);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(current);
    setBad(false);
  }, [current]);

  const push = (next: Hsv, a = opacity) => {
    setHsv(next);
    setOpacity(a);
    onChange(toThemeHex(rgbOf(next), alpha ? a : 1));
  };
  const commit = (raw: string) => {
    const c = parseColour(raw.startsWith("#") || !/^[0-9a-f]+$/i.test(raw) ? raw : `#${raw}`);
    if (!c) return setBad(raw.trim() !== "");
    setBad(false);
    push(hsvOf(c.rgb), alpha ? c.alpha : 1);
  };
  const rtl = typeof document !== "undefined" && document.dir === "rtl";
  const pure = toHex(rgbOf({ h: hsv.h, s: 1, v: 1 }));
  const solid = toHex(rgbOf(hsv));
  const dropper = eyeDropper();

  return (
    <div className={s.picker} style={{ "--pure": pure, "--solid": solid, "--current": current } as CSSProperties}>
      <Area
        label={t("colourPicker.shade")}
        x={rtl ? 1 - hsv.s : hsv.s}
        y={1 - hsv.v}
        text={`${Math.round(hsv.s * 100)}%, ${Math.round(hsv.v * 100)}%`}
        onMove={(x, y) => push({ ...hsv, s: rtl ? 1 - x : x, v: 1 - y })}
      />
      <Strip label={t("colourPicker.hue")} at={hsv.h / 360} text={`${Math.round(hsv.h)}°`} className={s.hue} rtl={rtl} onMove={(f) => push({ ...hsv, h: Math.min(359.9, f * 360) })} />
      {alpha ? <Strip label={t("settings.themeBuilder.opacityOf", { name: label })} at={opacity} text={`${Math.round(opacity * 100)}%`} className={s.alpha} rtl={rtl} onMove={(f) => push(hsv, Math.round(f * 100) / 100)} /> : null}
      <div className={s.foot}>
        <span className={s.now} aria-hidden="true" />
        <input
          className={s.hex}
          value={text}
          dir="ltr"
          spellCheck={false}
          aria-label={t("settings.themeBuilder.hexFor", { name: label })}
          aria-invalid={bad || undefined}
          maxLength={9}
          onChange={(e) => {
            setText(e.target.value);
            if (/^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.test(e.target.value.trim())) commit(e.target.value.trim());
          }}
          onBlur={() => commit(text.trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(text.trim());
          }}
          data-testid="colour-picker-hex"
        />
        {dropper ? (
          <button
            type="button"
            className={s.drop}
            aria-label={t("colourPicker.eyedropper")}
            title={t("colourPicker.eyedropper")}
            onClick={() => {
              void new dropper().open().then((r) => commit(r.sRGBHex), () => undefined);
            }}
          >
            <Pipette size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Follows a pointer held down on an element, as fractions of its box. */
function drag(e: PointerEvent<HTMLElement>, onMove: (x: number, y: number) => void) {
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  const at = (ev: { clientX: number; clientY: number }) => {
    const r = el.getBoundingClientRect();
    onMove(clamp((ev.clientX - r.left) / r.width), clamp((ev.clientY - r.top) / r.height));
  };
  at(e);
  const move = (ev: globalThis.PointerEvent) => at(ev);
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

/** The square: saturation across, brightness down. The arrow keys move it a step, with Shift ten. */
function Area({ label, x, y, text, onMove }: { label: string; x: number; y: number; text: string; onMove: (x: number, y: number) => void }) {
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    onMove(clamp(x + m[0]), clamp(y + m[1]));
  };
  return (
    <div className={s.area} role="slider" tabIndex={0} aria-label={label} aria-valuetext={text} aria-valuenow={Math.round(x * 100)} onPointerDown={(e) => drag(e, onMove)} onKeyDown={key}>
      <span className={s.knob} style={{ left: `${x * 100}%`, top: `${y * 100}%` }} aria-hidden="true" />
    </div>
  );
}

/** A strip from 0 to 1 (hue, opacity), dragged or moved with the arrow keys. */
function Strip({ label, at, text, className, rtl, onMove }: { label: string; at: number; text: string; className: string | undefined; rtl: boolean; onMove: (f: number) => void }) {
  const shownAt = rtl ? 1 - at : at;
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    onMove(clamp(at + dir * step * (rtl && (e.key === "ArrowLeft" || e.key === "ArrowRight") ? -1 : 1)));
  };
  return (
    <div className={[s.strip, className].join(" ")} role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(at * 100)} aria-valuetext={text} onPointerDown={(e) => drag(e, (x) => onMove(rtl ? 1 - x : x))} onKeyDown={key}>
      <span className={s.thumb} style={{ left: `${shownAt * 100}%` }} aria-hidden="true" />
    </div>
  );
}
