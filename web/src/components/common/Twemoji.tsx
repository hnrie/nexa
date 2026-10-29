import { useEffect, useState } from "react";
import { ensureTwemojiIndex, onTwemojiIndexReady, twemojiCandidates, twemojiIndexSettled } from "@/lib/twemoji";

interface Props {
  /** The emoji itself, as text. */
  text: string;
  className?: string;
  title?: string;
  /** Class used when there is no picture and the glyph has to do. */
  fallbackClassName?: string;
  /**
   * A box to draw the picture in, for an emoji in the words of a message. The
   * picture lets the pointer through to the box: pressed on a picture, a
   * browser starts no selection, so a drag that began on an emoji, or across a
   * message of nothing but emoji, selected nothing and could not be copied.
   * The box, or the glyph, is also what EmojiDetails names on hover, so it
   * carries no title of its own.
   */
  boxClassName?: string;
}

/**
 * How often each picture failed to load. One failure can be a phone briefly
 * offline, so a picture is only given up on everywhere after the second.
 */
const failures = new Map<string, number>();

/**
 * One emoji, drawn with Twemoji so it looks the same on every device. If the
 * set has no picture for it, the platform's own glyph is shown instead.
 */
export function Twemoji({ text, className, title, fallbackClassName, boxClassName }: Props) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (twemojiIndexSettled()) return;
    ensureTwemojiIndex();
    return onTwemojiIndexReady(() => bump((n) => n + 1));
  }, []);
  // the glyph stands in for the moment until the list says which pictures exist
  // pictures that failed here are skipped at once, so the next one is tried
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const candidates = twemojiIndexSettled() ? twemojiCandidates(text).filter((u) => !failed.has(u) && (failures.get(u) ?? 0) < 2) : [];
  const src = candidates[0];
  const card = boxClassName ? "unicode" : undefined;
  if (!src) return <span className={fallbackClassName ?? className} data-emoji-fallback="" data-emoji-card={card}>{text}</span>;
  const img = (
    <img
      className={className}
      src={src}
      alt={text}
      title={boxClassName ? undefined : (title ?? text)}
      draggable={false}
      loading="lazy"
      decoding="async"
      onError={() => {
        failures.set(src, (failures.get(src) ?? 0) + 1);
        setFailed((f) => new Set(f).add(src));
      }}
    />
  );
  return boxClassName ? <span className={boxClassName} data-emoji-card={card}>{img}</span> : img;
}
