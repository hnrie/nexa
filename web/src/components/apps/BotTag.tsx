import { t } from "@/i18n";
import { isBot } from "@/lib/botCopies";
import { useUsers } from "@/stores/users";
import s from "@/components/chat/webhook/Webhook.module.css";

/** The tag beside an app's bot wherever its name is listed (member lists, conversations): nothing for a person. */
export function BotTag({ userId }: { userId: string }) {
  const bot = useUsers((u) => isBot(u.byId[userId]));
  return bot ? <span className={s.appTag} data-testid="bot-tag">{t("webhook.appTag")}</span> : null;
}
