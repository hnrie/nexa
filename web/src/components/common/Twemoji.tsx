import { useEffect, useState } from "react";
import { ensureTwemojiIndex, onTwemojiIndexReady, twemojiCandidates, twemojiIndexSettled } from "@/lib/twemoji";

interface Props {
  /** The emoji itself, as text. */
  text: string;
  className?: string;
  title?: string;
  /** Class used when there is no picture and the glyph has to do. */
  fallbackClassName?: string;
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
export function Twemoji({ text, className, title, fallbackClassName }: Props) {
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
  if (!src) return <span className={fallbackClassName ?? className}>{text}</span>;
  return (
    <img
      className={className}
      src={src}
      alt={text}
      title={title ?? text}
      draggable={false}
      loading="lazy"
      decoding="async"
      onError={() => {
        failures.set(src, (failures.get(src) ?? 0) + 1);
        setFailed((f) => new Set(f).add(src));
      }}
    />
  );
}
