/**
 * The hang-up glyph: a handset turned down, the way every call app draws it.
 * Lucide's phone-off puts a slash corner to corner, which fills more of the
 * box than the icons beside it and leaves the handset sitting off to one side.
 */
import { Phone } from "lucide-react";
import s from "./Voice.module.css";

export function HangUp({ size = 22 }: { size?: number }) {
  return <Phone size={size} className={s.hangUp} aria-hidden="true" />;
}
