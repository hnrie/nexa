import { Avatar } from "@/components/common/Avatar";
import { Toggle } from "@/components/common/Toggle";
import { useAuth } from "@/stores/auth";
import { useSettings, type Theme } from "@/stores/settings";
import s from "./Settings.module.css";

const THEMES: { id: Theme; name: string; colors: string[] }[] = [
  { id: "dark", name: "Dark", colors: ["#2c2d32", "#323339", "#393a41"] },
  { id: "light", name: "Light", colors: ["#f3f3f4", "#ffffff", "#ebeced"] },
  { id: "ash", name: "Ash", colors: ["#1a1a1e", "#232428", "#27272c"] },
  { id: "onyx", name: "Onyx", colors: ["#000000", "#000000", "#131416"] },
  { id: "system", name: "Sync with system", colors: ["#2c2d32", "#f3f3f4", "#5865f2"] },
];
const ACCENTS = ["#5865f2", "#3d9e60", "#fdb833", "#da3e44", "#eb459f", "#1abc9c", "#e67e22", "#9b59b6", "#3498db", "#e91e63"];

export default function AppearancePage() {
  const me = useAuth((a) => a.me);
  const st = useSettings((x) => x.settings);
  const patch = useSettings((x) => x.patch);
  const px = Math.round(st.fontScale * 16);
  return (
    <>
      <h2 className={s.title}>Appearance</h2>
      <div className={s.previewMsg} style={{ fontSize: `${px}px` }}>
        <Avatar id={me?.id ?? "0"} avatarId={me?.avatar_id ?? null} name={me?.display_name ?? "You"} size={40} />
        <div>
          <span className={s.previewName}>{me?.display_name ?? "You"}</span>
          <span className={s.previewTime}>Today at 4:20 PM</span>
          <div className={s.previewText}>Look at me I'm a beautiful butterfly. Fluttering in the moonlight 🌝</div>
          <div className={s.previewText}>Waiting for the day when</div>
        </div>
      </div>
      <h3 className={s.h5}>Theme</h3>
      <div className={s.themes}>
        {THEMES.map((t) => (
          <button key={t.id} className={s.themeCard} data-on={st.theme === t.id} onClick={() => patch({ theme: t.id })}>
            <div className={s.themeSwatch}>{t.colors.map((c, i) => <i key={i} style={{ background: c }} />)}</div>
            <div className={s.themeName}>{t.name}</div>
          </button>
        ))}
      </div>
      <h3 className={s.h5}>Accent colour</h3>
      <div className={s.swatches}>
        <button className={s.swatch} data-on={st.accent === null} style={{ background: "#5865f2" }} title="Default" onClick={() => patch({ accent: null })} />
        {ACCENTS.map((c) => <button key={c} className={s.swatch} data-on={st.accent === c} style={{ background: c }} title={c} onClick={() => patch({ accent: c })} />)}
        <label className={s.swatch} title="Custom" style={{ background: st.accent && !ACCENTS.includes(st.accent) ? st.accent : "linear-gradient(135deg,#f00,#0f0,#00f)" }}>
          <input type="color" value={st.accent ?? "#5865f2"} onChange={(e) => patch({ accent: e.target.value })} />
        </label>
      </div>
      <h3 className={s.h5}>Message display</h3>
      {(["cozy", "compact"] as const).map((m) => (
        <label key={m} className={s.radio} data-on={st.messageDisplay === m}>
          <input type="radio" name="display" checked={st.messageDisplay === m} onChange={() => patch({ messageDisplay: m })} />
          <span className={s.radioText}>
            <span className={s.radioLabel}>{m === "cozy" ? "Cozy" : "Compact"}</span>
            <span className={s.radioDesc}>{m === "cozy" ? "Modern, beautiful, and easy on your eyes." : "Fit more messages on screen at one time. #IRC"}</span>
          </span>
        </label>
      ))}
      <h3 className={s.h5}>Chat font scaling — {px}px</h3>
      <input className={s.slider} type="range" min={12} max={20} step={1} value={px} onChange={(e) => patch({ fontScale: Number(e.target.value) / 16 })} aria-label="Font size" />
      <h3 className={s.h5}>Accessibility</h3>
      <Toggle checked={st.reducedMotion} onChange={(v) => patch({ reducedMotion: v })} label="Reduced motion" description="Disables animations and transitions." />
      <Toggle checked={st.underlineLinks} onChange={(v) => patch({ underlineLinks: v })} label="Always underline links" description="Makes links easier to spot in messages." />
    </>
  );
}
