import { Hash, Lock, Volume2 } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { Channel } from "@/api/types";
import { emojiUrl } from "@/api/users";
import { parseGlyph } from "@/lib/channelGlyph";
import { useExpressions } from "@/stores/expressions";
import { CHANNEL_ICONS } from "./channelIcons";
import { Twemoji } from "./Twemoji";
import s from "./ChannelGlyph.module.css";

interface Props {
  channel: Pick<Channel, "type" | "server_id"> & { glyph?: string | undefined };
  /** How many pixels across it is drawn. */
  size: number;
  /** A private channel: a small lock over the corner. */
  locked?: boolean;
  className?: string;
}

/**
 * What stands before a server channel's name: its own icon when it has one,
 * otherwise the # of a text channel or the speaker of a voice one. A voice
 * channel wearing an icon of its own keeps a small speaker on the corner, so
 * it still reads as a place to talk; a private one shows its lock there.
 * Always decoration: the name beside it says which channel it is.
 */
export function ChannelGlyph({ channel, size, locked = false, className }: Props) {
  const g = parseGlyph(channel.glyph);
  // only the channel's own server's emoji; one that has been deleted falls back to the default
  const custom = useExpressions((x) => (g?.kind === "custom" && channel.server_id ? x.emojis[channel.server_id]?.find((e) => e.id === g.id) : undefined));
  let own: ReactNode = null;
  if (g?.kind === "icon") {
    const Icon = CHANNEL_ICONS[g.name];
    if (Icon) own = <Icon size={size} />;
  } else if (g?.kind === "emoji") {
    own = <Twemoji text={g.text} title="" className={s.picture} fallbackClassName={s.text} />;
  } else if (custom) {
    own = <img className={s.picture} src={emojiUrl(custom.blob_id, custom.animated, size)} alt="" draggable={false} loading="lazy" decoding="async" />;
  }
  const body = own ?? (channel.type === "voice" ? <Volume2 size={size} /> : channel.type === "category" ? null : <Hash size={size} />);
  if (!body) return null;
  const badge = locked ? <Lock size={badgeSize(size)} /> : own && channel.type === "voice" ? <Volume2 size={badgeSize(size)} /> : null;
  return (
    <span className={[s.glyph, className ?? ""].join(" ")} style={{ "--glyph-size": `${size}px` } as CSSProperties} data-own={own ? "true" : undefined} aria-hidden="true">
      {body}
      {badge ? <span className={s.badge}>{badge}</span> : null}
    </span>
  );
}

/** The corner mark: half the glyph, and never so small it turns to a smudge. */
function badgeSize(size: number): number {
  return Math.max(9, Math.round(size / 2));
}
