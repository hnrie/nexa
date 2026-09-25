import { ArrowLeftFromLine, ArrowRightToLine, Pin } from "lucide-react";
import { CallLine } from "@/components/voice/CallLine";
import type { DecryptedMessage } from "@/stores/messages";
import { useUI } from "@/stores/ui";
import { useUsers, displayName } from "@/stores/users";
import { formatTimestamp } from "@/lib/time";
import s from "./Chat.module.css";

import { t, Tr } from "@/i18n";
export function SystemMessage({ msg }: { msg: DecryptedMessage }) {
  const users = useUsers((u) => u.byId);
  const openModal = useUI((u) => u.openModal);
  const setJumpTo = useUI((u) => u.setJumpTo);
  const actor = displayName(users[msg.author_id]);
  const target = msg.mentions[0] ? displayName(users[msg.mentions[0]]) : t("chat.systemMessage.someone");
  const A = <b onClick={() => openModal("profile", { userId: msg.author_id })}>{actor}</b>;
  const T = <b onClick={() => msg.mentions[0] && openModal("profile", { userId: msg.mentions[0] })}>{target}</b>;
  let icon = <ArrowRightToLine size={18} />;
  let body: React.ReactNode;
  switch (msg.type) {
    case "system_member_add":
      body = <Tr id="chat.systemMessage.addedToGroup" values={{ actor: A, target: T }} />;
      break;
    case "system_member_remove":
      icon = <ArrowLeftFromLine size={18} />;
      body = msg.mentions[0] === msg.author_id
        ? <Tr id="chat.systemMessage.leftGroup" values={{ actor: A }} />
        : <Tr id="chat.systemMessage.removedFromGroup" values={{ actor: A, target: T }} />;
      break;
    case "system_pin":
      icon = <Pin size={18} />;
      body = (
        <Tr
          id="chat.systemMessage.pinned"
          values={{
            actor: A,
            message: (
              <span className={s.sysLink} onClick={() => msg.reply_to_id && setJumpTo({ channelId: msg.channel_id, messageId: msg.reply_to_id })}>
                {t("chat.systemMessage.aMessage")}
              </span>
            ),
          }}
        />
      );
      break;
    case "system_join":
      body = <Tr id="chat.systemMessage.joined" values={{ actor: A }} />;
      break;
    case "system_call":
      // told from where the reader stands, from the summary its caller sealed onto it
      return <CallLine msg={msg} />;
    default:
      body = <Tr id="chat.systemMessage.didSomething" values={{ actor: A }} />;
  }
  return (
    <div className={s.system} data-id={msg.id}>
      <span className={s.sysIcon}>{icon}</span>
      <span>
        {body}
        <span className={s.time}>{formatTimestamp(msg.created_at)}</span>
      </span>
    </div>
  );
}
