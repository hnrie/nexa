import { HeadphoneOff, MicOff, MonitorUp, Video } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import { ApiError } from "@/api/client";
import { guests as guestsApi } from "@/api/guests";
import type { VoiceState } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { memberMenuItems } from "@/components/server/memberMenu";
import { UserTag } from "@/components/servertag/UserTag";
import { appendSection, copyIdItem, developerMode } from "@/lib/copyId";
import { P } from "@/lib/perms";
import { memberName } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { canI, useServers } from "@/stores/servers";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { participantsOf, useVoice } from "@/stores/voice";
import { useVoiceDrag } from "@/stores/voiceDrag";
import { openProfilePopout } from "@/stores/profilePopout";
import { setUserLocalMute, setUserVolume } from "@/voice/session";
import { inAsGuest, modMuted, voiceModerationItems, voicePowers } from "./voiceModeration";
import s from "./Voice.module.css";

import { t } from "@/i18n";

/** How loud someone is on this device: the slider, a mute here, and a way back to 100%. */
export function volumeItems(userId: string): ContextMenuItem[] {
  const v = useVoice.getState();
  const vol = v.volumes[userId] ?? 100;
  const muted = !!v.localMutes[userId];
  return [
    { id: "volume", label: t("voice.voiceParticipants.userVolume"), slider: { value: vol, min: 0, max: 200, unit: "%", onChange: (n: number) => setUserVolume(userId, n) } },
    { id: "mute", label: muted ? t("voice.voice.unmute") : t("voice.voice.mute"), onSelect: () => setUserLocalMute(userId, !muted) },
    { id: "reset", label: t("voice.voiceParticipants.resetVolume"), disabled: vol === 100, onSelect: () => setUserVolume(userId, 100) },
  ];
}

/**
 * Someone's menu under a voice channel: their profile and the member's usual
 * choices, how loud they are here, and a moderator's tools where this account
 * has them (Server Mute, Server Deafen, Move To, Disconnect, then the
 * server's Time Out, Kick and Ban). A guest's has their volume and, for whoever
 * may move members, Remove From Call.
 */
function personMenu(serverId: string | null, channelId: string, p: VoiceState, openModal: (kind: string, props?: Record<string, unknown>) => void): ContextMenuItem[] {
  const meId = useAuth.getState().me?.id;
  const profile: ContextMenuItem = { id: "profile", label: t("profile.profile.profile"), onSelect: () => openModal("profile", { userId: p.user_id }) };
  if (p.user_id === meId) return [profile];
  const voice = serverId ? voiceModerationItems(serverId, channelId, p) : [];
  if (inAsGuest(p)) {
    const items = [...volumeItems(p.user_id)];
    appendSection(items, voice);
    const server = serverId ? useServers.getState().byId[serverId] : undefined;
    if (canI(server, P.MOVE_MEMBERS, channelId)) {
      const remove = () => void guestsApi.remove(channelId, p.user_id).catch((err) => useUI.getState().toast(err instanceof ApiError ? err.message : t("voice.voiceParticipants.couldNotRemoveTheGuest"), "error"));
      appendSection(items, [{ id: "remove-guest", label: t("voice.voiceParticipants.removeFromCall"), danger: true, onSelect: remove }]);
    }
    return items;
  }
  if (!serverId) {
    const items = [{ ...profile, separatorAfter: true }, ...volumeItems(p.user_id)];
    if (developerMode()) appendSection(items, [copyIdItem("copy", t("chat.groupMemberMenu.copyUserId"), p.user_id)]);
    return items;
  }
  // the member's own menu, with the call's choices after who they are
  const items = memberMenuItems(serverId, p.user_id, { openModal });
  const at = items.findIndex((x) => x.id === "mention") + 1 || 1;
  const head = items.slice(0, at);
  head[head.length - 1] = { ...head[head.length - 1]!, separatorAfter: true };
  const call = [...volumeItems(p.user_id)];
  appendSection(call, voice);
  call[call.length - 1] = { ...call[call.length - 1]!, separatorAfter: true };
  return [...head, ...call, ...items.slice(at)];
}

/** Who is in a voice channel, listed under it in the sidebar. */
export function VoiceParticipants({ channelId, serverId }: { channelId: string; serverId: string | null }) {
  const byChannel = useVoice((v) => v.byChannel);
  const speaking = useVoice((v) => v.speaking);
  const users = useUsers((u) => u.byId);
  const server = useServers((st) => (serverId ? st.byId[serverId] : undefined));
  const meId = useAuth((a) => a.me?.id);
  const openModal = useUI((u) => u.openModal);
  const openContextMenu = useUI((u) => u.openContextMenu);
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
              const items = personMenu(serverId, channelId, p, openModal);
              // a guest's ID lasts only as long as its link, so there is nothing to copy
              if (items.length) openContextMenu({ x: e.clientX, y: e.clientY, items, label: name });
            }}
          >
            <Avatar id={p.user_id} avatarId={users[p.user_id]?.avatar_id ?? null} name={name} size={24} className={s.pAvatar} />
            <span className={s.pName}>{name}</span>
            {guest ? <span className={s.pGuest}>{t("voice.voiceParticipants.guest")}</span> : <UserTag userId={p.user_id} size="sm" />}
            <span className={s.pIcons}>
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
