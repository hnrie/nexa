import { ApiError } from "@/api/client";
import { guests as guestsApi } from "@/api/guests";
import type { VoiceState } from "@/api/types";
import { memberManageButtons, memberModerationButtons, memberProfileButtons } from "@/components/server/memberMenu";
import { about, button, defineMenu, type MenuButton } from "@/lib/contextMenus/registry";
import { relationshipButtons } from "@/lib/friendship";
import { P } from "@/lib/perms";
import { useAuth } from "@/stores/auth";
import { canI, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { copyIdItem, developerMode } from "@/lib/copyId";
import { useVoice } from "@/stores/voice";
import { setStreamLocalMute, setStreamVolume, setUserLocalMute, setUserVolume } from "@/voice/session";
import { inAsGuest, voiceModerationButtons } from "./voiceModeration";
import { t } from "@/i18n";

type OpenModal = (kind: string, props?: Record<string, unknown>) => void;

/**
 * Someone's volume in a call, as only this device hears it: a slider, mute,
 * and back to 100%. `ids` names the buttons in the menu they are in; `of`
 * says whose, or null where it does not apply.
 */
function personVolumeButtons<C>(ids: { volume: string; mute: string; reset: string }, of: (ctx: C) => string | null): MenuButton<C>[] {
  return [
    button(ids.volume, (c) => {
      const uid = of(c);
      return uid ? { id: "volume", label: t("voice.voiceParticipants.userVolume"), slider: { value: useVoice.getState().volumes[uid] ?? 100, min: 0, max: 200, unit: "%", onChange: (v: number) => setUserVolume(uid, v) } } : null;
    }),
    button(ids.mute, (c) => {
      const uid = of(c);
      const muted = !!uid && !!useVoice.getState().localMutes[uid];
      return uid ? { id: "mute", label: muted ? t("voice.voice.unmute") : t("voice.voice.mute"), onSelect: () => setUserLocalMute(uid, !muted) } : null;
    }),
    button(ids.reset, (c) => {
      const uid = of(c);
      return uid ? { id: "reset", label: t("voice.voiceParticipants.resetVolume"), disabled: (useVoice.getState().volumes[uid] ?? 100) === 100, onSelect: () => setUserVolume(uid, 100) } : null;
    }),
  ];
}

export interface CallParticipantCtx {
  /** The server the voice channel is in; null for a DM's or group's call. */
  serverId: string | null;
  channelId: string;
  vs: VoiceState;
  openModal: OpenModal;
}

/** Who the menu is about, and how they stand to the signed-in account. */
function participant({ serverId, channelId, vs, openModal }: CallParticipantCtx) {
  const self = vs.user_id === useAuth.getState().me?.id;
  const guest = inAsGuest(vs);
  return { userId: vs.user_id, self, guest, serverId, channelId, vs, openModal };
}

/** The member's own buttons, for someone in a server's call who is neither you nor a guest. */
const asMember = (c: CallParticipantCtx) => {
  const p = participant(c);
  return !p.self && !p.guest && p.serverId ? { serverId: p.serverId, userId: p.userId, openModal: p.openModal } : null;
};

function removeGuest(channelId: string, userId: string): void {
  void guestsApi.remove(channelId, userId).catch((err) => useUI.getState().toast(err instanceof ApiError ? err.message : t("voice.voiceParticipants.couldNotRemoveTheGuest"), "error"));
}

/**
 * Someone's menu under a voice channel: their profile and the member's usual
 * choices, how loud they are here, and a moderator's tools where this account
 * has them (Server Mute, Server Deafen, Move To, Disconnect, then the
 * server's Time Out, Kick and Ban). A guest's has their volume and, for
 * whoever may move members, Remove From Call. Your own has your profile.
 */
export const callParticipantMenu = defineMenu<CallParticipantCtx>("callParticipant", [
  [
    // in a server, someone else's profile comes with the member's own buttons below
    button("viewParticipantProfile", (c) => {
      const p = participant(c);
      return (p.self || (!p.guest && !p.serverId)) && { id: "profile", label: t("profile.profile.profile"), onSelect: () => p.openModal("profile", { userId: p.userId }) };
    }),
    ...memberProfileButtons<CallParticipantCtx>({ profile: "viewParticipantMemberProfile", link: "copyParticipantProfileLink", mention: "mentionParticipant" }, asMember),
  ],
  personVolumeButtons<CallParticipantCtx>({ volume: "participantVolume", mute: "muteParticipant", reset: "resetParticipantVolume" }, (c) => (participant(c).self ? null : c.vs.user_id)),
  voiceModerationButtons<CallParticipantCtx>({ mute: "serverMuteParticipant", deafen: "serverDeafenParticipant", move: "moveParticipant", disconnect: "disconnectParticipant" }, (c) =>
    !participant(c).self && c.serverId ? { serverId: c.serverId, channelId: c.channelId, vs: c.vs } : null,
  ),
  relationshipButtons<CallParticipantCtx>({ friend: "participantFriendship", block: "blockParticipant" }, (c) => asMember(c)?.userId ?? null),
  memberManageButtons<CallParticipantCtx>({ nickname: "editParticipantNickname", roles: "editParticipantRoles" }, asMember),
  memberModerationButtons<CallParticipantCtx>({ timeout: "timeoutParticipant", kick: "kickParticipant", ban: "banParticipant" }, asMember),
  [button("removeGuestParticipant", (c) => {
    const p = participant(c);
    const server = p.serverId ? useServers.getState().byId[p.serverId] : undefined;
    return !p.self && p.guest && canI(server, P.MOVE_MEMBERS, p.channelId) && { id: "remove-guest", label: t("voice.voiceParticipants.removeFromCall"), danger: true, onSelect: () => removeGuest(p.channelId, p.userId) };
  })],
  // a guest's ID lasts only as long as its link, so there is nothing to copy
  [button("copyParticipantId", (c) => {
    const p = participant(c);
    return !p.self && !p.guest && developerMode() && copyIdItem("copy", t("chat.groupMemberMenu.copyUserId"), p.userId);
  })],
]);
about(callParticipantMenu, ["user", "channel", "server"], ({ serverId, channelId, vs }) => ({ serverId, channelId, userId: vs.user_id }));


export interface CallTileCtx {
  userId: string;
  /** The call's channel, and the server it is in (null for a DM's or group's call). */
  channelId: string;
  serverId: string | null;
  /** The person's voice state in the call, for a moderator's tools. */
  voiceState?: VoiceState;
  /** The tile is the signed-in account's own. */
  me: boolean;
  kind: "video" | "screen" | "avatar" | "ringing" | string;
  /** The page is a guest's, which knows nobody's profile. */
  viewerIsGuest: boolean;
  /** The tile is a guest's. */
  guestTile: boolean;
  /** Set for someone else's live stream: whether you are watching it, and switching that. */
  watch?: { on: boolean; toggle: () => void };
  /** Set for a tile showing a stream: whether it is focused or full screen, and switching those. */
  view?: { focused: boolean; toggleFocus: () => void; full: boolean; toggleFull: () => void };
  stopSharing: () => void;
  canRemoveGuest: boolean;
  removeGuest: () => void;
  openModal: OpenModal;
}

/** someone still being rung is not in the call yet: there is nothing of theirs to turn up or down */
const inCall = (c: CallTileCtx) => c.kind !== "ringing";

/** Whether a tile offers a moderator's tools: someone else's own tile in a server's call, seen by a member. */
const moderates = (c: CallTileCtx) => inCall(c) && !c.viewerIsGuest && !c.me && c.kind !== "screen" && !!c.serverId && !!c.voiceState;

/** A tile of a call's stage: someone's camera, screen or picture. */
export const callTileMenu = defineMenu<CallTileCtx>("callTile", [
  [
    // a guest has no profile, and a guest's page knows nobody's
    button("viewTileProfile", ({ userId, viewerIsGuest, guestTile, openModal }) => !viewerIsGuest && !guestTile && { id: "profile", label: t("profile.profile.profile"), onSelect: () => openModal("profile", { userId }) }),
    button("stopSharingFromTile", (c) => inCall(c) && c.kind === "screen" && c.me && { id: "stop-share", label: t("voice.voice.stopSharing"), onSelect: c.stopSharing }),
    button("watchStream", (c) => inCall(c) && !!c.watch && { id: "watch", label: c.watch.on ? t("voice.voice.stopWatching") : t("voice.voice.watchStream"), onSelect: c.watch.toggle }),
    button("focusTile", (c) => inCall(c) && !!c.view && { id: "focus", label: c.view.focused ? t("voice.voice.unfocus") : t("voice.voice.focus"), onSelect: c.view.toggleFocus }),
    button("fullScreenTile", (c) => inCall(c) && !!c.view && { id: "fullscreen", label: c.view.full ? t("voice.voice.exitFullScreen") : t("voice.voice.fullScreen"), onSelect: c.view.toggleFull }),
  ],
  [
    // a stream's sound has its own level: turning a loud game down leaves the person's voice alone
    button("streamVolume", (c) => inCall(c) && !c.me && c.kind === "screen" && { id: "stream-volume", label: t("voice.voice.streamVolume"), slider: { value: useVoice.getState().streamVolumes[c.userId] ?? 100, min: 0, max: 200, unit: "%", onChange: (v: number) => setStreamVolume(c.userId, v) } }),
    button("muteStream", (c) => {
      if (!inCall(c) || c.me || c.kind !== "screen") return null;
      const muted = !!useVoice.getState().streamMutes[c.userId];
      return { id: "stream-mute", label: muted ? t("voice.voice.unmuteStream") : t("voice.voice.muteStream"), onSelect: () => setStreamLocalMute(c.userId, !muted) };
    }),
    button("resetStreamVolume", (c) => inCall(c) && !c.me && c.kind === "screen" && { id: "stream-reset", label: t("voice.voice.resetStreamVolume"), disabled: (useVoice.getState().streamVolumes[c.userId] ?? 100) === 100, onSelect: () => setStreamVolume(c.userId, 100) }),
    ...personVolumeButtons<CallTileCtx>({ volume: "tileVolume", mute: "muteTile", reset: "resetTileVolume" }, (c) => (inCall(c) && !c.me && c.kind !== "screen" ? c.userId : null)),
  ],
  // a moderator's tools, on the person's own tile: Server Mute, Server Deafen, Move To, Disconnect, then the server's Time Out, Kick and Ban
  voiceModerationButtons<CallTileCtx>({ mute: "serverMuteTile", deafen: "serverDeafenTile", move: "moveTile", disconnect: "disconnectTile" }, (c) => (moderates(c) && c.serverId && c.voiceState ? { serverId: c.serverId, channelId: c.channelId, vs: c.voiceState } : null)),
  memberModerationButtons<CallTileCtx>({ timeout: "timeoutTile", kick: "kickTile", ban: "banTile" }, (c) => (moderates(c) && !c.guestTile && c.serverId ? { serverId: c.serverId, userId: c.userId, openModal: c.openModal } : null)),
  [button("removeGuestFromTile", (c) => inCall(c) && c.guestTile && c.canRemoveGuest && c.kind !== "screen" && { id: "remove-guest", label: t("voice.voiceParticipants.removeFromCall"), danger: true, onSelect: c.removeGuest })],
  [button("copyTileUserId", (c) => inCall(c) && !c.viewerIsGuest && !c.guestTile && developerMode() && copyIdItem("copy-user", t("chat.groupMemberMenu.copyUserId"), c.userId))],
]);
about(callTileMenu, ["user", "channel", "server"], ({ serverId, channelId, userId }) => ({ serverId, channelId, userId }));

