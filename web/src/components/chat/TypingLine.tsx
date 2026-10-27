import { useMediaAnimation } from "@/lib/mediaAnimation";
import type { CSSProperties } from "react";
import { emojiUrl } from "@/api/users";
import { Button } from "@/components/common/Button";
import { Popout } from "@/components/common/Popout";
import { Twemoji } from "@/components/common/Twemoji";
import { t, Tr } from "@/i18n";
import { customEmoji, typingImage, typingImageUrl, typingWordsKey, type TypingStyle } from "@/lib/typingStyle";
import { useUI } from "@/stores/ui";
import c from "./Chat.module.css";
import s from "./Typing.module.css";

/** One emoji of a typing style: an emoji itself, a server or pack emoji's picture, or a picture of the person's own. */
export function TypingEmoji({ token, className }: { token: string; className?: string }) {
  useMediaAnimation();
  const image = typingImage(token);
  if (image) return <img className={className} src={typingImageUrl(image, 32)} alt="" draggable={false} />;
  const custom = customEmoji(token);
  if (custom) return <img className={className} src={emojiUrl(custom.id, custom.animated, 32)} alt={`:${custom.name}:`} draggable={false} />;
  return <Twemoji text={token} className={className} fallbackClassName={className} />;
}

/** The words a style puts after the name, without a trailing "…" the line already adds. */
function ownWords(words: string): string {
  return words.replace(/(?:\.{3}|…)+\s*$/, "");
}

/**
 * Someone typing, drawn their way: their emoji moving as they chose and the
 * words they picked, or the plain dots and "is typing…" for no style at all.
 */
export function StyledTyping({ style, name, size = "line" }: { style: TypingStyle | null; name: string; size?: "line" | "big" }) {
  const { key, words } = typingWordsKey(style);
  return (
    <span className={s.styled} data-size={size}>
      {style && style.emoji.length > 0 ? (
        <span className={s.emoji} data-motion={style.motion} aria-hidden="true">
          {style.emoji.map((e, i) => (
            <span key={i} className={s.slot} style={{ "--i": i } as CSSProperties}>
              <TypingEmoji token={e} className={s.glyph} />
            </span>
          ))}
        </span>
      ) : (
        <span className={c.dots} aria-hidden="true"><i /><i /><i /></span>
      )}
      <span className={s.words}>
        <Tr id={key} values={{ a: <b dir="auto">{name}</b>, ...(words ? { words: <span dir="auto">{ownWords(words)}</span> } : {}) }} />
      </span>
    </span>
  );
}

/**
 * What a press on someone's typing line opens: their style shown off, larger,
 * with the way to make one's own.
 */
export function TypingCard({ anchor, style, name, onClose }: { anchor: HTMLElement; style: TypingStyle; name: string; onClose: () => void }) {
  const openModal = useUI((u) => u.openModal);
  return (
    <Popout anchor={anchor} onClose={onClose} label={t("typing.card.label", { name })} testId="typing-card">
      <div className={s.card}>
        <div className={s.stage}>
          <StyledTyping style={style} name={name} size="big" />
        </div>
        <p className={s.cardText}>{t("typing.card.body")}</p>
        <Button
          size="sm"
          block
          onClick={() => {
            onClose();
            openModal("settings", { page: "profiles", anchor: "typingStyle" });
          }}
          data-testid="typing-make-own"
        >
          {t("typing.card.makeYourOwn")}
        </Button>
      </div>
    </Popout>
  );
}
