import { HeadphoneOff, MicOff, MonitorUp, Video } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { memberName } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { participantsOf, useVoice } from "@/stores/voice";
import s from "./Voice.module.css";

/** Who is in a voice channel, listed under it in the sidebar. */
export function VoiceParticipants({ channelId, serverId }: { channelId: string; serverId: string | null }) {
  const byChannel = useVoice((v) => v.byChannel);
  const speaking = useVoice((v) => v.speaking);
  const users = useUsers((u) => u.byId);
  const server = useServers((st) => (serverId ? st.byId[serverId] : undefined));
  const meId = useAuth((a) => a.me?.id);
  const openModal = useUI((u) => u.openModal);
  const list = participantsOf(byChannel, channelId);
  if (list.length === 0) return null;
  return (
    <div className={s.participants} data-testid="voice-participants">
      {list.map((p) => {
        const name = memberName(server?.members[p.user_id]?.nickname, users[p.user_id], p.user_id === meId ? "You" : "Unknown User");
        return (
          <button key={p.user_id} className={s.participant} data-speaking={!!speaking[p.user_id]} data-user={p.user_id} onClick={() => openModal("profile", { userId: p.user_id })}>
            <Avatar id={p.user_id} avatarId={users[p.user_id]?.avatar_id ?? null} name={name} size={24} className={s.pAvatar} />
            <span className={s.pName}>{name}</span>
            <span className={s.pIcons}>
              {p.video ? <Video size={14} /> : null}
              {p.streaming ? <MonitorUp size={14} /> : null}
              {p.self_mute || p.server_mute ? <MicOff size={14} data-server={p.server_mute} /> : null}
              {p.self_deaf || p.server_deaf ? <HeadphoneOff size={14} data-server={p.server_deaf} /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
