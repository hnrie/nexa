import { Phone } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Avatar } from "@/components/common/Avatar";
import { Modal } from "@/components/common/Modal";
import { channelDisplayName } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { displayName, useUsers } from "@/stores/users";
import { useVoice } from "@/stores/voice";
import { declineCall, joinVoice } from "@/voice/session";
import { HangUp } from "./HangUp";
import s from "./Voice.module.css";

/** Rings for incoming DM calls; accept joins the DM's voice, decline tells the caller. */
export function IncomingCallHost() {
  const ringing = useVoice((v) => v.ringing);
  const users = useUsers((u) => u.byId);
  const channels = useChannels((c) => c.byId);
  const meId = useAuth((a) => a.me?.id);
  const nav = useNavigate();
  const entry = Object.entries(ringing).sort((a, b) => a[1].at - b[1].at)[0];
  if (!entry) return null;
  const [channelId, { from }] = entry;
  const channel = channels[channelId];
  const caller = users[from];
  const accept = async () => {
    nav(`/channels/@me/${channelId}`);
    await joinVoice(channelId);
  };
  return (
    <Modal open onClose={() => void declineCall(channelId)} width={360} closeOnOverlay={false} bare>
      <div className={s.ring} style={{ background: "var(--bg-surface)", borderRadius: "var(--radius-md)", padding: 24 }} data-testid="incoming-call">
        <div className={s.ringAvatar}>
          <Avatar id={from} avatarId={caller?.avatar_id ?? null} name={displayName(caller)} size={80} />
        </div>
        <div className={s.ringName}>{displayName(caller)}</div>
        <div className={s.ringSub}>{channel && channel.type === "group_dm" ? `Incoming call in ${channelDisplayName(channel, users, meId)}` : "Incoming call…"}</div>
        <div className={s.ringBtns}>
          <button className={[s.ringBtn, s.ringDecline].join(" ")} aria-label="Decline" onClick={() => void declineCall(channelId)}><HangUp size={24} /></button>
          <button className={[s.ringBtn, s.ringAccept].join(" ")} aria-label="Accept" onClick={() => void accept()} data-testid="accept-call"><Phone size={24} /></button>
        </div>
      </div>
    </Modal>
  );
}
