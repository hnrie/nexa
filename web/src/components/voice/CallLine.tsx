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

/** What a call came to, for the colour of its line: talked, missed, turned down, or nothing yet. */
type Tone = "talked" | "missed" | "declined" | "plain";

/**
 * A call's line in a conversation, told from where the reader stands:
 * "Missed call from Alice" for someone who never picked up, "Call with Bob"
 * and how long it lasted for the people who talked, "Bob declined your call"
 * for the caller. It reads from the summary the caller sealed onto the line
 * once the call was over; a line without one says only that the call was
 * started, and that it is going on, while it is.
 *
 * What the call came to is said beside the sentence, in a tag of its own,
 * rather than joined onto it with a dot ("started a call · no one answered").
 * The sentence, the tag and the time sit on one line, each centred on it,
 * with the icon centred beside them.
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
    <button type="button" className={chat.sysName} dir="auto" onClick={() => openModal("profile", { userId: id })}>
      {displayName(users[id])}
    </button>
  );
  const A = person(caller);
  const dm = channel?.type === "dm";
  // in a DM, the other side of the call from where the reader stands
  const other = dm ? channel.recipient_ids.find((id) => id !== meId) : undefined;
  const O = other ? person(other) : A;
  let icon: ReactNode = <Phone size={16} />;
  let body: ReactNode = <Tr id="voice.callLine.startedCall" values={{ actor: A }} />;
  let detail: string | null = null;
  let tone: Tone = "plain";
  let again: "back" | "again" | null = null;
  if (summary && meId) {
    const length = formatCallLength(summary.duration);
    const mine = caller === meId;
    if (summary.outcome === "answered" && (mine || summary.joined.includes(meId) || !dm)) {
      tone = "talked";
      if (dm) {
        icon = mine ? <PhoneOutgoing size={16} /> : <PhoneIncoming size={16} />;
        body = <Tr id="voice.callLine.callWithName" values={{ name: O }} />;
        detail = length;
      } else detail = t("voice.callLine.lasted", { length });
    } else if (mine) {
      again = "again";
      if (dm && summary.outcome === "declined") {
        tone = "declined";
        icon = <PhoneOff size={16} />;
        body = <Tr id="voice.callLine.declinedYourCall" values={{ name: O }} />;
      } else {
        icon = <PhoneOutgoing size={16} />;
        if (dm) {
          body = <Tr id="voice.callLine.youCalledName" values={{ name: O }} />;
          detail = summary.outcome === "cancelled" ? t("voice.callLine.cancelled") : t("voice.callLine.noAnswer");
        } else detail = t("voice.callLine.noOneJoined");
      }
    } else if (summary.declined.includes(meId)) {
      again = "back";
      tone = "declined";
      icon = <PhoneOff size={16} />;
      body = <Tr id="voice.callLine.youDeclined" values={{ name: A }} />;
    } else {
      again = "back";
      tone = "missed";
      icon = <PhoneMissed size={16} />;
      body = <Tr id="voice.callLine.missedFrom" values={{ name: A }} />;
    }
  } else if (busy) {
    // no summary yet: the call this line opened may still be going on
    tone = "talked";
    detail = t("voice.callLine.live");
  }
  return (
    <div className={[chat.system, s.callLine].join(" ")} data-id={msg.id} data-testid="call-line" data-missed={tone === "missed" || undefined} data-tone={tone}>
      <span className={s.callIcon} aria-hidden="true">{icon}</span>
      <span className={s.callWords}>{body}</span>
      {detail ? <span className={s.callDetail} data-testid="call-detail">{detail}</span> : null}
      <span className={[chat.time, s.callTime].join(" ")}>{formatTimestamp(msg.created_at)}</span>
      {again && !busy ? (
        <button type="button" className={s.callAgain} onClick={() => void joinVoice(msg.channel_id)} data-testid="call-again">
          <Phone size={14} aria-hidden="true" />
          {again === "back" ? t("voice.callLine.callBack") : t("voice.callLine.callAgain")}
        </button>
      ) : null}
    </div>
  );
}
