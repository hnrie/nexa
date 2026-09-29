import { Eye, X } from "lucide-react";
import { useMemo } from "react";
import { Avatar } from "@/components/common/Avatar";
import { useShownName } from "@/components/chat/useShownName";
import c from "@/components/chat/Chat.module.css";
import { useRenderCtx } from "@/lib/markdownCtx";
import { Markdown, isEmojiOnly, parse } from "@/markdown";
import { useAuth } from "@/stores/auth";
import { useUsers } from "@/stores/users";
import { extractMentions } from "./mentions";
import { mentionScope } from "./send";
import s from "./Composer.module.css";

import { t } from "@/i18n";

/**
 * The message being written, drawn the way it will look once sent: your
 * picture and name over its words, with their formatting, and the @names,
 * #channels and custom :emoji: made into what sending makes of them. Only
 * the one writing sees it, and nothing is sent until they send it.
 */
export function MessagePreview({ text, channelId, onClose }: { text: string; channelId: string; onClose: () => void }) {
  const me = useAuth((a) => a.me);
  const avatarId = useUsers((u) => (me ? (u.byId[me.id]?.avatar_id ?? me.avatar_id) : null));
  const users = useUsers((u) => u.byId);
  const name = useShownName(channelId, me?.id);
  const ctx = useRenderCtx();
  const source = useMemo(() => extractMentions(text, users, mentionScope(channelId)).text, [text, users, channelId]);
  const jumbo = useMemo(() => isEmojiOnly(parse(source)), [source]);
  if (!me || !source.trim()) return null;
  return (
    <section className={s.preview} aria-label={t("composer.preview.onlyYou")} data-testid="message-preview">
      <div className={s.previewHead}>
        <Eye size={14} aria-hidden="true" />
        <span className={s.previewNote}>{t("composer.preview.onlyYou")}</span>
        <button type="button" className={s.closeBtn} aria-label={t("composer.preview.hide")} title={t("composer.preview.hide")} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className={s.previewMsg}>
        <Avatar id={me.id} avatarId={avatarId} name={name} size={40} />
        <div className={s.previewBody}>
          <div className={s.previewName} dir="auto">{name}</div>
          <div className={[c.content, jumbo ? c.jumbo : ""].join(" ")}>
            <Markdown source={source} ctx={ctx} jumbo={jumbo} />
          </div>
        </div>
      </div>
    </section>
  );
}
