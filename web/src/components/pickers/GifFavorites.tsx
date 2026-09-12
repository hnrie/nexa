import { X } from "lucide-react";
import { useSettings } from "@/stores/settings";
import s from "./Picker.module.css";

export function GifFavorites({ onPick }: { onPick: (url: string) => void }) {
  const favs = useSettings((st) => st.settings.favoriteGifs);
  const patch = useSettings((st) => st.patch);
  return (
    <div className={s.body} style={{ flexDirection: "column" }}>
      {favs.length === 0 ? (
        <div className={s.empty}>No favorite GIFs yet. Hover any GIF in chat and press the star to save it here.</div>
      ) : (
        <div className={s.gifGrid}>
          {favs.map((f) => (
            <div key={f.url} className={s.gifCell}>
              <img src={f.url} alt="" loading="lazy" referrerPolicy="no-referrer" onClick={() => onPick(f.url)} />
              <button className={s.gifRemove} aria-label="Remove favorite" onClick={() => patch({ favoriteGifs: favs.filter((x) => x.url !== f.url) })}><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
