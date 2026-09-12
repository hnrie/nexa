import { useEffect, useState } from "react";
import { twemojiCandidates } from "@/lib/twemoji";

interface Props {
  /** The emoji itself, as text. */
  text: string;
  className?: string;
  title?: string;
  /** Class used when there is no picture and the glyph has to do. */
  fallbackClassName?: string;
}

/** Names this instance has already been asked for and does not have. */
const missing = new Set<string>();

/**
 * One emoji, drawn with Twemoji so it looks the same on every device. If the
 * set has no picture for it, the platform's own glyph is shown instead.
 */
export function Twemoji({ text, className, title, fallbackClassName }: Props) {
  const candidates = twemojiCandidates(text).filter((u) => !missing.has(u));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setAttempt(0), [text]);
  const src = candidates[attempt];
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
        missing.add(src);
        setAttempt((a) => a + 1);
      }}
    />
  );
}
