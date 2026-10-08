import { useEffect, useState } from "react";
import { useLookDraft } from "@/lib/look/draft";
import { activeSeason, type Season } from "@/lib/look/seasonal";
import { useSettings } from "@/stores/settings";
import fall from "@/assets/seasonal/season-fall.svg";
import halloween from "@/assets/seasonal/season-halloween.svg";
import holidays from "@/assets/seasonal/season-holidays.svg";
import spring from "@/assets/seasonal/season-spring.svg";
import summer from "@/assets/seasonal/season-summer.svg";
import valentines from "@/assets/seasonal/season-valentines.svg";
import winter from "@/assets/seasonal/season-winter.svg";
import s from "./SeasonalPerch.module.css";

/** Each season's picture, by the id of the theme it was drawn for (Season.art names one for the night versions). */
const ART: Record<string, string> = {
  "season-halloween": halloween,
  "season-fall": fall,
  "season-winter": winter,
  "season-holidays": holidays,
  "season-valentines": valentines,
  "season-spring": spring,
  "season-summer": summer,
};

/** A seasonal theme's picture. */
export function seasonArt(s: Season): string | undefined {
  return ART[s.art ?? s.id];
}

/** The seasonal theme being worn and in season, if any; not while a theme is being tried on in the builder. */
export function useActiveSeason(): Season | null {
  const theme = useSettings((x) => x.settings.theme);
  const drafting = useLookDraft((d) => d.theme !== null);
  const today = useToday();
  return drafting ? null : activeSeason(theme, today);
}

/** Today, read again every minute, so a season that ends while the app is open takes its picture with it. */
export function useToday(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setNow((prev) => (prev.getDate() === d.getDate() ? prev : d));
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * The seasonal theme's picture, sitting on the top edge of the message box at
 * its end. Only while a seasonal theme is worn and in season, and not while a
 * theme is being tried on in the builder. It is decoration: hidden from screen
 * readers and never in the way of a click.
 */
export function SeasonalPerch() {
  const season = useActiveSeason();
  const art = season ? seasonArt(season) : undefined;
  if (!art) return null;
  return <img className={s.perch} src={art} alt="" aria-hidden="true" draggable={false} data-testid="seasonal-perch" data-season={season!.id} />;
}
