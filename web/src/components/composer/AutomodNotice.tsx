import { ShieldAlert, X } from "lucide-react";
import { t } from "@/i18n";
import type { AutomodNotice as Notice } from "@/stores/automodNotices";
import s from "./Composer.module.css";

/** What a rule looks for, said to the person it stopped. */
export function automodReason(kind: string, matched?: string): string {
  switch (kind) {
    case "words":
    case "flagged_words":
      return matched ? t("automod.reason.words", { word: matched.replace(/^\*|\*$/g, "") }) : t("automod.reason.wordsPlain");
    case "links":
      return t("automod.reason.links");
    case "invites":
      return t("automod.reason.invites");
    case "personal":
      return t("automod.reason.personal");
    case "caps":
      return t("automod.reason.caps");
    case "emoji_spam":
      return t("automod.reason.emoji");
    case "attachments":
      return matched ? t("automod.reason.file", { name: matched }) : t("automod.reason.filePlain");
    case "spam":
      return t("automod.reason.spam");
    case "mentions":
      return t("automod.reason.mentions");
    case "flood":
      return t("automod.reason.flood");
    default:
      return t("automod.reason.other");
  }
}

/**
 * Above the box: AutoMod stopped the last message, with the server's own
 * words for why when it has some, and what the rule caught. What was typed
 * stays in the box to be changed.
 */
export function AutomodNotice({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const reason = automodReason(notice.kind, notice.matched);
  return (
    <div className={[s.notice, s.automodNotice].join(" ")} role="alert" data-testid="automod-notice">
      <ShieldAlert size={18} className={s.automodIcon} aria-hidden="true" />
      <span className={s.noticeText}>
        <span className={s.automodLead}>{t("automod.notice.stopped")}</span>{" "}
        {notice.message ? (
          <>
            <span dir="auto">{notice.message}</span>
            <span className={s.automodWhy}>{reason}</span>
          </>
        ) : (
          <span>{reason}</span>
        )}
      </span>
      <button type="button" className={[s.closeBtn, s.noticeClose].join(" ")} aria-label={t("composer.composer.dismiss")} onClick={onDismiss}>
        <X size={16} />
      </button>
    </div>
  );
}
