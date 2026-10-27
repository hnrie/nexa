import { useMediaAnimation } from "@/lib/mediaAnimation";
import { emojiUrl } from "@/api/users";
import { Twemoji } from "@/components/common/Twemoji";

/** A custom emoji as a status carries it: the token a message writes it as (<:name:id>, <a:name:id> when it moves). */
export function statusCustomEmoji(emoji: string): { name: string; id: string; animated: boolean } | null {
  const m = /^<(a?):(\w+):(\d+)>$/.exec(emoji);
  return m ? { name: m[2]!, id: m[3]!, animated: m[1] === "a" } : null;
}

/** A status's emoji as words: a custom one by its :name:. */
export function statusEmojiText(emoji: string): string {
  const custom = statusCustomEmoji(emoji);
  return custom ? `:${custom.name}:` : emoji;
}

/** A status's emoji: a standard one drawn as Twemoji, a server's or a pack's own as its picture. */
export function StatusEmoji({ emoji, className, title }: { emoji: string; className?: string; title?: string }) {
  useMediaAnimation();
  const custom = statusCustomEmoji(emoji);
  if (custom) {
    const name = `:${custom.name}:`;
    return <img className={className} src={emojiUrl(custom.id, custom.animated, 48)} alt={name} title={title ?? name} draggable={false} />;
  }
  return <Twemoji text={emoji} className={className} title={title} />;
}
