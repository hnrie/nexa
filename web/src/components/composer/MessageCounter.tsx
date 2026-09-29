import { charsLeft, counterShown } from "./limit";
import { t } from "@/i18n";

/**
 * How many characters a message has left, shown near the limit and past it,
 * the same wherever a message is written: the message box, the edit box and
 * the formatting editor. The number is what the eye reads; a screen reader
 * hears the sentence.
 */
export function MessageCounter({ text, className, max }: { text: string; className?: string; max?: number }) {
  if (!counterShown(text, max)) return null;
  const left = charsLeft(text, max);
  return (
    <span className={className} data-over={left < 0} data-testid="message-counter">
      <span aria-hidden="true">{left}</span>
      <span className="visually-hidden">{left < 0 ? t("composer.limit.over", { count: -left }) : t("composer.limit.left", { count: left })}</span>
    </span>
  );
}
