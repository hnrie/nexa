import { SmilePlus } from "lucide-react";
import { useState } from "react";
import { messages as messagesApi } from "@/api/messages";
import { emojiUrl } from "@/api/users";
import { Twemoji } from "@/components/common/Twemoji";
import { Tooltip } from "@/components/common/Tooltip";
import { ExpressionPicker } from "@/components/pickers/ExpressionPicker";
import type { EmojiPick } from "@/components/pickers/EmojiPicker";
import { useAuth } from "@/stores/auth";
import { emojiReactionKey } from "@/stores/expressions";
import { useMessages, type DecryptedMessage } from "@/stores/messages";
import { useUI } from "@/stores/ui";
import { useUsers, displayName } from "@/stores/users";
import s from "./Chat.module.css";

import { t } from "@/i18n";
/**
 * The reaction key for a pick. Pack emoji arrive as a bare <a?:name:id> token
 * without `custom`, and the key must not keep the angle brackets.
 */
export function reactionKeyOf(e: EmojiPick): string {
  if (e.custom) return emojiReactionKey(e.custom);
  const m = /^<(a?):(\w+):(\d+)>$/.exec(e.unicode);
  return m ? `${m[1]}:${m[2]}:${m[3]}` : e.unicode;
}

function isCustom(emoji: string): { id: string; name: string; animated: boolean } | null {
  const m = /^(a?):?([\w]+):(\d+)$/.exec(emoji);
  if (!m) return null;
  return { id: m[3]!, name: m[2]!, animated: m[1] === "a" };
}

/** How a reaction is named to people: a custom emoji by its :name:, not by the key the server stores. */
function emojiLabel(emoji: string): string {
  const custom = isCustom(emoji);
  return custom ? `:${custom.name}:` : emoji;
}

/** Toggles a reaction with optimistic UI; reverts on failure. */
export async function toggleReaction(msg: DecryptedMessage, emoji: string): Promise<void> {
  const me = useAuth.getState().me;
  if (!me) return;
  const has = msg.reactions.some((r) => r.emoji === emoji && r.me);
  const store = useMessages.getState();
  store.setReaction(msg.channel_id, msg.id, emoji, me.id, !has, true);
  try {
    if (has) await messagesApi.unreact(msg.channel_id, msg.id, emoji);
    else await messagesApi.react(msg.channel_id, msg.id, emoji);
  } catch (err) {
    store.setReaction(msg.channel_id, msg.id, emoji, me.id, has, true);
    useUI.getState().toast(err instanceof Error ? err.message : t("chat.reactions.couldNotReact"), "error");
  }
}

interface Props {
  msg: DecryptedMessage;
  pickerAnchor: DOMRect | null;
  onOpenPicker: (anchor: DOMRect) => void;
  onPickerClose: () => void;
}

export function Reactions({ msg, pickerAnchor, onOpenPicker, onPickerClose }: Props) {
  const users = useUsers((u) => u.byId);
  const [who, setWho] = useState<Record<string, string>>({});
  const closePicker = onPickerClose;
  if (msg.reactions.length === 0 && !pickerAnchor) return null;
  // who reacted, asked for once per emoji and count: a count that moved means
  // the list did too, where it used to be kept from the first look for good
  const lookup = async (emoji: string, count: number): Promise<string | null> => {
    const key = `${emoji}:${count}`;
    if (who[key]) return who[key]!;
    try {
      const ids = await messagesApi.reactors(msg.channel_id, msg.id, emoji, 20);
      const names = ids.map((id) => displayName(users[id])).join(", ");
      setWho((w) => ({ ...w, [key]: names }));
      return names;
    } catch {
      /* the label stays generic */
      return null;
    }
  };
  // A long press (or right click) says who reacted: there is no hover on a
  // touch screen, and a tooltip never shows there.
  const tell = async (e: React.MouseEvent, emoji: string, count: number) => {
    e.preventDefault();
    e.stopPropagation();
    const names = await lookup(emoji, count);
    if (names) useUI.getState().toast(t("chat.reactions.reactedWith", { who: names, emoji: emojiLabel(emoji) }), "info");
  };
  return (
    <div className={s.reactions}>
      {msg.reactions.map((r) => {
        const custom = isCustom(r.emoji);
        const label = emojiLabel(r.emoji);
        const names = who[`${r.emoji}:${r.count}`];
        // the app's own tooltip, as on the toolbar above: it says who, once they are known
        return (
          <Tooltip key={r.emoji} text={names ? t("chat.reactions.reactedWith", { who: names, emoji: label }) : t("chat.reactions.reactWith", { emoji: label })} side="top">
            <button
              className={s.pill}
              data-me={r.me}
              aria-pressed={r.me}
              onMouseEnter={() => void lookup(r.emoji, r.count)}
              onFocus={() => void lookup(r.emoji, r.count)}
              onContextMenu={(e) => void tell(e, r.emoji, r.count)}
              onClick={() => void toggleReaction(msg, r.emoji)}
            >
              {custom ? <img src={emojiUrl(custom.id, custom.animated, 24)} alt={label} /> : <Twemoji text={r.emoji} className={s.pillImg} fallbackClassName={s.pillEmoji} title="" />}
              <span>{r.count}</span>
            </button>
          </Tooltip>
        );
      })}
      {msg.reactions.length > 0 ? (
        <button className={s.addReact} aria-label={t("chat.reactions.addReaction")} onClick={(e) => onOpenPicker(e.currentTarget.getBoundingClientRect())}><SmilePlus size={16} /></button>
      ) : null}
      {pickerAnchor ? <ExpressionPicker anchor={pickerAnchor} onClose={closePicker} onEmoji={(e) => { closePicker(); void toggleReaction(msg, reactionKeyOf(e)); }} /> : null}
    </div>
  );
}
