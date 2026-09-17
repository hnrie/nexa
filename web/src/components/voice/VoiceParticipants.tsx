import { HeadphoneOff, MicOff, MonitorUp, Video } from "lucide-react";
import { ApiError } from "@/api/client";
import { guests as guestsApi } from "@/api/guests";
import { Avatar } from "@/components/common/Avatar";
import { isGuest } from "@/lib/guestLink";
import { P } from "@/lib/perms";
import { memberName } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { canI, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { participantsOf, useVoice } from "@/stores/voice";
import { setUserLocalMute, setUserVolume } from "@/voice/session";
import s from "./Voice.module.css";

import { t } from "@/i18n";
/** Who is in a voice channel, listed under it in the sidebar. */
export function VoiceParticipants({ channelId, serverId }: { channelId: string; serverId: string | null }) {
  const byChannel = useVoice((v) => v.byChannel);
  const speaking = useVoice((v) => v.speaking);
  const users = useUsers((u) => u.byId);
  const server = useServers((st) => (serverId ? st.byId[serverId] : undefined));
  const meId = useAuth((a) => a.me?.id);
  const openModal = useUI((u) => u.openModal);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const volumes = useVoice((v) => v.volumes);
  const localMutes = useVoice((v) => v.localMutes);
  const list = participantsOf(byChannel, channelId);
  if (list.length === 0) return null;
  return (
    <div className={s.participants} data-testid="voice-participants">
      {list.map((p) => {
        const name = memberName(server?.members[p.user_id]?.nickname, users[p.user_id], p.user_id === meId ? "You" : "Unknown User");
        // a guest has no profile to open; whoever may move members may put one out
        const guest = !!p.guest || isGuest(users[p.user_id]);
        const removeGuest = () => void guestsApi.remove(channelId, p.user_id).catch((err) => useUI.getState().toast(err instanceof ApiError ? err.message : t("voice.voiceParticipants.couldNotRemoveTheGuest"), "error"));
        return (
          <button
            key={p.user_id}
            className={s.participant}
            data-speaking={!!speaking[p.user_id]}
            data-user={p.user_id}
            data-guest={guest || undefined}
            onClick={() => !guest && openModal("profile", { userId: p.user_id })}
            onContextMenu={(e) => {
              e.preventDefault();
              const vol = volumes[p.user_id] ?? 100;
              const profile = { id: "profile", label: t("profile.profile.profile"), onSelect: () => openModal("profile", { userId: p.user_id }) };
              openContextMenu({
                x: e.clientX,
                y: e.clientY,
                items:
                  p.user_id === meId
                    ? [profile]
                    : [
                        ...(guest ? [] : [{ ...profile, separatorAfter: true }]),
                        { id: "volume", label: t("voice.voiceParticipants.userVolume"), slider: { value: vol, min: 0, max: 200, unit: "%", onChange: (v: number) => setUserVolume(p.user_id, v) } },
                        { id: "mute", label: localMutes[p.user_id] ? "Unmute" : "Mute", onSelect: () => setUserLocalMute(p.user_id, !localMutes[p.user_id]) },
                        { id: "reset", label: t("voice.voiceParticipants.resetVolume"), disabled: vol === 100, onSelect: () => setUserVolume(p.user_id, 100), separatorAfter: guest && canI(server, P.MOVE_MEMBERS, channelId) },
                        ...(guest && canI(server, P.MOVE_MEMBERS, channelId) ? [{ id: "remove-guest", label: t("voice.voiceParticipants.removeFromCall"), danger: true, onSelect: removeGuest }] : []),
                      ],
              });
            }}
          >
            <Avatar id={p.user_id} avatarId={users[p.user_id]?.avatar_id ?? null} name={name} size={24} className={s.pAvatar} />
            <span className={s.pName}>{name}</span>
            {guest ? <span className={s.pGuest}>{t("voice.voiceParticipants.guest")}</span> : null}
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
