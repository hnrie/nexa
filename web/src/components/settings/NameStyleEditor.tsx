import { Check, Dices, Heart, Lock, Minus, Pipette, Plus, RotateCcw } from "lucide-react";
import { ColourInput } from "@/components/common/ColourInput";
import { Button } from "@/components/common/Button";
import { t } from "@/i18n";
import { nameClass, nameStyle } from "@/lib/roleLook";
import { myLimits } from "@/lib/plans";
import { offerPlan } from "@/stores/upsell";
import { nameStyleAnimated, NAME_EFFECTS, NAME_FONTS, NAME_PALETTES, NAME_SWATCHES, surpriseStyle, withEffect, type NameStyle } from "@/lib/nameStyle";
import n from "./NameStyle.module.css";

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
const num = (h: string) => parseInt(h.slice(1), 16);
const PLAIN: NameStyle = { font: "", effect: "solid", colors: [] };

/**
 * Settings, Profiles, Name Style: the font, the effect and its colours. Every
 * choice goes straight to the profile being edited, whose preview beside it
 * shows the name as people will see it, and waits for Save Changes with the
 * rest. Where no preview is in sight (a phone's sheet) the name is drawn
 * large on a plate above the choices.
 */
export function NameStyleEditor({ value, onChange, name, plate = false }: { value: NameStyle | null; onChange: (s: NameStyle | null) => void; name: string; plate?: boolean }) {
  const style = value ?? PLAIN;
  const spec = NAME_EFFECTS.find((e) => e.id === style.effect)!;
  const many = spec.max > 1;
  const set = (next: NameStyle) => onChange(!next.font && next.effect === "solid" && next.colors.length === 0 ? null : next);
  const setStyle = (f: (s: NameStyle) => NameStyle) => set(f(style));
  const setColors = (colors: number[]) => set({ ...style, colors });
  const look = { own: style };
  // the effects that come with a plan are shown to everyone, locked without one
  const paid = myLimits().name_effects;

  return (
    <div className={n.controls}>
      {plate ? (
        <div className={n.plate} aria-hidden="true" data-testid="name-style-preview">
          <span className={nameClass(look)} style={nameStyle(look)} dir="auto">{name}</span>
        </div>
      ) : null}
      <div className={n.actions}>
        <Button size="sm" variant="secondary" onClick={() => set(surpriseStyle(Math.random, paid))} data-testid="name-style-surprise">
          <Dices size={15} aria-hidden="true" /> {t("nameStyle.surprise")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)} disabled={!value} data-testid="name-style-reset">
          <RotateCcw size={14} aria-hidden="true" /> {t("nameStyle.reset")}
        </Button>
      </div>
      <section aria-labelledby="ns-font">
        <h3 className={n.heading} id="ns-font">{t("nameStyle.font")}</h3>
        <div className={n.fonts} role="radiogroup" aria-labelledby="ns-font">
          {NAME_FONTS.map((f) => {
            const label = f.id ? f.label : t("nameStyle.defaultFont");
            const sample = { own: { font: f.id, effect: "solid" as const, colors: [] } };
            return (
              <button key={f.id || "default"} type="button" role="radio" aria-checked={style.font === f.id} aria-label={label} title={label} className={n.tile} onClick={() => setStyle((s) => ({ ...s, font: f.id }))} data-testid={`name-font-${f.id || "default"}`}>
                <span className={[n.glyph, nameClass(sample)].join(" ")} style={nameStyle(sample)} aria-hidden="true">Ag</span>
                <span className={n.fontName} aria-hidden="true">{label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="ns-effect">
        <h3 className={n.heading} id="ns-effect">{t("nameStyle.effect")}</h3>
        <div className={n.effects} role="radiogroup" aria-labelledby="ns-effect">
          {NAME_EFFECTS.map((e) => {
            const sample = { own: { font: "", effect: e.id, colors: e.id === "solid" ? [] : e.start, animated: style.animated } };
            return (
              <button
                key={e.id}
                type="button"
                role="radio"
                aria-checked={style.effect === e.id}
                className={[n.tile, n.effectTile].join(" ")}
                onClick={() => (e.paid && !paid ? offerPlan({ kind: "effect" }) : setStyle((s) => withEffect(s, e.id)))}
                data-testid={`name-effect-${e.id}`}
                data-locked={(e.paid && !paid) || undefined}
              >
                <span className={nameClass(sample)} style={nameStyle(sample)}>{t(`nameStyle.effects.${e.id}`)}</span>
                {e.paid ? (
                  <span className={n.planMark} title={t("support.effects.withPlan")} aria-label={t("support.effects.withPlan")}>
                    {paid ? <Heart size={11} fill="currentColor" aria-hidden="true" /> : <Lock size={11} aria-hidden="true" />}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      {style.effect !== "solid" ? (
        <section aria-labelledby="ns-motion">
          <h3 className={n.heading} id="ns-motion">{t("nameStyle.motion")}</h3>
          <div className={n.motion} role="radiogroup" aria-labelledby="ns-motion">
            {[false, true].map((animated) => (
              <button key={String(animated)} type="button" role="radio" aria-checked={nameStyleAnimated(style) === animated} className={n.tile} onClick={() => setStyle((s) => ({ ...s, animated }))} data-testid={`name-motion-${animated ? "animated" : "static"}`}>
                {t(animated ? "nameStyle.animated" : "nameStyle.static")}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="ns-colour">
        <h3 className={n.heading} id="ns-colour">{many ? t("nameStyle.colours") : t("nameStyle.colour")}</h3>
        {many ? (
          <div className={n.manyRow}>
            <div className={n.bar} style={{ background: `linear-gradient(90deg, ${style.colors.map(hex).join(", ")})` }} data-testid="name-style-stops">
              {style.colors.map((c, i) => (
                <span key={i} className={n.stop}>
                  <label className={n.stopPick} style={{ background: hex(c) }} title={t("nameStyle.pickColour")}>
                    <Pipette size={15} aria-hidden="true" />
                    <ColourInput value={hex(c)} label={t("nameStyle.stopColour", { index: i + 1 })} onChange={(v) => setColors(style.colors.map((x, j) => (j === i ? num(v) : x)))} />
                  </label>
                  {style.colors.length > spec.min ? (
                    <button type="button" className={n.stopDrop} aria-label={t("nameStyle.removeColour", { index: i + 1 })} onClick={() => setColors(style.colors.filter((_, j) => j !== i))}>
                      <Minus size={11} aria-hidden="true" />
                    </button>
                  ) : null}
                </span>
              ))}
              {style.colors.length < spec.max ? (
                <button type="button" className={n.stopAdd} aria-label={t("nameStyle.addColour")} onClick={() => setColors([...style.colors, style.colors[style.colors.length - 1] ?? 0xffffff])} data-testid="name-style-add-stop">
                  <Plus size={15} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <div className={n.palettes} role="radiogroup" aria-label={t("nameStyle.readyMade")}>
              {(NAME_PALETTES[style.effect] ?? []).map((p, i) => {
                const on = JSON.stringify(p.slice(0, spec.max)) === JSON.stringify(style.colors);
                return (
                  <button key={i} type="button" role="radio" aria-checked={on} aria-label={t("nameStyle.paletteN", { index: i + 1 })} className={n.palette} style={{ background: style.effect === "candy" ? `linear-gradient(90deg, ${p.map((c, k) => `${hex(c)} ${(k * 100) / p.length}% ${((k + 1) * 100) / p.length}%`).join(", ")})` : `linear-gradient(90deg, ${p.map(hex).join(", ")})` }} onClick={() => setColors(p.slice(0, spec.max))}>
                    {on ? <Check size={16} strokeWidth={3} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className={n.swatches} role="radiogroup" aria-labelledby="ns-colour">
            {style.effect === "solid" ? (
              <button type="button" role="radio" aria-checked={style.colors.length === 0} className={[n.swatch, n.swatchPlain].join(" ")} aria-label={t("nameStyle.usualColour")} title={t("nameStyle.usualColour")} onClick={() => setColors([])}>
                {style.colors.length === 0 ? <Check size={16} strokeWidth={3} aria-hidden="true" /> : "Aa"}
              </button>
            ) : null}
            <label className={[n.swatch, n.swatchCustom].join(" ")} data-on={style.colors.length === 1 && !NAME_SWATCHES.includes(style.colors[0]!)} style={style.colors.length === 1 && !NAME_SWATCHES.includes(style.colors[0]!) ? { background: hex(style.colors[0]!) } : undefined} title={t("nameStyle.pickColour")}>
              <Pipette size={16} aria-hidden="true" />
              <ColourInput value={hex(style.colors[0] ?? 0x8a6cf2)} label={t("nameStyle.pickColour")} onChange={(v) => setColors([num(v)])} testId="name-style-colour" />
            </label>
            {NAME_SWATCHES.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={style.colors[0] === c} aria-label={hex(c)} className={n.swatch} style={{ background: hex(c) }} onClick={() => setColors([c])}>
                {style.colors[0] === c ? <Check size={16} strokeWidth={3} aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
        )}
      </section>
      <p className={n.note}>{t("nameStyle.note")}</p>
    </div>
  );
}
