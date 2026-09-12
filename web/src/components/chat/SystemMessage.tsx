import { ArrowLeftFromLine, ArrowRightToLine, Phone, Pin } from "lucide-react";
import type { DecryptedMessage } from "@/stores/messages";
import { useUI } from "@/stores/ui";
import { useUsers, displayName } from "@/stores/users";
import { formatTimestamp } from "@/lib/time";
import s from "./Chat.module.css";

export function SystemMessage({ msg }: { msg: DecryptedMessage }) {
  const users = useUsers((u) => u.byId);
  const openModal = useUI((u) => u.openModal);
  const setJumpTo = useUI((u) => u.setJumpTo);
  const actor = displayName(users[msg.author_id]);
  const target = msg.mentions[0] ? displayName(users[msg.mentions[0]]) : "someone";
  const A = <b onClick={() => openModal("profile", { userId: msg.author_id })}>{actor}</b>;
  const T = <b onClick={() => msg.mentions[0] && openModal("profile", { userId: msg.mentions[0] })}>{target}</b>;
  let icon = <ArrowRightToLine size={18} />;
  let body: React.ReactNode;
  switch (msg.type) {
    case "system_member_add":
      body = <>{A} added {T} to the group.</>;
      break;
    case "system_member_remove":
      icon = <ArrowLeftFromLine size={18} />;
      body = msg.mentions[0] === msg.author_id ? <>{A} left the group.</> : <>{A} removed {T} from the group.</>;
      break;
    case "system_pin":
      icon = <Pin size={18} />;
      body = (
        <>
          {A} pinned <span className={s.sysLink} onClick={() => msg.reply_to_id && setJumpTo({ channelId: msg.channel_id, messageId: msg.reply_to_id })}>a message</span> to this channel.
        </>
      );
      break;
    case "system_join":
      body = <>{A} joined.</>;
      break;
    case "system_call":
      icon = <Phone size={18} />;
      body = <>{A} started a call.</>;
      break;
    default:
      body = <>{A} did something.</>;
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
