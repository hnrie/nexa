import { Button } from "./Button";
import { t } from "@/i18n";
import s from "./LoadError.module.css";

/**
 * A list that could not be fetched.
 *
 * An empty list and a failed request look identical unless something says
 * otherwise, and the cheerful version — "No one is banned, keep it that way" —
 * is a moderator's cue to stop looking. This says what happened and offers the
 * only thing that helps, which is asking again.
 *
 * `role="alert"` rather than a plain paragraph: the failure usually replaces a
 * spinner, and a screen reader is otherwise told nothing at all.
 */
export function LoadError({ message, onRetry, center = false, busy = false }: { message: string; onRetry?: () => void; center?: boolean; busy?: boolean }) {
  return (
    <div className={[s.block, center ? s.center : ""].join(" ")} role="alert">
      <p className={s.text}>{message}</p>
      {onRetry ? (
        <Button size="sm" variant="secondary" loading={busy} onClick={onRetry}>
          {t("chat.messageList.tryAgain")}
        </Button>
      ) : null}
    </div>
  );
}
