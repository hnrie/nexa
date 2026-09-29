import type { CSSProperties } from "react";
import { schemeOf } from "@/lib/look/derive";
import { tokenStyle, type TokenMap } from "@/lib/look/tokens";
import s from "./Look.module.css";

/**
 * A theme drawn as a very small Nexa: the server rail, a channel list with
 * one row selected, a conversation with a mention and a link, and the
 * message box. Every part takes its colour from the theme's own tokens, set
 * on this element, so the picture is the theme and not a guess at it.
 */
export function ThemeMiniature({ tokens, className }: { tokens: TokenMap; className?: string }) {
  // the rail's shade is the theme's own sidebar mixed with black, by as much as that theme's scheme mixes it (tokens.css)
  const style = { ...tokenStyle(tokens), "--rail-shade": schemeOf(tokens["bg-raised"]) === "light" ? "95%" : "78%" } as CSSProperties;
  return (
    <span className={[s.mini, className ?? ""].join(" ")} style={style} aria-hidden="true">
      <span className={s.miniRail}>
        <i className={s.miniLogo} />
        <i />
        <i />
      </span>
      <span className={s.miniSide}>
        <i style={{ width: "70%" }} />
        <span className={s.miniSelected}>
          <i />
        </span>
        <i style={{ width: "60%" }} />
        <i style={{ width: "76%" }} />
      </span>
      <span className={s.miniMain}>
        <span className={s.miniMsg}>
          <i className={s.miniAvatar} />
          <span className={s.miniLines}>
            <i className={s.miniName} />
            <span className={s.miniRow}>
              <i className={s.miniText} style={{ width: "34%" }} />
              <i className={s.miniMention} />
              <i className={s.miniText} style={{ width: "22%" }} />
            </span>
            <span className={s.miniRow}>
              <i className={s.miniLink} />
              <i className={s.miniText} style={{ width: "30%" }} />
            </span>
          </span>
        </span>
        <span className={s.miniMsg}>
          <i className={s.miniAvatar} data-alt="" />
          <span className={s.miniLines}>
            <i className={s.miniName} style={{ width: "30%" }} />
            <span className={s.miniRow}>
              <i className={s.miniText} style={{ width: "58%" }} />
            </span>
          </span>
        </span>
        <span className={s.miniComposer}>
          <i />
        </span>
      </span>
    </span>
  );
}

/** Sync with system: the dark one of the pair with the light one laid across it. */
export function SplitMiniature({ dark, light }: { dark: TokenMap; light: TokenMap }) {
  return (
    <span className={s.split} aria-hidden="true">
      <ThemeMiniature tokens={dark} />
      <ThemeMiniature tokens={light} className={s.splitLight} />
    </span>
  );
}
