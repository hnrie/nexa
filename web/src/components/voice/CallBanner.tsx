import { Phone } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { useAuth } from "@/stores/auth";
import { displayName, useUsers } from "@/stores/users";
import { participantsOf, useVoice } from "@/stores/voice";
import { joinVoice } from "@/voice/session";
import { CallTimer } from "./CallTimer";
import s from "./Voice.module.css";

import { t } from "@/i18n";
/** Shown at the top of a DM while a call is running that you are not in. */
export function CallBanner({ channelId }: { channelId: string }) {
  const byChannel = useVoice((v) => v.byChannel);
  const mine = useVoice((v) => v.mine);
  const joining = useVoice((v) => v.joining);
  const users = useUsers((u) => u.byId);
  const meId = useAuth((a) => a.me?.id);
  const participants = participantsOf(byChannel, channelId).filter((p) => p.user_id !== meId);
  if (participants.length === 0 || mine?.channel_id === channelId) return null;
  return (
    <div className={s.banner} data-testid="call-banner">
      <div className={s.bannerAvatars}>
        {participants.slice(0, 5).map((p) => (
          <Avatar key={p.user_id} id={p.user_id} avatarId={users[p.user_id]?.avatar_id ?? null} name={displayName(users[p.user_id])} size={28} />
        ))}
      </div>
      <div className={s.bannerText}>
        <span className={s.bannerHeadRow}>
          <span className={s.bannerHead}>{t("voice.callBanner.callInProgress")}</span>
          <CallTimer channelId={channelId} pill />
        </span>
        <span className={s.bannerSub}>{participants.map((p) => displayName(users[p.user_id])).join(", ")}</span>
      </div>
      <button className={s.bannerJoin} onClick={() => void joinVoice(channelId)} disabled={joining === channelId}>
        <Phone size={14} style={{ verticalAlign: -2, marginInlineEnd: 6 }} />
        {joining === channelId ? t("voice.callBanner.joining") : t("voice.callBanner.joinCall")}
      </button>
    </div>
  );
}
