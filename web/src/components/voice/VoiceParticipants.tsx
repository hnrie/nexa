import { HeadphoneOff, Megaphone, MicOff, MonitorUp, Video } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import { Avatar } from "@/components/common/Avatar";
import { UserTag } from "@/components/servertag/UserTag";
import { memberName } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { participantsOf, useVoice } from "@/stores/voice";
import { useVoiceDrag } from "@/stores/voiceDrag";
import { openProfilePopout } from "@/stores/profilePopout";
import { inAsGuest, modMuted, voicePowers } from "./voiceModeration";
import { callParticipantMenu } from "./callMenus";
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
  const dragging = useVoiceDrag((d) => d.drag?.userId ?? null);
  const list = participantsOf(byChannel, channelId);
  if (list.length === 0) return null;
  return (
    <div className={s.participants} data-testid="voice-participants">
      {list.map((p) => {
        const name = memberName(server?.members[p.user_id]?.nickname, users[p.user_id], p.user_id === meId ? t("callScreen.you") : t("names.unknownUser"));
        const guest = inAsGuest(p);
        // a moderator who may move them drags them onto another voice channel
        const canDrag = !!serverId && !guest && voicePowers(serverId, channelId, p).move;
        const open = (e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
          // a guest has no profile to open
          if (!guest) openProfilePopout(p.user_id, e.currentTarget, server?.server.id);
        };
        const serverMuted = modMuted(p);
        return (
          <div
            key={p.user_id}
            role="button"
            tabIndex={0}
            className={s.participant}
            data-speaking={!!speaking[p.user_id]}
            data-user={p.user_id}
            data-guest={guest || undefined}
            data-draggable={canDrag || undefined}
            data-dragging={dragging === p.user_id || undefined}
            draggable={canDrag}
            onDragStart={(e) => {
              if (!canDrag || !serverId) return e.preventDefault();
              e.dataTransfer.effectAllowed = "move";
              // something for the browser to carry; what it is lives in the store
              e.dataTransfer.setData("text/plain", name);
              useVoiceDrag.getState().start({ serverId, userId: p.user_id, from: channelId });
            }}
            onDragEnd={() => useVoiceDrag.getState().end()}
            onClick={open}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              open(e);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              callParticipantMenu.open({ serverId, channelId, vs: p, openModal }, { x: e.clientX, y: e.clientY, label: name });
            }}
          >
            <Avatar id={p.user_id} avatarId={users[p.user_id]?.avatar_id ?? null} name={name} size={24} className={s.pAvatar} />
            <span className={s.pName}>{name}</span>
            {guest ? <span className={s.pGuest}>{t("voice.voiceParticipants.guest")}</span> : <UserTag userId={p.user_id} size="sm" />}
            <span className={s.pIcons}>
              {p.priority_speaker ? <Megaphone size={14} aria-label={t("perms.prioritySpeaker")} data-testid="priority-speaker" /> : null}
              {p.video ? <Video size={14} /> : null}
              {p.streaming ? <MonitorUp size={14} /> : null}
              {p.self_mute || p.server_mute ? <MicOff size={14} data-server={serverMuted || undefined} aria-label={serverMuted ? t("voice.moderation.mutedByModerator") : undefined} /> : null}
              {p.self_deaf || p.server_deaf ? <HeadphoneOff size={14} data-server={p.server_deaf || undefined} aria-label={p.server_deaf ? t("voice.moderation.deafenedByModerator") : undefined} /> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
