import { Phone, PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing } from "lucide-react";
import type { ReactNode } from "react";
import chat from "@/components/chat/Chat.module.css";
import { formatTimestamp } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import type { DecryptedMessage } from "@/stores/messages";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import { useVoice } from "@/stores/voice";
import { formatCallLength } from "@/voice/callSummary";
import { joinVoice } from "@/voice/session";
import s from "./Voice.module.css";

import { t, Tr } from "@/i18n";

/**
 * A call's line in a conversation, told from where the reader stands:
 * "Missed call from Alice" for someone who never picked up, "Call with Bob ·
 * 12 minutes" for the people who talked, "Bob declined the call" for the
 * caller. It reads from the summary the caller sealed onto the line once the
 * call was over; a line without one says only that the call was started.
 */
export function CallLine({ msg }: { msg: DecryptedMessage }) {
  const meId = useAuth((a) => a.me?.id);
  const users = useUsers((u) => u.byId);
  const channel = useChannels((c) => c.byId[msg.channel_id]);
  const openModal = useUI((u) => u.openModal);
  // a call going on here now is joined from the banner above, not called back
  // (a channel's entry exists only while someone is in its call; this runs on every level update of a call, so it stays cheap)
  const busy = useVoice((v) => v.joining === msg.channel_id || v.mine?.channel_id === msg.channel_id || !!v.byChannel[msg.channel_id]);
  const caller = msg.author_id;
  const summary = msg.call;
  const person = (id: string) => (
    <b dir="auto" onClick={() => openModal("profile", { userId: id })}>
      {displayName(users[id])}
    </b>
  );
  const A = person(caller);
  const dm = channel?.type === "dm";
  // in a DM, the other side of the call from where the reader stands
  const other = dm ? channel.recipient_ids.find((id) => id !== meId) : undefined;
  const O = other ? person(other) : A;
  let icon: ReactNode = <Phone size={18} />;
  let body: ReactNode = <Tr id="chat.systemMessage.startedACall" values={{ actor: A }} />;
  let missed = false;
  let again: "back" | "again" | null = null;
  if (summary && meId) {
    const length = formatCallLength(summary.duration);
    const mine = caller === meId;
    if (summary.outcome === "answered" && (mine || summary.joined.includes(meId) || !dm)) {
      if (dm) {
        icon = mine ? <PhoneOutgoing size={18} /> : <PhoneIncoming size={18} />;
        body = <Tr id="voice.callLine.callWith" values={{ name: O, length }} />;
      } else body = <Tr id="voice.callLine.startedLasting" values={{ actor: A, length }} />;
    } else if (mine) {
      again = "again";
      if (dm && summary.outcome === "declined") {
        icon = <PhoneOff size={18} />;
        body = <Tr id="voice.callLine.theyDeclined" values={{ name: O }} />;
      } else {
        icon = <PhoneOutgoing size={18} />;
        body = dm ? <Tr id={summary.outcome === "cancelled" ? "voice.callLine.youCalledCancelled" : "voice.callLine.youCalledNoAnswer"} values={{ name: O }} /> : <Tr id="voice.callLine.startedNoAnswer" values={{ actor: A }} />;
      }
    } else if (summary.declined.includes(meId)) {
      again = "back";
      icon = <PhoneOff size={18} />;
      body = <Tr id="voice.callLine.youDeclined" values={{ name: A }} />;
    } else {
      again = "back";
      missed = true;
      icon = <PhoneMissed size={18} />;
      body = <Tr id="voice.callLine.missedFrom" values={{ name: A }} />;
    }
  }
  return (
    <div className={chat.system} data-id={msg.id} data-testid="call-line" data-missed={missed || undefined}>
      <span className={[chat.sysIcon, missed ? s.callMissed : ""].join(" ")}>{icon}</span>
      <span>
        {body}
        <span className={chat.time}>{formatTimestamp(msg.created_at)}</span>
      </span>
      {again && !busy ? (
        <button type="button" className={s.callAgain} onClick={() => void joinVoice(msg.channel_id)} data-testid="call-again">
          <Phone size={14} aria-hidden="true" />
          {again === "back" ? t("voice.callLine.callBack") : t("voice.callLine.callAgain")}
        </button>
      ) : null}
    </div>
  );
}
